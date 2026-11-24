import { useState } from "react";
import { ArrowLeft, ChevronRight, FolderOpen, MessageSquare, RefreshCw } from "lucide-react";
import { go } from "./api";
import type { Training, TrainingSummary, ListPage } from "./types";
import { Empty, Loading, statusLabel, Button } from "./ui";
import type { Actions } from "./ui";
import { useApiResource } from "./use-api-resource";
import { TrainingSelect } from "./training-select";
import { PracticeArchive } from "./practice-archive";
import { exampleApi, practiceHistoryPath } from "./practice-paths";
import "./history.css";

type PracticeRecord = {
  projectId: string;
  roundId: string;
  roundNumber: number;
  name: string;
  status: string;
  answeredCount: number;
  maxTurns: number;
  retestCompleted?: boolean;
  startedAt: number;
  interviewTopic: string;
  totalScore?: number | null;
  hasScoring?: boolean;
  scoredDimensions?: number;
  prioritySuggestion: string;
};

function groupByProject(records: PracticeRecord[]) {
  const projects = new Map<string, PracticeRecord[]>();
  for (const record of records) {
    const rounds = projects.get(record.projectId);
    if (rounds) rounds.push(record);
    else projects.set(record.projectId, [record]);
  }
  for (const rounds of projects.values()) {
    rounds.sort((a, b) => b.roundNumber - a.roundNumber);
  }
  return projects;
}

function practiceSummary(rounds: PracticeRecord[]) {
  const completed = rounds.filter(({ status }) => status === "COMPLETED").length;
  const active = rounds.filter(({ status }) => ["ACTIVE", "GENERATING", "PENDING"].includes(status)).length;
  const failed = rounds.filter(({ status }) => status === "FAILED").length;
  return [`共训练 ${rounds.length} 次`, `已完成 ${completed} 次`,
    active ? `进行中 ${active} 次` : "", failed ? `待恢复 ${failed} 次` : ""].filter(Boolean).join(" · ");
}

const historyDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  hourCycle: "h23",
});

function resumeLabel(record: PracticeRecord) {
  const reporting = record.answeredCount >= record.maxTurns;
  if (record.status === "FAILED") return reporting ? "重试生成报告" : "恢复训练";
  if (record.status === "GENERATING") return "查看进度";
  if (["ACTIVE", "PENDING"].includes(record.status)) return "继续训练";
  return "";
}

function PracticeRound({ record, current, archivePath, resumePath }: {
  record: PracticeRecord;
  current: boolean;
  archivePath: string;
  resumePath: string;
}) {
  const complete = record.status === "COMPLETED";
  const reporting = record.status === "GENERATING" && record.answeredCount >= record.maxTurns;
  const date = new Date(record.startedAt);
  const resume = current ? resumeLabel(record) : "";
  return (
    <article className="practice-history-round">
      <div className="card-icon"><MessageSquare aria-hidden="true" /></div>
      <div>
        <div className="practice-history-round-title">
          <h2>第 {record.roundNumber} 次面试</h2>
          <span className="badge">{reporting ? "报告生成中" : statusLabel[record.status]}</span>
        </div>
        <p className="practice-history-meta">
          {record.interviewTopic && <span>{record.interviewTopic}</span>}
          {record.startedAt > 0 && Number.isFinite(date.getTime()) && (
            <time dateTime={date.toISOString()}>{historyDate.format(date)}</time>
          )}
          <span>已答完 {record.answeredCount} / {record.maxTurns} 题</span>
          {record.retestCompleted && <span>专项复测已完成</span>}
        </p>
        {complete && (
          <div className="practice-history-outcome">
            <strong>
              {typeof record.totalScore === "number" ? `综合分 ${record.totalScore} / 100` :
                record.hasScoring ? "部分维度已评分" : "未评分"}
              {typeof record.totalScore === "number" && typeof record.scoredDimensions === "number" &&
                ` · ${record.scoredDimensions} / 4 项已评分`}
            </strong>
            {record.prioritySuggestion && <p><strong>优先改进</strong> {record.prioritySuggestion}</p>}
          </div>
        )}
      </div>
      <div className="practice-history-actions">
        <a className={"button" + (resume ? " secondary" : "")} href={archivePath}>
          {complete ? "查看报告与对话" : "查看对话"}
        </a>
        {resume && <a className="button" href={resumePath}>{resume}</a>}
      </div>
    </article>
  );
}

function Transcript({ id }: { id: string }) {
  const { data, error, reload } = useApiResource<Training>("/trainings/" + id);
  if (error)
    return (
      <div role="alert">
        {error}{" "}
        <Button secondary onClick={reload}>
          重新读取问答
        </Button>
      </div>
    );
  if (!data) return <Loading />;
  return data.turns.length ? (
    <ol className="archive-turns">
      {data.turns.map((turn, index) => (
        <li key={turn.id}>
          <div className="archive-turn-heading">
            <strong>
              问题 {index + 1} · {turn.topic}
            </strong>
            {turn.answeredAt && (
              <time dateTime={new Date(turn.answeredAt).toISOString()}>
                {new Date(turn.answeredAt).toLocaleString("zh-CN")}
              </time>
            )}
          </div>
          <p className="archive-question">{turn.question}</p>
          <p className="archive-answer">{turn.answer || "尚未提交回答"}</p>
        </li>
      ))}
    </ol>
  ) : (
    <p>尚未生成问题</p>
  );
}

function HistoryRecord({ training: t }: { training: TrainingSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="history-record">
      <a
        className="history-link"
        href={
          "#/" +
          (t.status === "COMPLETED" ? "report" : "trainings") +
          "/" +
          t.id
        }
      >
        <div className="card-icon">
          {t.kind === "RETEST" ? <RefreshCw /> : <MessageSquare />}
        </div>
        <div>
          <h3>{t.project.name}</h3>
          <p>
            {t.kind === "RETEST" ? "专项复测" : "项目深挖"}{" "}
            {t.historyRoundNumber ? "· 第 " + t.historyRoundNumber + " 轮" : ""}
            · {new Date(t.createdAt).toLocaleString("zh-CN")} · 已回答{" "}
            {t.answeredCount} 题
          </p>
        </div>
        <span className="badge">{statusLabel[t.status]}</span>
        <ChevronRight />
      </a>
      <details
        className="archive-details"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>完整问答（{t.turnCount} 题）</summary>
        {open && <Transcript id={t.id} />}
      </details>
    </article>
  );
}

function LegacyHistory({ busy, collapsed, showEmpty }: {
  busy: boolean;
  collapsed: boolean;
  showEmpty: boolean;
}) {
  const [key, setKey] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const page = useApiResource<ListPage<TrainingSummary>>(
    "/training-page?limit=20&offset=" +
      offset +
      "&key=" +
      encodeURIComponent(key),
  );
  const choices = useApiResource<{ key: string; name: string }[]>(
    !collapsed || open ? "/training-projects" : null,
  );
  const hasChoices = !!choices.data?.length;
  if (!page.data && !page.error && !open && !hasChoices) return collapsed ? null : <Loading />;
  if (page.data?.total === 0 && !key && !offset && !hasChoices) {
    return showEmpty ? <Empty
      title="还没有开始训练"
      text="保存项目材料后，即可开始训练。"
      action={() => go("/projects")}
    /> : null;
  }
  const content = (
    <>
      <TrainingSelect label="筛选训练项目" value={key} disabled={busy || !choices.data}
        onChange={value => { setKey(value); setOffset(0); }}
        options={[{ value: "", label: "全部项目" }, ...(choices.data || []).map(choice => ({ value: choice.key, label: choice.name }))]} />
      {choices.error && (
        <p role="alert">
          {choices.error}{" "}
          <Button secondary onClick={choices.reload}>重试项目筛选</Button>
        </p>
      )}
      {page.error ? (
        <div role="alert">
          {page.error}{" "}
          <Button secondary onClick={page.reload}>重新读取记录</Button>
        </div>
      ) : !page.data ? (
        <Loading />
      ) : !page.data.total ? (
        <Empty title="没有匹配的旧版训练" text="选择其他项目可继续回看。" />
      ) : (
        <>
          {page.data.items.map((training) => <HistoryRecord key={training.id} training={training} />)}
          <div className="action-row" aria-label="训练记录分页">
            <Button secondary disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>
              上一页
            </Button>
            <span>第 {Math.floor(offset / 20) + 1} 页 · 共 {page.data.total} 条</span>
            <Button secondary disabled={!page.data.hasMore} onClick={() => setOffset(offset + 20)}>
              下一页
            </Button>
          </div>
        </>
      )}
    </>
  );
  return collapsed ? (
    <details className="panel history-list history-legacy" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>旧版训练记录</summary>
      {open && content}
    </details>
  ) : <div className="panel history-list history-legacy">{content}</div>;
}

type HistoryProps = Actions & { projectId?: string; roundId?: string; example?: boolean; signedIn: boolean };

export function History({ busy, run, projectId, roundId, example = false, signedIn }: HistoryProps) {
  const ownPractice = useApiResource<PracticeRecord[]>(signedIn && (!projectId || !example) ? "/practice-history" : null);
  const examplePractice = useApiResource<PracticeRecord[]>(!projectId || example ? exampleApi + "/practice-history" : null);
  const practice = example ? examplePractice : ownPractice;
  const rounds = projectId ? groupByProject(practice.data ?? []).get(projectId) : undefined;
  const record = rounds?.find(round => round.roundId === roundId);
  const rootPath = "#" + practiceHistoryPath(example);
  const projectHistoryPath = "#" + practiceHistoryPath(example, projectId);
  const retry = practice.error && (
    <div className="panel practice-history-error" role="alert">
      <span>{practice.error}</span>
      <Button secondary onClick={practice.reload}>重新读取项目训练</Button>
    </div>
  );
  if (projectId && roundId) {
    return (
      <section className="page practice-history-page">
        <a className="practice-history-back" href={projectHistoryPath}>
          <ArrowLeft size={16} aria-hidden="true" /> 返回项目训练记录
        </a>
        <div className="page-head">
          <div>
            <h1>{record ? `第 ${record.roundNumber} 次面试` : "面试记录"}</h1>
            {rounds && <p>{rounds[0].name}</p>}
          </div>
        </div>
        <PracticeArchive key={`${projectId}/${roundId}`} projectId={projectId} roundId={roundId} example={example}
          run={run} busy={busy} onScored={practice.reload} />
      </section>
    );
  }
  if (projectId) {
    const id = encodeURIComponent(projectId);
    const resumePath = example ? `#/experience/${id}?from=history` : `#/projects/${id}?interview=1&from=history`;
    return (
      <section className="page practice-history-page">
        <a className="practice-history-back" href={rootPath}>
          <ArrowLeft size={16} aria-hidden="true" /> 返回训练记录
        </a>
        <div className="page-head">
          <div>
            <h1>{rounds?.[0].name || "项目训练记录"}</h1>
            {rounds && <p>{practiceSummary(rounds)}</p>}
          </div>
        </div>
        {retry || (practice.loading ? <Loading /> : rounds ? (
          <section className="panel practice-history-rounds" aria-label="面试记录">
            {rounds.map((round, index) => (
              <PracticeRound key={round.roundId} record={round} current={index === 0}
                archivePath={`${projectHistoryPath}/${encodeURIComponent(round.roundId)}`} resumePath={resumePath} />
            ))}
          </section>
        ) : <Empty title="没有找到这个项目的训练记录" text="返回训练记录查看其他项目。" />)}
      </section>
    );
  }
  const sources = [
    ...(signedIn ? [{ resource: ownPractice, example: false, label: "我的训练记录" }] : []),
    { resource: examplePractice, example: true, label: "示例训练记录" },
  ];
  const projects = sources.flatMap(({ resource, example }) => Array.from(
    groupByProject(resource.data ?? []),
    ([id, trainings]) => ({ href: "#" + practiceHistoryPath(example, id), trainings, example }),
  )).sort((a, b) => b.trainings[0].startedAt - a.trainings[0].startedAt);

  return (
    <section className="page practice-history-page">
      <div className="page-head">
        <div>
          <h1>训练记录</h1>
          <p>按项目回看面试对话和复盘。示例记录在当前浏览器保留 30 天。</p>
        </div>
      </div>
      {sources.map(({ resource, label }) => resource.error && (
        <div key={label} className="panel practice-history-error" role="alert">
          <span>{label}读取失败。{resource.error}</span>
          <Button secondary onClick={resource.reload}>重新读取{label}</Button>
        </div>
      ))}
      {sources.some(({ resource }) => resource.loading) && <Loading />}
      {projects.length > 0 && (
        <section className="panel practice-history-projects" aria-label="项目训练">
          {projects.map(({ href, trainings, example }) => (
            <a className="practice-history-project" key={href} href={href}>
              <div className="card-icon"><FolderOpen aria-hidden="true" /></div>
              <div>
                <div className="practice-history-project-title">
                  <h2>{trainings[0].name || "未命名项目"}</h2>
                  {example && <span className="badge">示例项目</span>}
                </div>
                <p>{practiceSummary(trainings)}</p>
              </div>
              <ChevronRight size={18} aria-hidden="true" />
            </a>
          ))}
        </section>
      )}
      {signedIn
        ? !ownPractice.loading && <LegacyHistory busy={busy} collapsed={!!ownPractice.data?.length}
          showEmpty={ownPractice.data?.length === 0 && examplePractice.data?.length === 0} />
        : examplePractice.data?.length === 0 && <div className="empty">
          <h2>还没有示例训练记录</h2>
          <p>选择一个示例项目，面试进度和复盘会出现在这里。</p>
          <a className="button secondary" href="#/experience">去示例项目</a>
        </div>}
    </section>
  );
}
