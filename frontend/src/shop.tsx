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
  return (
    <section className="page shop-page">
      <PageHead
        eyebrow="支付宝 AI 网页应用收款"
        title="训练包与订单"
        text="次数套餐与永久套餐，无自动续费。普通中断可继续原训练；系统生成失败可恢复或返还本次训练次数。"
      />
      {checkout.notice && (
        <div className="purchase-context" role="status">
          <CreditCard size={18} />
          <div>
            <strong>{checkout.notice}</strong>
          </div>
          {checkout.pendingId && (
            <>
              <Button
                secondary
                disabled={busy}
                onClick={() => pay(checkout.pendingId!)}
              >
                重新打开收银台
              </Button>
              <button
                className="icon-button"
                aria-label="停止等待付款"
                title="停止等待付款，不取消订单"
                onClick={checkout.stop}
              >
                <X size={16} />
              </button>
            </>
          )}
        </div>
      )}
      {originProject && (
        <div className="purchase-context">
          <FolderOpen size={18} />
          <div>
            <strong>为当前项目准备训练权益</strong>
            <small>付款确认后可返回项目开始练习；不会自动扣除训练次数。</small>
          </div>
          <Button secondary onClick={() => go("/projects/" + originProject)}>
            返回原项目
            <ArrowRight size={15} />
          </Button>
          <button
            className="icon-button"
            aria-label="清除购买来源"
            title="清除购买来源"
            onClick={() => {
              sessionStorage.removeItem("purchase:project");
              setOriginProject("");
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="shop-layout">
        <div className="product-list">
          {(
            s.products || [
              {
                ...s.product,
                code: "TEN_TRAININGS",
                trainingLimit: 10,
                lifetime: false,
              },
            ]
          ).map((product) => (
            <article className="package-card" key={product.code}>
              <span className="badge">{paymentLabel[s.mode]}商品</span>
              <h2>{product.name}</h2>
              <div className="price">
                <small>¥</small>
                {(product.amountCents / 100).toLocaleString("zh-CN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span> / 包</span>
              </div>
              <p>
                {s.mode === "production"
                  ? "正式商品价格，以创建订单时金额为准"
                  : "演示定价，不代表正式售价"}
              </p>
              <ul>
                <li>
                  <Check size={17} />
                  {product.lifetime
                    ? "永久不限训练次数"
                    : "深挖与复测合计 10 次"}
                </li>
                <li>
                  <Check size={17} />
                  {product.lifetime
                    ? "不限深挖与关联复测次数"
                    : "每开启一轮训练扣 1 次"}
                </li>
                <li>
                  <Check size={17} />
                  原回答、材料依据与补充任务
                </li>
                <li>
                  <Check size={17} />
                  已提交记录持久保存与恢复
                </li>
              </ul>
              <Button
                disabled={busy || !!checkout.pendingId}
                onClick={() => {
                  if (
                    product.lifetime &&
                    !window.confirm(
                      `确认创建永久套餐订单？金额为 ¥${(product.amountCents / 100).toLocaleString("zh-CN")}；${s.mode === "production" ? "付款将产生真实扣款。" : "当前为测试环境，不使用真实资金。"}`,
                    )
                  )
                    return;
                  const popup =
                    s.mode !== "mock" && s.configured
                      ? openPaymentWindow()
                      : null;
                  run(async () => {
                    try {
                      const order = await api<Order>("/orders", "POST", {
                        requestKey: key,
                        productCode: product.code,
                      });
                      if (originProject)
                        sessionStorage.setItem(
                          "purchase:order:" + order.id,
                          originProject,
                        );
                      setKey(crypto.randomUUID());
                      await load();
                      setCreatedId(order.id);
                      if (s.mode !== "mock" && s.configured)
                        await checkout.checkout(order.id, popup);
                    } catch (error) {
                      try {
                        popup?.close();
                      } catch {}
                      throw error;
                    }
                  });
                }}
              >
                {product.lifetime ? "创建永久套餐" : "创建"}
                {s.mode === "mock"
                  ? "模拟"
                  : s.mode === "sandbox"
                    ? "沙箱"
                    : "正式"}
                订单 <ArrowRight size={17} />
              </Button>
              {createdId &&
                s.orders.some(
                  (o) =>
                    o.id === createdId &&
                    (o.product_code || "TEN_TRAININGS") === product.code,
                ) && (
                  <p className="save-notice" role="status">
                    {s.mode === "mock"
                      ? "订单已创建，前往右侧订单完成模拟付款。"
                      : "订单已创建，收银台未打开时可从订单记录重试付款。"}
                  </p>
                )}
              <small>
                {s.mode === "mock"
                  ? "不会调用支付宝，不会产生真实扣款。"
                  : s.configured
                    ? s.mode === "production"
                      ? "通过支付宝正式收款，付款将产生真实扣款。"
                      : "仅使用支付宝官方沙箱，不使用真实资金。"
                    : "支付宝配置未完成，支付暂不可用，不会回退模拟支付。"}
              </small>
              {!s.configured && (
                <div role="status">
                  <p>仍需配置：</p>
                  {s.configurationIssues?.map((v) => (
                    <p key={v}>{v}</p>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
        <div>
          <div className="panel balance">
            <h2>我的训练权益</h2>
            <div>
              <p>
                <strong>
                  {trainingQuota(s).unlimited
                    ? "不限次数"
                    : trainingQuota(s).sharedRemaining}
                </strong>
                {trainingQuota(s).unlimited
                  ? "永久训练权益"
                  : "深挖与复测共用次数"}
              </p>
              <p>
                <strong>
                  {trainingQuota(s).legacyDeepRemaining +
                    trainingQuota(s).legacyRetestRemaining}
                </strong>
                历史套餐剩余次数
              </p>
            </div>
            <small>
              复测需先完成本项目深挖，并从报告进入。历史套餐保留原有绑定规则。
            </small>
            <a
              href={
                originProject ? "#/projects/" + originProject : "#/projects"
              }
            >
              {originProject ? "返回原项目开始练习" : "前往我的项目"}{" "}
              <ArrowRight size={15} />
            </a>
          </div>
          <div className="panel orders">
            <div className="panel-heading">
              <h2>订单记录</h2>
              <button
                className="text-link"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await load();
                  })
                }
              >
                <RefreshCw size={14} />
                刷新
              </button>
            </div>
            {!s.orders.length ? (
              <p className="mini-empty">暂无订单。创建订单后可查看支付状态。</p>
            ) : (
              s.orders.map((o) => (
                <div
                  className={"order " + (createdId === o.id ? "new-order" : "")}
                  id={"order-" + o.id}
                  key={o.id}
                >
                  <div>
                    <span className="badge">
                      {paymentLabel[o.mode] || "未知环境"}
                      {o.can_operate === false ? " · 历史账号订单" : ""}
                    </span>
                    <h3>
                      {o.product_name || "项目深挖训练包"}{" "}
                      <span>¥{(o.amount_cents / 100).toFixed(2)}</span>
                    </h3>
                    <details className="order-number">
                      <summary>订单编号</summary>
                      <small>{o.id}</small>
                    </details>
                    <p>
                      {new Date(o.created_at).toLocaleString("zh-CN")} ·{" "}
                      {orderLabel(o)}
                    </p>
                    {o.query_error && <small>{o.query_error}</small>}
                    {o.status === "PENDING" && o.expires_at && (
                      <small>
                        付款截止{" "}
                        {new Date(o.expires_at).toLocaleString("zh-CN")}
                      </small>
                    )}
                  </div>
                  {(o.status === "PENDING" || o.status === "EXPIRED") &&
                    o.mode !== "mock" &&
                    o.mode === s.mode &&
                    o.can_operate !== false &&
                    s.configured && (
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            try {
                              await api("/orders/" + o.id + "/sync", "POST");
                            } finally {
                              await load();
                            }
                          })
                        }
                      >
                        查询支付宝状态
                      </button>
                    )}
                  {o.status === "PENDING" &&
                    o.can_pay !== false &&
                    (!o.expires_at || o.expires_at > Date.now()) &&
                    o.mode === s.mode &&
                    o.can_operate !== false && (
                      <Button
                        secondary
                        disabled={
                          busy ||
                          (!!checkout.pendingId &&
                            checkout.pendingId !== o.id) ||
                          (s.mode !== "mock" && !s.configured)
                        }
                        onClick={() => pay(o.id)}
                      >
                        {s.mode === "mock"
                          ? "模拟支付成功"
                          : s.mode === "sandbox"
                            ? "前往官方沙箱"
                            : "前往支付宝付款"}
                      </Button>
                    )}
                  {s.operationsEnabled &&
                    s.configured &&
                    o.mode === s.mode &&
                    o.can_operate !== false && (
                      <div className="order-operations">
                        {["PENDING", "EXPIRED"].includes(o.status) && (
                          <button
                            className="text-link"
                            disabled={busy}
                            onClick={() => operate(o, "close")}
                          >
                            关闭未付款订单
                          </button>
                        )}
                        {o.status === "PAID" &&
                          s.packages.some(
                            (pack) =>
                              pack.order_id === o.id &&
                              !pack.deep_used &&
                              !pack.retest_used &&
                              !(pack.training_used || 0),
                          ) && (
                            <button
                              className="text-link"
                              disabled={busy}
                              onClick={() => operate(o, "cash-refund")}
                            >
                              申请未使用训练包退款
                            </button>
                          )}
                        {o.status === "REFUNDING" && (
                          <button
                            className="text-link"
                            disabled={busy}
                            onClick={() => operate(o, "refund-query")}
                          >
                            查询退款状态
                          </button>
                        )}
                      </div>
                    )}
                </div>
              ))
            )}
          </div>
          <div className="delivery-note">
            <ShieldCheck size={18} />
            <div>
              <h3>交付与恢复</h3>
              <p>
                付款由服务端确认后发放次数。离开练习可随时继续，生成失败可重试或返还本次训练次数。次数返还不等于资金退款。
              </p>
              <p>
                {s.mode === "production"
                  ? "付款使用真实资金。未使用训练包的资金退款以订单处理结果为准。"
                  : "当前为测试环境，不使用真实资金，不计作真实付费用户。"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
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
  return (
    <section className="page">
      <PageHead
        eyebrow="支付结果核对"
        title={order ? orderLabel(order) : "正在读取订单…"}
        text="此页以服务端通知或查询结果为准。返回到本页不代表付款成功，不会依据跳转参数发放次数。"
      />
      <div className="panel">
        {order && (
          <>
            <span className="badge">{paymentLabel[order.mode]}</span>
            <p>订单金额 ¥{(order.amount_cents / 100).toFixed(2)}</p>
            <small>{order.id}</small>
            {order.query_error && <p>{order.query_error}</p>}
            {order.can_operate === false && (
              <p>该订单属于历史支付环境或账号，当前环境不能查询或支付。</p>
            )}
          </>
        )}
        {order?.status === "PAID" && (
          <div className="payment-delivered">
            <Check size={28} />
            <h2>训练包已交付</h2>
            <p>
              {order.lifetime
                ? "永久训练权益已开通。"
                : order.product_code === "TEN_TRAININGS"
                  ? "深挖与复测合计 10 次已到账。"
                  : "1 次深挖 + 1 次关联复测已到账。"}
              现在可以继续准备项目。
            </p>
            <Button
              onClick={() =>
                go(originProject ? "/projects/" + originProject : "/projects")
              }
            >
              {originProject ? "返回原项目开始练习" : "前往我的项目"}
              <ArrowRight size={16} />
            </Button>
          </div>
        )}
        <p>
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              run(async () => {
                await load();
              })
            }
          >
            重新查询订单状态
          </Button>
        </p>
        <a href="#/shop">返回训练包与订单</a>
      </div>
    </section>
  );
}
