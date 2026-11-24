import type { Project } from "./types";

export type MaterialField = Exclude<
  keyof Project,
  "id" | "version" | "facts" | "factsConfirmed"
>;

export const projectFields: [MaterialField, string, string][] = [
  ["name", "项目名称", "例如：校园自习室预约系统"],
  ["targetRole", "目标岗位", "例如：Java 后端实习"],
  ["stack", "技术栈", "例如：Spring Boot / PostgreSQL"],
  ["background", "项目简介", "为谁解决什么问题？整体介绍这个项目"],
  ["resume", "项目经历", "粘贴简历中的项目经历原文，或写清你做过的工作"],
];

const shortFields = ["name", "targetRole", "stack"];

const legacyMaterialFields = [
  ["responsibility", "个人职责"],
  ["architecture", "项目架构"],
  ["implementation", "实现细节"],
  ["problems", "问题与难点"],
  ["verification", "验证方式"],
  ["materials", "补充材料"],
] as const;

export function mergeLegacyMaterials(project: Project) {
  const next = { ...project };
  const sections = legacyMaterialFields.flatMap(([field, title]) => {
    const value = project[field];
    next[field] = "";
    return value?.trim() ? [`${title}\n${value}`] : [];
  });
  if (sections.length)
    next.resume = [project.resume, ...sections].filter(Boolean).join("\n\n");
  return { project: next, migrated: sections.length > 0 };
}

export function ProjectFields({
  project,
  onChange,
  allowResumeOverflow = false,
}: {
  project: Project;
  onChange: (field: MaterialField, value: string) => void;
  allowResumeOverflow?: boolean;
}) {
  return (
    <div className="form-fields">
      {projectFields.map(([key, label, placeholder]) => {
        const isShort = shortFields.includes(key);
        return (
          <label key={key} className={isShort ? undefined : "wide"}>
            {label}
            {isShort ? (
              <input
                value={project[key] ?? ""}
                placeholder={placeholder}
                maxLength={key === "name" ? 100 : 12000}
                onChange={(event) => onChange(key, event.target.value)}
                required={key === "name"}
              />
            ) : (
              <textarea
                rows={key === "resume" ? 6 : 3}
                value={project[key] ?? ""}
                placeholder={placeholder}
                maxLength={
                  key === "resume" && allowResumeOverflow ? undefined : 12000
                }
                onChange={(event) => onChange(key, event.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}