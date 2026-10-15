import React, { useState, useEffect, useCallback } from "react";
import {
  ArrowRight,
  FolderOpen,
  RefreshCw,
  Check,
  ShieldCheck,
  X,
  CreditCard,
} from "lucide-react";
import { api, go } from "./api";
import type { Shop, Order } from "./types";
import { paymentLabel, openPaymentWindow, orderLabel } from "./payment";
import { usePaymentCheckout } from "./payment-checkout";
import { purchaseProject } from "./workspace";
import { trainingQuota } from "./quota";
import { Button, Loading, Empty, PageHead } from "./ui";
import type { Actions } from "./ui";
import { useReadScope } from "./use-read-scope";

export function ShopPage({ run, busy }: Actions) {
  const [s, setS] = useState<Shop | null>(null);
  const [key, setKey] = useState(crypto.randomUUID());
  const [createdId, setCreatedId] = useState("");
  const [originProject, setOriginProject] = useState(purchaseProject());
  const beginRead = useReadScope();
  const load = useCallback(async () => {
    const read = beginRead();
    try {
      const value = await api<Shop>("/shop", "GET", undefined, read.signal);
      if (!read.current()) return false;
      setS(value);
      return true;
    } catch (error) {
      if (read.current()) throw error;
      return false;
    }
  }, [beginRead]);
  const paid = useCallback(
    async (order: Order) => {
      if (!(await load())) return;
      const project = purchaseProject(order.id);
      if (project) go("/projects/" + project);
    },
    [load],
  );
  const checkout = usePaymentCheckout(s?.mode, !!s?.configured, paid);
  useEffect(() => {
    run(async () => {
      await load();
    });
  }, [run, load]);
  useEffect(() => {
    let cancelled = false;
    let timer: number;
    const poll = async () => {
      try {
        await load();
      } catch {
        /* 订单保留，可手动刷新。 */
      }
      if (!cancelled)
        timer = window.setTimeout(poll, document.hidden ? 30000 : 15000);
    };
    timer = window.setTimeout(poll, 15000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load]);
  useEffect(() => {
    if (createdId)
      document
        .getElementById("order-" + createdId)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [createdId, s?.orders.length]);
  if (!s) return <Loading />;
  const pay = (id: string) => {
    const popup = s.mode === "mock" ? null : openPaymentWindow();
    run(async () => {
      if (s.mode === "mock") {
        await api("/orders/" + id + "/mock-pay", "POST");
        await load();
      } else {
        await checkout.checkout(id, popup);
      }
    });
  };
  const operate = (
    order: Order,
    action: "close" | "cash-refund" | "refund-query",
  ) => {
    if (
      action !== "refund-query" &&
      !window.confirm(
        action === "close"
          ? "确认关闭这笔未付款订单？服务端会先核对付款状态，关闭后不能继续支付。"
          : `确认申请 ¥${(order.amount_cents / 100).toFixed(2)} 全额退款？仅完全未使用的训练包可申请，退款期间权益暂停。`,
      )
    )
      return;
    run(async () => {
      try {
        await api("/orders/" + order.id + "/" + action, "POST");
      } finally {
        await load();
      }
    });
  };
  return null;
}
export function PaymentReturn({
  run,
  busy,
  mode,
  configured,
}: Actions & { mode: string; configured: boolean }) {
  const id = new URLSearchParams(location.search).get("probe_order") || "";
  const [order, setOrder] = useState<Order | null>(null);
  const originProject = purchaseProject(id);
  const beginRead = useReadScope();
  const load = useCallback(async () => {
    const read = beginRead();
    const current = await api<Order>(
      "/orders/" + id,
      "GET",
      undefined,
      read.signal,
    );
    if (!read.current()) return;
    setOrder(current);
    if (
      (current.status === "PENDING" || current.status === "EXPIRED") &&
      current.mode === mode &&
      current.can_operate !== false &&
      mode !== "mock" &&
      configured
    ) {
      try {
        const confirmed = await api<Order>("/orders/" + id + "/sync", "POST");
        if (read.current()) setOrder(confirmed);
      } catch (e) {
        if (!read.current()) return;
        const saved = await api<Order>(
          "/orders/" + id,
          "GET",
          undefined,
          read.signal,
        );
        if (read.current()) setOrder(saved);
        throw e;
      }
    }
  }, [id, mode, configured, beginRead]);
  useEffect(() => {
    if (/^[a-f0-9-]{36}$/.test(id))
      run(async () => {
        await load();
      });
  }, [id, run, load]);
  useEffect(() => {
    if (order?.status !== "PAID") return;
    sessionStorage.removeItem("payment:waiting");
    const timer = window.setTimeout(() => {
      location.replace(
        "/#" + (originProject ? "/projects/" + originProject : "/shop"),
      );
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [order?.status, originProject]);
  useEffect(() => {
    if (!order || !["PENDING", "EXPIRED"].includes(order.status)) return;
    const timer = window.setTimeout(() => {
      void load().catch(() => {});
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [order, load]);
  if (!/^[a-f0-9-]{36}$/.test(id))
    return (
      <Empty
        title="未找到待核对订单"
        text="返回订单页选择订单。跳转参数不能证明付款成功。"
        action={() => go("/shop")}
      />
    );
  return null;
}
