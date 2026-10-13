import React, { useRef, useState } from "react";
import { Upload, FileText, ArrowRight, LoaderCircle, X } from "lucide-react";
import { upload } from "./api";
import type { Project } from "./types";

export type ResumeCandidate = Pick<
  Project,
  | "name"
  | "stack"
  | "targetRole"
  | "background"
  | "responsibility"
  | "resume"
  | "architecture"
  | "implementation"
  | "problems"
  | "verification"
>;
export function ResumeImport({
  disabled,
  onSelect,
  onBusy,
}: {
  disabled: boolean;
  onSelect: (candidate: ResumeCandidate) => void;
  onBusy: (busy: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [filename, setFilename] = useState("");
  const [candidates, setCandidates] = useState<ResumeCandidate[] | null>(null);
  const [consent, setConsent] = useState(false);
  const request = useRef(0);
  const read = async (file: File) => {
    setError("");
    setDuplicate(false);
    setCandidates(null);
    if (file.size > 5 * 1024 * 1024 || !/\.(pdf|docx|txt)$/i.test(file.name)) {
      setError("请上传5MB以内的PDF、DOCX或UTF-8 TXT简历");
      return;
    }
    const serial = ++request.current;
    setBusy(true);
    onBusy(true);
    setFilename(file.name);
    try {
      const result = await upload<{
        projects: ResumeCandidate[];
        duplicate: boolean;
      }>("/resume/import", file, file.name);
      if (serial === request.current) {
        setCandidates(result.projects);
        setDuplicate(result.duplicate === true);
        if (!result.projects.length)
          setError("未识别到项目经历，可换一份简历或手动填写");
      }
    } catch (cause) {
      if (serial === request.current)
        setError(cause instanceof Error ? cause.message : "简历识别失败");
    } finally {
      if (serial === request.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  return (
    <section className="resume-import" aria-label="导入简历">
      <div className="input-tool-heading">
        <h3>
          <FileText size={18} />
          从简历开始
        </h3>
        <button
          type="button"
          className="button secondary"
          disabled={disabled || busy || !consent}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Upload size={16} />
          )}
          {busy ? "正在识别简历" : "导入简历"}
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        aria-label="上传简历文件"
        accept=".pdf,.docx,.txt"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void read(file);
          event.target.value = "";
        }}
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(event) => setConsent(event.target.checked)}
        />
        同意将简历文字发送至模型服务，并在本账号缓存识别结果30天
      </label>
      <p className="material-privacy">
        PDF / DOCX / TXT ·
        最大5MB。请先脱敏；原文件不保存，识别结果仅在本账号复用，选中的经历需另行保存为项目材料。
      </p>
      {busy && (
        <p role="status" className="input-status">
          正在读取 {filename}
        </p>
      )}
      {error && (
        <p role="alert" className="action-error">
          {error}
        </p>
      )}
      {duplicate && (
        <p role="status" className="input-status">
          这份简历已上传过，已读取上次识别结果，不重复调用模型或消耗识别次数。
        </p>
      )}
      {!!candidates?.length && (
        <div className="resume-candidates">
          <div className="panel-heading">
            <strong>识别到 {candidates.length} 个项目</strong>
            <button
              type="button"
              className="icon-button"
              title="关闭识别结果"
              aria-label="关闭识别结果"
              onClick={() => {
                setCandidates(null);
                setDuplicate(false);
              }}
            >
              <X size={16} />
            </button>
          </div>
          {candidates.map((candidate, index) => (
            <article className="resume-candidate" key={index}>
              <div>
                <h3>{candidate.name}</h3>
                <p>{candidate.stack || "简历未注明技术栈"}</p>
                <details>
                  <summary>简历原文</summary>
                  <p>{candidate.resume}</p>
                </details>
                {!candidate.responsibility && (
                  <small className="action-error">
                    未注明个人职责，需要补充后再保存
                  </small>
                )}
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={disabled || busy}
                onClick={() => onSelect(candidate)}
              >
                使用这个项目
                <ArrowRight size={15} />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
