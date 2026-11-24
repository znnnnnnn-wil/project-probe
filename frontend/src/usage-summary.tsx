import React, { useEffect, useState } from "react";
import { api } from "./api";

type Usage = { started: number; completed: number; failed: number; retests: number;
  textUsage: { successful_calls: number; prompt_tokens: number; completion_tokens: number; elapsed_ms: number } };
export function UsageSummary() {
  const [data, setData] = useState<Usage | null>(null);
  useEffect(() => { const controller = new AbortController();
    api<Usage>("/account/usage", "GET", undefined, controller.signal).then(setData).catch(() => {});
    return () => controller.abort();
  }, []);
  return <section className="panel"><h2>我的训练与调用记录</h2>{data ? <>
    <p>已开启 {data.started} 轮，已完成 {data.completed} 轮，待恢复 {data.failed} 轮，复测 {data.retests} 轮。</p>
    <p>成功文本响应 {data.textUsage.successful_calls} 次，输入 {data.textUsage.prompt_tokens} / 输出 {data.textUsage.completion_tokens} token，累计响应耗时 {(data.textUsage.elapsed_ms / 1000).toFixed(1)} 秒。</p>
  </> : <p>暂未读取到统计，请稍后重新打开账户页。</p>}</section>;
}
