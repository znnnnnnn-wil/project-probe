import { useEffect, useRef, useState } from "react";
import { Upload, ArrowRight, LoaderCircle, X } from "lucide-react";
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

type ResumeImportProps = {
  disabled: boolean;
  onBusy: (busy: boolean) => void;
} & (
  | { onProjects: (candidates: ResumeCandidate[]) => void; onSelect?: never }
  | { onSelect: (candidate: ResumeCandidate) => void; onProjects?: never }
);

export function ResumeImport({ disabled, onSelect, onProjects, onBusy }: ResumeImportProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState("");
  const [candidates, setCandidates] = useState<ResumeCandidate[]>([]);
  const [consent, setConsent] = useState(false);
  const request = useRef<AbortController | null>(null);
  const busy = !!pendingFile;
  useEffect(() => () => request.current?.abort(), []);

  const read = async (file: File) => {
    if (disabled || !consent || request.current) return;
    setError("");
    setDuplicate(false);
    setWarnings([]);
    if (file.size > 5 * 1024 * 1024 || !/\.(pdf|docx|txt)$/i.test(file.name)) {
      setError("请上传 5 MB 以内的 PDF、DOCX 或 UTF-8 TXT 简历");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPendingFile(file.name);
    onBusy(true);
    try {
      const result = await upload<{
        projects: ResumeCandidate[];
        duplicate: boolean;
        warnings?: string[];
      }>("/resume/import", file, file.name, {}, controller.signal);
      if (controller.signal.aborted) return;
      setDuplicate(result.duplicate === true);
      setWarnings(result.warnings ?? []);
      if (!result.projects.length) {
        setError("未识别到项目经历，可换一份简历或手动填写。");
      } else if (onProjects) {
        onProjects(result.projects);
      } else {
        setCandidates(result.projects);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "简历识别失败");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) {
        setPendingFile("");
        onBusy(false);
      }
    }
  };
  return (
    <section className="resume-import" aria-label="导入简历">
      <div className="input-tool-heading">
        <span>PDF、DOCX、TXT，最大 5 MB</span>
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
        disabled={disabled || busy || !consent}
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
      <p className="input-status">请先脱敏。原文件不保存。</p>
      {busy && (
        <p role="status" className="input-status">
          正在识别 {pendingFile}
        </p>
      )}
      {error && (
        <p role="alert" className="action-error">
          {error}
        </p>
      )}
      {duplicate && (
        <p role="status" className="input-status">
          这份简历已上传过，本次使用上次的识别结果。
        </p>
      )}
      {warnings.length > 0 && (
        <div className="input-status" role="status">
          {warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </div>
      )}
      {onSelect && candidates.length > 0 && (
        <div className="resume-candidates">
          <div className="panel-heading">
            <strong>识别到 {candidates.length} 个项目</strong>
            <button
              type="button"
              className="icon-button"
              title="关闭识别结果"
              aria-label="关闭识别结果"
              onClick={() => {
                setCandidates([]);
                setDuplicate(false);
                setWarnings([]);
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
                {!candidate.background && !candidate.resume && (
                  <small className="action-error">
                    未注明项目简介或经历，建议补充后再保存
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
