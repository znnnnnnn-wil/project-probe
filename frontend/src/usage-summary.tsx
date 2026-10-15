import React, { useEffect, useState } from "react";
import { api } from "./api";

type Usage = { paymentMode: string; started: number; completed: number; failed: number; retests: number;
  reportViews: number; textUsage: { successful_calls: number; prompt_tokens: number; completion_tokens: number;
    elapsed_ms: number; estimated_cost_micros: number; unpriced_calls: number } };
export function UsageSummary() {
  const [data, setData] = useState<Usage | null>(null);
  useEffect(() => { const controller = new AbortController();
    api<Usage>("/account/usage", "GET", undefined, controller.signal).then(setData).catch(() => {});
    return () => controller.abort();
  }, []);
  return <section className="panel"><h2>我的训练与调用记录</h2>{data ? <>
    <p>当前支付环境：{data.paymentMode}。完整训练 {data.started} 轮，已完成 {data.completed} 轮，待恢复失败 {data.failed} 轮，复测 {data.retests} 轮。</p>
    <p>成功文本响应 {data.textUsage.successful_calls} 次，输入 {data.textUsage.prompt_tokens} / 输出 {data.textUsage.completion_tokens} token，累计响应耗时 {(data.textUsage.elapsed_ms / 1000).toFixed(1)} 秒。</p>
    <p>{data.textUsage.unpriced_calls > 0 || data.textUsage.successful_calls === 0 ? "未配置完整单价或没有调用记录，无法给出完整费用估算。" :
      `按运营者配置单价估算 ¥${(data.textUsage.estimated_cost_micros / 1000000).toFixed(4)}`}</p>
    <p>统计自此功能启用起记录；费用不含ASR、失败请求、重试和服务器成本，不代表平台账单或套餐毛利。一题体验单独记录，不计入完整训练。</p>
  </> : <p>暂未读取到统计，请稍后重新打开账户页。</p>}</section>;
}
