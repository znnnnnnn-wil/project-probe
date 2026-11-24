import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { submitPaymentForm } from "./payment";
import type { Order } from "./types";

const storageKey = "payment:waiting";
type Waiting = { id: string; until: number };
function restored(): Waiting | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    return value &&
      /^[a-f0-9-]{36}$/.test(value.id) &&
      typeof value.until === "number" &&
      value.until > Date.now()
      ? value
      : null;
  } catch {
    return null;
  }
}

export function usePaymentCheckout(
  mode: string | undefined,
  configured: boolean,
  onPaid: (order: Order) => Promise<void>,
) {
  const [waiting, setWaiting] = useState<Waiting | null>(restored);
  const [notice, setNotice] = useState(waiting ? "正在恢复订单状态核对…" : "");
  const popup = useRef<Window | null>(null);
  const stop = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    setWaiting(null);
    try {
      popup.current?.close();
    } catch {
      /* COOP may detach the cashier. */
    }
    popup.current = null;
  }, []);
  const checkout = useCallback(
    async (id: string, target: Window | null) => {
      if (!target)
        throw new Error(
          "浏览器拦截了收银台窗口，订单已保留，请允许弹窗后点击付款重试。",
        );
      try {
        const result = await api<{ formHtml: string }>(
          "/orders/" + id + "/checkout",
          "POST",
        );
        submitPaymentForm(result.formHtml, mode || "", target);
        try {
          if (popup.current !== target) popup.current?.close();
        } catch {
          /* Best effort when the browser detaches a window. */
        }
        popup.current = target;
        const next = { id, until: Date.now() + 30 * 60 * 1000 };
        sessionStorage.setItem(storageKey, JSON.stringify(next));
        setNotice("收银台已打开，正在等待服务端确认付款。确认后将自动返回。");
        setWaiting(next);
      } catch (error) {
        try {
          target.close();
        } catch {
          /* Never replace the original error. */
        }
        throw error;
      }
    },
    [mode],
  );

  useEffect(() => {
    if (!waiting || !mode || mode === "mock" || !configured) return;
    let cancelled = false,
      checking = false,
      lastSync = 0;
    let timer: number | undefined;
    const check = async () => {
      if (cancelled || checking) return;
      window.clearTimeout(timer);
      checking = true;
      try {
        if (Date.now() > waiting.until) {
          cancelled = true;
          stop();
          setNotice("自动等待已结束，订单仍已保存，可在订单记录中继续核对。");
          return;
        }
        let order = await api<Order>("/orders/" + waiting.id);
        if (cancelled) return;
        if (order.mode !== mode || order.can_operate === false) {
          cancelled = true;
          stop();
          setNotice("订单支付环境已变化，请在订单记录中核对。");
          return;
        }
        if (
          ["PENDING", "EXPIRED"].includes(order.status) &&
          Date.now() - lastSync >= 15000
        ) {
          lastSync = Date.now();
          try {
            order = await api<Order>("/orders/" + waiting.id + "/sync", "POST");
          } catch {
            /* A later signed notification or query may still confirm payment. */
          }
        }
        if (cancelled) return;
        if (order.status === "PAID") {
          cancelled = true;
          stop();
          setNotice("支付已确认，训练权益已到账。");
          window.focus();
          await onPaid(order);
        } else if (!["PENDING", "EXPIRED"].includes(order.status)) {
          cancelled = true;
          stop();
          setNotice("订单状态已更新，请查看订单记录。");
        }
      } catch (error) {
        if (
          !cancelled &&
          error instanceof ApiError &&
          [401, 403, 404].includes(error.status)
        ) {
          cancelled = true;
          stop();
          setNotice("无法读取该订单，请重新登录后查看订单记录。");
        }
      } finally {
        checking = false;
        if (!cancelled) timer = window.setTimeout(() => void check(), 3000);
      }
    };
    void check();
    const focus = () => void check();
    window.addEventListener("focus", focus);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", focus);
    };
  }, [waiting, mode, configured, onPaid, stop]);

  const stopWaiting = useCallback(() => {
    stop();
    setNotice("已停止自动等待，订单已保留，可稍后继续付款或查询。");
  }, [stop]);
  return { checkout, pendingId: waiting?.id, notice, stop: stopWaiting };
}
