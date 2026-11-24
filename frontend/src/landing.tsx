import { useState } from "react";
import { ArrowLeft, ArrowRight, CalendarClock, Database, FileText } from "lucide-react";
import { dimensions, samples, sampleQuestionFor } from "./experience-data";
import "./landing.css";

const scenarioMeta: Record<
  string,
  { icon: typeof Database; description: string; implementationFocus: string }
> = {
  booking: {
    icon: Database,
    description: "并发预约、冲突处理与验证",
    implementationFocus: "同一座位同一时段的有效预约唯一",
  },
  rag: {
    icon: FileText,
    description: "文档切分、检索与引用溯源",
    implementationFocus: "保存文档名和段落编号",
  },
  scheduler: {
    icon: CalendarClock,
    description: "任务领取、重试与幂等",
    implementationFocus: "使用更新行数判断是否领取成功",
  },
};

const dimensionNames = ["职责", "实现", "失败", "验证", "取舍"];
const experienceHref = (sample: string) => `#/experience?sample=${sample}`;

function MaterialExcerpt({ text, focus }: { text: string; focus?: string }) {
  const start = focus ? text.indexOf(focus) : -1;
  if (!focus || start === -1) return text;
  const sentenceStart = text.lastIndexOf("。", start) + 1;
  const sentenceEnd = text.indexOf("。", start + focus.length);
  return (
    <>
      {text.slice(sentenceStart, start)}
      <mark>{focus}</mark>
      {text.slice(start + focus.length, sentenceEnd === -1 ? undefined : sentenceEnd + 1)}
    </>
  );
}

function PracticePreview({
  sample,
  onSampleChange,
}: {
  sample: (typeof samples)[number];
  onSampleChange: (id: string) => void;
}) {
  const [index, setIndex] = useState(1);
  const dimension = dimensions[index];
  const question =
    sample.id === "booking" && index === 1
      ? "两个请求同时查到“空闲”，最后谁保证只有一笔预约？"
      : sampleQuestionFor(sample.id, index);

  return (
    <article className="probe-preview" aria-labelledby="probe-preview-title">
      <div className="probe-preview-head">
        <h2 id="probe-preview-title">练习预览</h2>
        <select
          className="probe-sample-select"
          aria-label="切换示例项目"
          value={sample.id}
          onChange={(event) => onSampleChange(event.target.value)}
        >
          {samples.map((item) => (
            <option key={item.id} value={item.id}>{item.project.name}</option>
          ))}
        </select>
      </div>
      <div className="probe-preview-body">
        <div className="probe-preview-rounds" role="group" aria-label="追问维度">
          {dimensions.map((item, i) => (
            <button
              type="button"
              key={item.field}
              aria-pressed={index === i}
              onClick={() => setIndex(i)}
            >
              <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              {dimensionNames[i]}
            </button>
          ))}
        </div>
        <div className="probe-preview-content" aria-live="polite">
          <div>
            <p className="probe-source-label">材料原文 · {dimension.label}</p>
            <blockquote className="probe-source">
              <MaterialExcerpt
                text={sample.project[dimension.field]}
                focus={index === 1 ? scenarioMeta[sample.id].implementationFocus : undefined}
              />
            </blockquote>
          </div>
          <div className="probe-question">
            <div className="probe-question-meta">
              <strong>{dimension.title}</strong>
              <span>{String(index + 1).padStart(2, "0")} / {String(dimensions.length).padStart(2, "0")}</span>
            </div>
            <h3>{question}</h3>
            <p>{dimension.task}</p>
          </div>
        </div>
      </div>
      <div className="probe-preview-foot">
        <span>规则示例 · 追问可核对原文</span>
        <div className="probe-preview-paging" role="group" aria-label="切换示例问题">
          <button type="button" aria-label="上一问" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" aria-label="下一问" disabled={index === dimensions.length - 1} onClick={() => setIndex(index + 1)}>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function Home({
  onStart,
  backendReady,
}: {
  onStart: () => void;
  backendReady: boolean;
}) {
  const [selected, setSelected] = useState(samples[0].id);
  const sample = samples.find((item) => item.id === selected) ?? samples[0];

  return (
    <div className="competition-home">
      <section className="probe-hero" aria-labelledby="probe-headline">
        <div className="probe-shell probe-hero-grid">
          <div className="probe-hero-copy">
            <p className="probe-hero-label">项目面试练习</p>
            <h1 id="probe-headline">把项目经历，<br />讲清楚。</h1>
            <p className="probe-hero-intro">
              围绕项目原文回答五轮追问。把你负责什么、怎么实现、怎么验证，讲成面试官能听懂的细节。
            </p>
            <div className="probe-hero-actions">
              <a className="button" href={experienceHref(sample.id)}>
                开始示例练习 <ArrowRight size={16} aria-hidden="true" />
              </a>
              <button className="button secondary" type="button" onClick={onStart} disabled={!backendReady}>
                用我的项目练习
              </button>
            </div>
            {!backendReady && <p className="probe-backend-note">自有项目练习需连接服务。</p>}
          </div>
          <PracticePreview sample={sample} onSampleChange={setSelected} />
        </div>
      </section>

      <section className="probe-shell probe-library" aria-labelledby="probe-library-title">
        <h2 id="probe-library-title">选一个示例项目</h2>
        <p>练完可以对照项目材料，回看每道问题和你的原回答。</p>
        <div className="probe-sample-grid">
          {samples.map((item) => {
            const { icon: Icon, description } = scenarioMeta[item.id];
            return (
              <a key={item.id} className="probe-sample-card" href={experienceHref(item.id)}>
                <span className="probe-sample-icon"><Icon size={18} aria-hidden="true" /></span>
                <span className="probe-sample-copy">
                  <strong>{item.project.name}</strong>
                  <small>{description}</small>
                </span>
                <ArrowRight className="probe-sample-arrow" size={16} aria-hidden="true" />
              </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}
