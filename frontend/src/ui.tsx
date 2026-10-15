import React from "react";
import { ArrowRight, FolderOpen, LoaderCircle } from "lucide-react";

export const sourceLabel: Record<string, string> = {
  USER_PROVIDED: "材料提供",
  INTERVIEW_SUPPLEMENT: "面试补充",
  AI_INFERENCE: "AI 推断",
  NEEDS_CONFIRMATION: "待确认",
};
export class PageBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="empty" role="alert">
        <h2>页面暂时无法显示</h2>
        <p>已提交的内容仍保存在服务端，请重新加载后继续。</p>
        <button className="button" onClick={() => location.reload()}>
          重新加载页面
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export const statusLabel: Record<string, string> = {
  ACTIVE: "进行中",
  PENDING: "待生成",
  GENERATING: "生成中",
  FAILED: "可重试",
  COMPLETED: "已完成",
  REFUNDED: "已返还",
};
export function Button({
  children,
  onClick,
  secondary = false,
  disabled = false,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      className={"button " + (secondary ? "secondary" : "")}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export type Actions = {
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
};
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" />
      <p>正在读取记录…</p>
    </div>
  );
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: () => void;
}) {
  return (
    <div className="empty">
      <FolderOpen size={32} />
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <Button onClick={action}>
          开始准备 <ArrowRight size={16} />
        </Button>
      )}
    </div>
  );
}
export function PageHead({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="section-kicker">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
