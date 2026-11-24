import exampleProjects from "../../backend/src/main/resources/example-projects.json" with { type: "json" };
import { emptyProject } from "./api";
import type { Project } from "./types";

export const samples: { id: string; label: string; project: Project }[] =
  exampleProjects.map(sample => ({ ...sample, project: { ...emptyProject, ...sample.project } }));

export const dimensions = [
  {
    title: "个人职责",
    field: "responsibility",
    label: "个人职责",
    task: "选一个亲自实现的功能，列清自己与协作者的工作边界。",
  },
  {
    title: "实现机制",
    field: "implementation",
    label: "关键实现",
    task: "画出一次请求的处理顺序，说明约束或判断具体放在哪里。",
  },
  {
    title: "失败边界",
    field: "problems",
    label: "已知问题",
    task: "补充一个失败场景，记录失败前后的状态与恢复方式。",
  },
  {
    title: "验证证据",
    field: "verification",
    label: "验证记录",
    task: "设计一个可复跑的用例，区分测试计划和已经观察到的结果。",
  },
  {
    title: "方案取舍",
    field: "architecture",
    label: "架构说明",
    task: "明确一个变化条件，比较两个方案，并说明适用边界。",
  },
] as const;

export type Experience = {
  version: 1;
  sample: string;
  started: boolean;
  answers: string[];
  draft: string;
  notes: string[];
  checked: boolean[];
};
export const experienceKey = "project-probe:experience:v1";
export const freshExperience = (sample = "booking"): Experience => ({
  version: 1,
  sample,
  started: false,
  answers: [],
  draft: "",
  notes: Array(5).fill(""),
  checked: Array(5).fill(false),
});

export function readExperience(): Experience {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(experienceKey) || "null",
    );
    if (!value || typeof value !== "object") return freshExperience();
    const s = value as Experience;
    if (
      s.version !== 1 ||
      !samples.some((p) => p.id === s.sample) ||
      typeof s.started !== "boolean" ||
      !Array.isArray(s.answers) ||
      s.answers.length > 5 ||
      !s.answers.every(
        (a) => typeof a === "string" && a.trim().length > 0 && a.length <= 3000,
      ) ||
      typeof s.draft !== "string" ||
      s.draft.length > 3000 ||
      !Array.isArray(s.notes) ||
      s.notes.length !== 5 ||
      !s.notes.every((n) => typeof n === "string" && n.length <= 1000) ||
      !Array.isArray(s.checked) ||
      s.checked.length !== 5 ||
      !s.checked.every((c) => typeof c === "boolean")
    )
      return freshExperience();
    return s;
  } catch {
    return freshExperience();
  }
}

const sampleQuestions: Record<string, string[]> = {
  booking: [
    "请从预约创建接口中，选一个你亲自实现的步骤，说明你负责到哪里。",
    "材料写到同一座位、同一时段的有效预约唯一。两个请求同时预约时，这个约束具体怎样生效？",
    "假设数据库已写入预约，但响应在途中丢失；用户重试时，你会怎样处理？",
    "材料把并发验证写为计划。你会怎样构造一个用例，核对最终只有一笔有效预约？",
    "假设预约改为任意起止时间，原来的同一时段唯一约束还够用吗？请解释你会怎样调整。",
  ],
  rag: [
    "请选一个你亲自实现的检索步骤，说明它接收什么、输出什么。",
    "材料提到保存段落编号。你会怎样让回答中的具体结论对应到正确的原文段落？",
    "材料提到尚无拒答规则。如果召回片段与问题无关，你希望系统怎样处理？",
    "你会怎样准备一组固定的问题与正确出处，验证检索是否比修改前更好？",
    "假设模型不变、只能调整检索，你会先修改切分还是召回策略？请说明选择依据。",
  ],
  scheduler: [
    "请沿着一条通知任务，选一个你亲自实现的状态变化，说明职责边界。",
    "两个实例同时领取同一条任务时，你怎样利用条件更新判断谁可以执行？",
    "通知已发送但接口返回超时，你会怎样判断这条任务应不应该重试？",
    "材料说明多实例尚未验证。请设计一个竞争领取的用例，说明要观察什么结果。",
    "假设实例在领取后立即退出，你会怎样让任务恢复，同时控制重复发送风险？",
  ],
};

export function sampleQuestionFor(sample: string, index: number): string {
  return sampleQuestions[sample][index];
}

export function questionFor(
  sample: string,
  index: number,
  answers: string[],
): string {
  const project = samples.find((p) => p.id === sample)!.project;
  const previous = answers.at(-1)?.replace(/\s+/g, " ").slice(0, 48);
  return (
    (previous
      ? `上一题你写到“${previous}${answers.at(-1)!.replace(/\s+/g, " ").length > 48 ? "…" : ""}”。\n\n`
      : `围绕「${project.name}」：\n\n`) + sampleQuestionFor(sample, index)
  );
}

export function exportExperience(state: Experience): string {
  const project = samples.find((p) => p.id === state.sample)!.project;
  return [
    "# 项目追问官 · 五轮练习复盘",
    `\n项目：${project.name}`,
    "\n模式：本地规则演示；问答与自查结果不构成 AI 技术评估。",
    "\n材料为合成示例，回答和笔记为用户自述。",
    ...state.answers.flatMap((answer, i) => [
      `\n## ${i + 1}. ${dimensions[i].title}`,
      `\n问题：${questionFor(state.sample, i, state.answers.slice(0, i))}`,
      `\n材料原文（${dimensions[i].label}）：${project[dimensions[i].field]}`,
      `\n我的回答：\n${answer}`,
      `\n建议核对：${dimensions[i].task}`,
      `\n自查：${state.checked[i] ? "已自行核对，未经独立验证" : "待核对"}`,
      `\n补充笔记：${state.notes[i] || "未填写"}`,
    ]),
  ].join("\n");
}
