import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CalendarClock, Check, Database, Sparkles } from "lucide-react";
import { api, go } from "./api";
import { dimensions, readExperience, samples } from "./experience-data";
import { exampleApi, practiceHistoryPath } from "./practice-paths";
import type { Actions } from "./ui";
import "./competition.css";

const scenarioMeta: Record<string, { icon: typeof Database; level: string }> = {
  booking: { icon: Database, level: "入门 · 并发与一致性" },
  rag: { icon: Sparkles, level: "进阶 · 检索与引用" },
  scheduler: { icon: CalendarClock, level: "进阶 · 幂等与重试" },
};

const scenarioMaterials = [
  ["background", "项目背景"],
  ["architecture", "架构说明"],
  ["implementation", "关键实现"],
  ["verification", "验证记录"],
] as const;

export function ExampleScenarioSelection({ sample, onSelect, onStart, busy, footer }: {
  sample: (typeof samples)[number];
  onSelect: (sample: (typeof samples)[number]) => void;
  onStart: () => void;
  busy?: boolean;
  footer: ReactNode;
}) {
  return (
    <div className="experience-intro">
      <h1 id="scenario-selection-title">选择练习场景</h1>
      <p>
        选一个合成项目，代入实现者回答五轮追问。遇到没把握的问题，可以直接说明不确定。
      </p>
      <div className="experience-selection">
        <div
          className="experience-options"
          role="group"
          aria-label="练习场景"
        >
          {samples.map((s) => {
            const meta = scenarioMeta[s.id];
            const Icon = meta.icon;
            const selected = sample.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                className="experience-option"
                aria-pressed={selected}
                disabled={busy}
              onClick={() => onSelect(s)}
              >
                <span className="experience-option-icon" aria-hidden="true">
                  <Icon size={22} strokeWidth={1.7} />
                </span>
                <span className="experience-option-info">
                  <span className="experience-option-meta">
                    <strong>{s.label}</strong> · {meta.level}
                  </span>
                  <span className="experience-option-name">
                    {s.project.name}
                  </span>
                  <span className="experience-option-stack">
                    {s.project.stack}
                  </span>
                </span>
                <span className="experience-option-check" aria-hidden="true">
                  {selected && <Check size={14} />}
                </span>
                <span className="experience-option-problem">
                  <span>已知问题</span>
                  {s.project.problems}
                </span>
              </button>
            );
          })}
        </div>
        <section className="experience-plan" aria-label="练习预览">
          <div className="experience-plan-scenario">
            <span className="experience-plan-label">当前场景</span>
            <h2>{sample.project.name}</h2>
            <p>{sample.project.responsibility}</p>
          </div>
          <div className="experience-plan-rounds">
            <h3>五轮追问</h3>
            <ol>
              {dimensions.map(({ title, task }) => (
                <li key={title}>
                  <strong>{title}</strong>
                  <span>{task}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <section
          className="experience-material"
          aria-labelledby="experience-material-title"
        >
          <div className="experience-intro-actions">
            <button
              type="button"
              className="button button-lg"
              disabled={busy}
              onClick={onStart}
            >
              开始五轮练习 <ArrowRight size={17} aria-hidden="true" />
            </button>
            <p>{footer}</p>
          </div>
          <h2 id="experience-material-title">练习材料</h2>
          <dl className="experience-material-fields">
            {scenarioMaterials.map(([field, label]) => (
              <div key={field}>
                <dt>{label}</dt>
                <dd>{sample.project[field]}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

export function ExampleProjects({ preferred, run, busy }: Actions & { preferred: string | null }) {
  const [sample, setSample] = useState(() => samples.find(entry => entry.id === preferred) ?? samples[0]);
  const open = () => {
    const source = location.hash;
    void run(async () => {
      const project = await api<{ id: string }>(`${exampleApi}/projects/${sample.id}/open`, "POST");
      if (location.hash === source) go("/experience/" + encodeURIComponent(project.id));
    });
  };
  return (
    <section className="experience-page experience-page--choose" aria-labelledby="scenario-selection-title">
      <div className="experience-top">
        <a href="#/"><ArrowLeft size={16} aria-hidden="true" /> 返回首页</a>
      </div>
      <ExampleScenarioSelection
        sample={sample}
        onSelect={setSample}
        onStart={open}
        busy={busy}
        footer={<>练习结束后可<a href={"#" + practiceHistoryPath(true)}>查看训练记录</a>，回看报告和完整对话。
          {readExperience().started && <> · <a href="#/experience?mode=legacy">查看当前标签页的旧版示例练习</a></>}
        </>}
      />
    </section>
  );
}
