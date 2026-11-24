import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Training } from "./types";
import { Button, PageHead } from "./ui";
import type { Actions } from "./ui";
import "./shop.css";

export type PaymentProvider = "disabled" | "legacy" | "watcha";

type TrainingOptions = {
  projectId: string;
  parentId?: string;
  focus?: string;
  newRound?: boolean;
};

export async function startTraining(options: TrainingOptions) {
  const storageKey = `training:start:${JSON.stringify(options)}`;
  const requestKey = sessionStorage.getItem(storageKey) || crypto.randomUUID();
  sessionStorage.setItem(storageKey, requestKey);
  try {
    const training = await api<Training>("/trainings", "POST", {
      ...options,
      requestKey,
    });
    sessionStorage.removeItem(storageKey);
    return training;
  } catch (error) {
    if (
      error instanceof ApiError &&
      [400, 401, 403, 404, 422].includes(error.status)
    ) {
      sessionStorage.removeItem(storageKey);
    }
    throw error;
  }
}

const purchaseOriginKey = "purchase:origin";

export function rememberPurchaseOrigin(path: string) {
  if (/^\/(projects|report)\/[a-f0-9-]{36}$/.test(path)) {
    sessionStorage.setItem(purchaseOriginKey, path);
  }
}

export function purchaseOrigin(orderId?: string) {
  const path =
    sessionStorage.getItem(
      orderId ? "purchase:order:" + orderId : purchaseOriginKey,
    ) || "";
  if (/^\/(projects|report)\/[a-f0-9-]{36}$/.test(path)) return path;
  // A checkout opened before this release may still have stored a project ID.
  const oldId =
    path || (orderId ? "" : sessionStorage.getItem("purchase:project") || "");
  return /^[a-f0-9-]{36}$/.test(oldId) ? "/projects/" + oldId : "";
}

export function forgetPurchaseOrigin() {
  sessionStorage.removeItem(purchaseOriginKey);
  sessionStorage.removeItem("purchase:project");
}

export function TrainingPurchaseLink({ path }: { path: string }) {
  return (
    <a
      className="button secondary"
      href="#/shop"
      onClick={() => rememberPurchaseOrigin(path)}
    >
      查看训练包
    </a>
  );
}

type WatchaCredits = { remaining: number; purchaseUrl?: string | null };

function allowedPurchaseUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "alipays:") &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function WatchaShop({ busy, run }: Actions) {
  const [credits, setCredits] = useState<WatchaCredits | null>(null);
  const [origin] = useState(() => purchaseOrigin());
  const purchaseUrl = allowedPurchaseUrl(credits?.purchaseUrl);

  useEffect(() => {
    const controller = new AbortController();
    void run(async () => {
      const value = await api<WatchaCredits>(
        "/billing/watcha",
        "GET",
        undefined,
        controller.signal,
      );
      if (!controller.signal.aborted) setCredits(value);
    });
    return () => controller.abort();
  }, [run]);

  return (
    <section className="page">
      <PageHead
        eyebrow="训练权益"
        title="训练包"
        text="深挖训练与专项复测每新开一轮使用 1 次。"
      />
      <div className="panel shop-watcha">
        <h2>我的训练次数</h2>
        <p aria-live="polite">
          {credits ? (
            <>
              <strong>{credits.remaining}</strong> 次可用
            </>
          ) : (
            "等待查询"
          )}
        </p>
        <div className="shop-actions">
          {purchaseUrl && (
            <a
              className="button"
              href={purchaseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              前往爱猹收购买
            </a>
          )}
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setCredits(await api<WatchaCredits>("/billing/watcha"));
              })
            }
          >
            刷新训练次数
          </Button>
        </div>
        {purchaseUrl ? (
          <p>完成付款后回到本页，刷新训练次数。</p>
        ) : (
          credits && <p>当前没有可用的购买入口。</p>
        )}
        <a href={"#" + (origin || "/projects")} onClick={forgetPurchaseOrigin}>
          {origin ? "返回原页面" : "前往我的项目"}
        </a>
      </div>
    </section>
  );
}
