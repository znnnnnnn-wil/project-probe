import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Check, PencilLine, Sparkles, Upload, X } from "lucide-react";
import { api, demoProject, emptyProject, go } from "./api";
import { ProjectFields, projectFields, mergeLegacyMaterials } from "./project-fields";
import type { MaterialField } from "./project-fields";
import { ResumeImport } from "./resume-import";
import type { ResumeCandidate } from "./resume-import";
import type { Project } from "./types";
import { Button } from "./ui";
import type { Actions } from "./ui";
import { useMounted } from "./use-read-scope";
import "./editor.css";

const manualKey = "project-draft:new";
const resumeKey = "project-resume-draft:new";
const blankProject = { ...emptyProject, targetRole: "" };
const entryModes = [
  { value: "manual", label: "手动填写", Icon: PencilLine },
  { value: "resume", label: "上传简历", Icon: Upload },
] as const;

type ImportedProject = { key: string; project: Project };
type ResumeDraft = { requestKey: string; projects: ImportedProject[] };

function readDraft<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null") as T | null;
  } catch {
    return null;
  }
}

function readResumeDraft(): ResumeDraft | null {
  const saved = readDraft<ResumeDraft>(resumeKey);
  return typeof saved?.requestKey === "string" &&
    Array.isArray(saved.projects) &&
    saved.projects.length > 0 &&
    saved.projects.every(
      (entry) =>
        typeof entry?.key === "string" &&
        typeof entry.project?.name === "string" &&
        typeof entry.project.resume === "string",
    )
    ? { ...saved, projects: saved.projects.map(entry => ({
        ...entry, project: mergeLegacyMaterials({ ...blankProject, ...entry.project }).project,
      })) }
    : null;
}

function updateDraft<T>(key: string, data: T | null) {
  if (data === null) sessionStorage.removeItem(key);
  else sessionStorage.setItem(key, JSON.stringify(data));
}

function ImportedProjectFields({
  entry,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  entry: ImportedProject;
  index: number;
  disabled: boolean;
  onChange: (field: MaterialField, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset className="imported-project" disabled={disabled}>
      <legend>项目 {index + 1}</legend>
      <button
        type="button"
        className="text-link imported-project-remove"
        aria-label={`从本次导入中移除项目 ${index + 1}`}
        onClick={onRemove}
      >
        <X size={15} /> 移除
      </button>
      <ProjectFields project={entry.project} onChange={onChange} allowResumeOverflow />
    </fieldset>
  );
}

export function NewProject({ run, busy }: Actions) {
  const mounted = useMounted();
  const saving = useRef(false);
  const [manual, setManual] = useState(() => {
    const saved = readDraft<Project>(manualKey);
    return typeof saved?.name === "string" &&
      typeof saved.background === "string"
      ? mergeLegacyMaterials({ ...blankProject, ...saved }).project
      : null;
  });
  const [imported, setImported] = useState(readResumeDraft);
  const [mode, setMode] = useState<"manual" | "resume">(() =>
    imported ? "resume" : "manual",
  );
  const [importBusy, setImportBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const disabled = busy || importBusy;
  const entries = imported?.projects ?? [];
  const longResume = (mode === "resume" ? entries.map(entry => entry.project) : [manual ?? blankProject])
    .findIndex(project => project.resume.length > 12000);

  const updateManual = (project: Project | null) => {
    setManual(project);
    updateDraft(manualKey, project);
  };
  const updateImported = (projects: ImportedProject[]) => {
    const draft = projects.length
      ? { projects, requestKey: crypto.randomUUID() }
      : null;
    setImported(draft);
    updateDraft(resumeKey, draft);
  };
  useEffect(() => {
    if (!manual && !imported) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [manual, imported]);

  const acceptResume = (candidates: ResumeCandidate[]) => {
    if (
      imported &&
      !window.confirm("要用这次识别的项目替换当前的简历项目草稿吗？")
    )
      return;
    setFormError("");
    updateImported(
      candidates.map((candidate) => ({
        key: crypto.randomUUID(),
        project: mergeLegacyMaterials({ ...blankProject, ...candidate }).project,
      })),
    );
  };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || saving.current || longResume >= 0) return;
    const batch = mode === "resume" ? imported : null;
    if (mode === "resume" && !batch) return;
    const projects = batch
      ? batch.projects.map(({ project }) => project)
      : [manual ?? blankProject];
    const missing = projects.findIndex(
      (project) => !project.name.trim(),
    );
    if (missing >= 0) {
      setFormError(
        batch
          ? `请填写项目 ${missing + 1} 的名称。`
          : "请填写项目名称。",
      );
      return;
    }

    saving.current = true;
    setFormError("");
    void run(async () => {
      try {
        const saved = batch
          ? await api<Project[]>("/projects/batch", "POST", {
              projects,
              requestKey: batch.requestKey,
            })
          : [await api<Project>("/projects", "POST", projects[0])];
        if (!mounted.current) return;
        if (batch) {
          setImported(null);
          updateDraft(resumeKey, null);
        } else updateManual(null);
        go(saved.length === 1 ? "/projects/" + saved[0].id : "/projects");
      } finally {
        saving.current = false;
      }
    });
  };

  return (
    <section className="page editor-page new-project-page">
      <div className="page-head">
        <h1>新建项目</h1>
        <a className="button secondary" href="#/projects">
          返回项目列表
        </a>
      </div>
      <div className="materials-panel">
        <div
          className="new-project-modes segmented"
          role="group"
          aria-label="项目材料录入方式"
        >
          {entryModes.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={disabled}
              onClick={() => {
                setMode(value);
                setFormError("");
              }}
            >
              <Icon size={16} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        {mode === "resume" && (
          <ResumeImport
            disabled={busy}
            onBusy={setImportBusy}
            onProjects={acceptResume}
          />
        )}
        {(mode === "manual" || entries.length > 0) && (
          <form onSubmit={save}>
            {mode === "manual" ? (
              <fieldset
                className="manual-project"
                disabled={disabled}
                aria-label="项目材料"
              >
                <div className="panel-heading">
                  <p>填写项目名称即可保存，其余信息按需补充。</p>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => {
                      if (
                        manual &&
                        projectFields.some(
                          ([key]) => manual[key] !== blankProject[key],
                        ) &&
                        !window.confirm(
                          "载入合成示例会替换手动填写的草稿。是否继续？",
                        )
                      )
                        return;
                      updateManual({
                        ...blankProject,
                        name: demoProject.name,
                        targetRole: demoProject.targetRole,
                        stack: demoProject.stack,
                        background: demoProject.background,
                        resume: demoProject.resume,
                      });
                      setFormError("");
                    }}
                  >
                    载入合成示例 <Sparkles size={14} />
                  </button>
                </div>
                <ProjectFields
                  project={manual ?? blankProject}
                  allowResumeOverflow
                  onChange={(field, value) =>
                    updateManual({ ...blankProject, ...manual, [field]: value })
                  }
                />
              </fieldset>
            ) : (
              <div className="imported-projects">
                <p>
                  已识别 {entries.length}{" "}
                  个项目。保存前可以编辑各项目的材料，也可以移除不需要的项目。
                </p>
                {entries.map((entry, index) => (
                  <ImportedProjectFields
                    key={entry.key}
                    entry={entry}
                    index={index}
                    disabled={disabled}
                    onChange={(field, value) =>
                      updateImported(
                        entries.map((item) =>
                          item.key === entry.key
                            ? {
                                ...item,
                                project: { ...item.project, [field]: value },
                              }
                            : item,
                        ),
                      )
                    }
                    onRemove={() => {
                      setFormError("");
                      updateImported(
                        entries.filter((item) => item.key !== entry.key),
                      );
                    }}
                  />
                ))}
              </div>
            )}
            {longResume >= 0 && <p className="action-error" role="alert">
              {mode === "resume" && `项目 ${longResume + 1} 的`}项目经历超过 12000 字，全文已保留。请整理至 12000 字以内后保存。
            </p>}
            {formError && (
              <p className="action-error" role="alert">
                {formError}
              </p>
            )}
            <div className="form-bottom">
              <Button type="submit" disabled={disabled || longResume >= 0}>
                {mode === "resume"
                  ? `保存 ${entries.length} 个项目`
                  : "保存项目材料"}
                <Check size={16} />
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
