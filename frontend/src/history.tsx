import { useState } from "react";
import { ChevronRight, MessageSquare, RefreshCw } from "lucide-react";
import { go } from "./api";
import type { Training, TrainingSummary, ListPage } from "./types";
import { Empty, Loading, PageHead, statusLabel, Button } from "./ui";
import type { Actions } from "./ui";
import { useApiResource } from "./use-api-resource";
import { TrainingSelect } from "./training-select";

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

export function History(_props: Actions) {
  const [key, setKey] = useState("");
  const [offset, setOffset] = useState(0);
  const page = useApiResource<ListPage<TrainingSummary>>(
    "/training-page?limit=20&offset=" +
      offset +
      "&key=" +
      encodeURIComponent(key),
  );
  const choices =
    useApiResource<{ key: string; name: string }[]>("/training-projects");
  return (
    <section className="page">
      <PageHead
        eyebrow="每一步都有记录"
        title="训练记录"
        text="刷新或离开页面不会丢失已提交的回答，继续原训练不重复扣次。"
      />
      <div className="panel history-list">
        <TrainingSelect label="筛选训练项目" value={key} disabled={_props.busy || !choices.data}
          onChange={value => { setKey(value); setOffset(0); }}
          options={[{ value: "", label: "全部项目" }, ...(choices.data || []).map(choice => ({ value: choice.key, label: choice.name }))]} />
        {choices.error && (
          <p role="alert">
            {choices.error}{" "}
            <Button secondary onClick={choices.reload}>
              重试项目筛选
            </Button>
          </p>
        )}
        {page.error ? (
          <div role="alert">
            {page.error}{" "}
            <Button secondary onClick={page.reload}>
              重新读取记录
            </Button>
          </div>
        ) : !page.data ? (
          <Loading />
        ) : !page.data.total ? (
          <Empty
            title="还没有开始训练"
            text="先创建并核对项目档案，开始你的第一次深挖。"
            action={() => go("/projects")}
          />
        ) : (
          <>
            {page.data.items.map((training) => (
              <HistoryRecord key={training.id} training={training} />
            ))}
            <div className="action-row" aria-label="训练记录分页">
              <Button
                secondary
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                上一页
              </Button>
              <span>
                第 {Math.floor(offset / 20) + 1} 页 · 共 {page.data.total} 条
              </span>
              <Button
                secondary
                disabled={!page.data.hasMore}
                onClick={() => setOffset(offset + 20)}
              >
                下一页
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
