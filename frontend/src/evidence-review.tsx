import type { Finding } from "./types";

export function EvidenceReview({ finding }: { finding: Finding }) {
  const reviewed = finding.evidenceStatus === "MODEL_REVIEWED_NEEDS_HUMAN_REVIEW";
  const spansChecked = reviewed || finding.evidenceStatus === "SOURCE_SPANS_CHECKED_NEEDS_REVIEW";
  return <div className="evidence-review">
    <small>{reviewed
      ? "已做第二次AI语义复核；技术结论仍需人工核对。"
      : spansChecked ? "已逐字核对所引原文片段；判断是否成立仍需人工复核。"
      : "已核对引用来源；技术判断和引用是否支持结论仍需复核。"}</small>
    {spansChecked && !!finding.supportingQuotes?.length && <details>
      <summary>本条判断对应的原文片段</summary>
      {finding.supportingQuotes.map((source, index) => <blockquote key={index}>
        <small>{source.sourceId.startsWith("T") ? "回答片段" : "材料片段"}</small>
        <p>{source.quote}</p>
      </blockquote>)}
    </details>}
  </div>;
}
