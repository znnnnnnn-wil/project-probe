import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CameraOff,
  Check,
  CheckCheck,
  ChevronDown,
  Download,
  FileText,
  Maximize2,
  MessageSquare,
  Mic,
  RotateCcw,
  ShieldCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import { go } from "./api";
import {
  dimensions,
  exportExperience,
  experienceKey,
  freshExperience,
  questionFor,
  readExperience,
  samples,
} from "./experience-data";
import { InterviewerAvatar } from "./interviewer-avatar";
import { ExperienceVoice } from "./experience-voice";
import { useCameraPreview, useQuestionSpeech } from "./use-interviewer-media";
import { useFacePresence } from "./use-face-presence";
import "./competition.css";
import "./project-practice.css";
import { QuickExperience } from "./quick-experience";
import { ExampleScenarioSelection } from "./example-projects";

export function ExperiencePage() {
  const params = new URLSearchParams(location.hash.split("?")[1]);
  if (params.get("mode") === "quick") return <QuickExperience />;
  return readExperience().started ? <FullExperience /> : (
    <section className="page"><a className="button secondary" href="#/experience">返回示例项目</a></section>
  );
}

function FullExperience() {
  const [state, setState] = useState(() => {
    const saved = readExperience();
    const selected = new URLSearchParams(location.hash.split("?")[1]).get(
      "sample",
    );
    return !saved.started && samples.some((p) => p.id === selected)
      ? freshExperience(selected!)
      : saved;
  });
  const [storageError, setStorageError] = useState("");
  const [view, setView] = useState<number | null>(null);
  const questionHead = useRef<HTMLHeadingElement>(null);
  const sample = samples.find((s) => s.id === state.sample)!;
  const complete = state.answers.length === 5;
  const index = Math.min(state.answers.length, 4);
  const shown = view ?? index;
  const [muted, setMuted] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [playedQuestion, setPlayedQuestion] = useState("");
  const {
    speaking,
    preparing,
    speak,
    stop,
    unlock,
    supported: speechSupported,
    mouthLevel,
  } = useQuestionSpeech(false);
  const camera = useCameraPreview();
  const { presence, snapshot: face } = useFacePresence(
    camera.on ? camera.stream : null,
  );
  const transcript = useRef<HTMLOListElement>(null);
  const currentQuestion = questionFor(
    state.sample,
    shown,
    state.answers.slice(0, shown),
  );
  useEffect(() => {
    if (!state.started || complete || view !== null || muted) stop();
    else {
      speak(currentQuestion);
      setPlayedQuestion(currentQuestion);
    }
  }, [state.started, complete, view, muted, currentQuestion, speak, stop]);
  const listening = voiceBusy || face.speaking;
  const avatarState = speaking ? "speaking" : listening ? "listening" : "idle";
  const avatarStatus = speaking
    ? "面试官正在提问"
    : listening
      ? "正在听你的回答"
      : face.face
        ? "面试官正在看着你"
        : "等待你的回答";
  const stageVisible = state.started && !complete;
  useEffect(() => {
    if (!stageVisible) camera.stop();
  }, [stageVisible, camera.stop]);
  useLayoutEffect(() => {
    if (transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [state.answers.length, view]);
  const [roomOpen, setRoomOpen] = useState(false);
  const [voiceRoom, setVoiceRoom] = useState(false);
  const [workspaceSurface] = useState(() => document.createElement("div"));
  const inlineContent = useRef<HTMLDivElement>(null);
  const roomContent = useRef<HTMLDivElement>(null);
  const roomDialog = useRef<HTMLDialogElement>(null);
  const inRoom = roomOpen && state.started && !complete;
  const handsFree = inRoom && voiceRoom;
  const openRoom = (voice = false) => {
    unlock();
    if (voice && view === null && !muted && !speaking && !preparing) {
      speak(currentQuestion);
    }
    setVoiceRoom(voice);
    setRoomOpen(true);
  };
  const closeRoom = () => {
    setVoiceRoom(false);
    setRoomOpen(false);
  };
  useLayoutEffect(() => {
    const dialog = roomDialog.current;
    const destination = inRoom ? roomContent.current : inlineContent.current;
    // 面试室与内联视图共用同一棵子树，移动容器即可保留画布、语音与草稿。
    if (destination && workspaceSurface.parentElement !== destination)
      destination.append(workspaceSurface);
    if (!dialog) return;
    if (inRoom) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
      if (roomOpen) setRoomOpen(false);
    }
  }, [inRoom, roomOpen, state.started, complete, workspaceSurface]);
  useEffect(() => {
    try {
      sessionStorage.setItem(experienceKey, JSON.stringify(state));
      setStorageError("");
    } catch {
      setStorageError(
        "浏览器未允许保存进度，刷新后可能需要重新开始。你仍可以完成练习并导出报告。",
      );
    }
  }, [state]);
  useEffect(() => {
    if (state.started) questionHead.current?.focus();
  }, [state.started, state.answers.length, view]);
  const reset = () => {
    if (
      !window.confirm(
        "重新开始会清除这轮示例的回答与笔记。请先导出需要保留的复盘。",
      )
    )
      return;
    setView(null);
    setState(freshExperience(state.sample));
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([exportExperience(state)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "项目追问官-练习复盘.md";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const dialogue: { who: "你" | "陈老师"; text: string }[] = [
    { who: "陈老师", text: questionFor(state.sample, 0, []) },
  ];
  state.answers.forEach((answer, i) => {
    dialogue.push({ who: "你", text: answer });
    if (i + 1 < 5)
      dialogue.push({
        who: "陈老师",
        text: questionFor(state.sample, i + 1, state.answers.slice(0, i + 1)),
      });
  });
  const submitAnswer = (e: React.FormEvent) => {
    e.preventDefault();
    const answer = state.draft.trim();
    if (answer)
      setState((s) =>
        s.answers.length >= 5
          ? s
          : { ...s, answers: [...s.answers, answer], draft: "" },
      );
  };
  const submitVoice = (text: string) => {
    const answer = text.trim();
    if (!answer || answer.length > 3000) return;
    setState((s) =>
      s.answers.length >= 5
        ? s
        : { ...s, answers: [...s.answers, answer], draft: "" },
    );
  };
  return (
    <section
      className={state.started ? "experience-page" : "experience-page experience-page--choose"}
    >
      <div className="experience-top">
        <a href="#/">
          <ArrowLeft size={16} /> 返回首页
        </a>
      </div>
      {storageError && <p role="alert">{storageError}</p>}
      {!state.started ? (
        <ExampleScenarioSelection
          sample={sample}
          onSelect={selected => setState(freshExperience(selected.id))}
          onStart={() => setState(s => ({ ...s, started: true }))}
          footer="练习结束后可导出回答与自查清单，示例不提供技术评分。"
        />
      ) : (
        <>
          <div className="experience-heading">
            <div>
              <div className="probe-eyebrow">
                {complete
                  ? "把回答变成可回看的准备"
                  : "从材料出发，沿着回答继续"}
              </div>
              <h1>
                {complete ? "这轮练习，留下了什么？" : sample.project.name}
              </h1>
              <p>
                {complete
                  ? "逐条核对你的解释，再记录需要补充的内容。勾选仅代表自行核对。"
                  : "不确定的地方可以直接说清，先把真实理解写下来。"}
              </p>
            </div>
            <div className="experience-heading-actions">
              {!complete && (
                <>
                  <button
                    type="button"
                    className="button secondary"
                    aria-haspopup="dialog"
                    onClick={() => openRoom(false)}
                  >
                    <Maximize2 size={16} aria-hidden="true" /> 进入面试室
                  </button>
                  <button
                    type="button"
                    className="button"
                    aria-haspopup="dialog"
                    title="使用浏览器语音识别，停顿后自动提交；面试官播报时自动闭麦，可随时改用文字。"
                    onClick={() => openRoom(true)}
                  >
                    <Mic size={16} aria-hidden="true" /> 同意并进入语音面试
                  </button>
                </>
              )}
              <button className="probe-text-button" onClick={reset}>
                <RotateCcw size={15} /> 重新开始
              </button>
            </div>
          </div>
          {complete ? (
            <div className="experience-report">
              <div className="experience-report-bar">
                <span>
                  <CheckCheck size={20} /> 已保留 5 组问答与原文依据
                </span>
                <button className="button" onClick={download}>
                  <Download size={16} /> 导出复盘 Markdown
                </button>
              </div>
              {dimensions.map((d, i) => (
                <article className="experience-report-item" key={d.title}>
                  <div className="experience-report-title">
                    <span>0{i + 1}</span>
                    <h2>{d.title}</h2>
                    <label>
                      <input
                        type="checkbox"
                        checked={state.checked[i]}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            checked: s.checked.map((v, n) =>
                              n === i ? e.target.checked : v,
                            ),
                          }))
                        }
                      />{" "}
                      我已自行核对
                    </label>
                  </div>
                  <h3>
                    {questionFor(state.sample, i, state.answers.slice(0, i))}
                  </h3>
                  <div className="experience-evidence-pair">
                    <div>
                      <span className="probe-label">我的原回答</span>
                      <p>{state.answers[i]}</p>
                    </div>
                    <div>
                      <span className="probe-label">材料原文 · {d.label}</span>
                      <p>{sample.project[d.field]}</p>
                    </div>
                  </div>
                  <div className="experience-task">
                    <strong>建议核对</strong>
                    {d.task}
                  </div>
                  <label>
                    补充笔记
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={state.notes[i]}
                      placeholder="记录要查看的代码、要补做的测试，或仍不确定的地方…"
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          notes: s.notes.map((v, n) =>
                            n === i ? e.target.value : v,
                          ),
                        }))
                      }
                    />
                  </label>
                </article>
              ))}
              <div className="experience-next">
                <ShieldCheck size={19} />
                <p>
                  这是规则引导的练习记录。原回答、材料引用和你的自查都可回看；它们不代表技术已独立验证。
                </p>
                <button
                  className="probe-text-button"
                  onClick={() => go("/projects/new")}
                >
                  换成我的真实项目 <ArrowRight size={16} />
                </button>
              </div>
            </div>
          ) : (
            <div ref={inlineContent} className="practice-card" />
          )}
          {createPortal(
            state.started && !complete && (
            <div className="practice-body is-live">
              <div className="practice-stage-col">
                <div className="live-stage">
                  <InterviewerAvatar
                    state={avatarState}
                    mouthLevel={mouthLevel}
                    presence={presence}
                  />
                  <div className="stage-top">
                    <span className="live-indicator">
                      <span className="status-dot" />
                      {avatarStatus}
                    </span>
                    {!inRoom && (
                      <span className="live-indicator">示例追问 · 中文</span>
                    )}
                  </div>
                  {speaking && !inRoom && (
                    <div className="stage-subtitle">{currentQuestion}</div>
                  )}
                  <div className="stage-bottom">
                    <div className="stage-name">
                      <strong>陈老师</strong>
                      <p>技术面试官</p>
                    </div>
                    <div className="camera-box">
                      {camera.on && camera.stream ? (
                        <>
                          <video
                            autoPlay
                            playsInline
                            muted
                            aria-label="你的摄像头预览"
                            ref={(el) => {
                              if (el) el.srcObject = camera.stream;
                            }}
                          />
                          <span className="camera-caption">你</span>
                        </>
                      ) : (
                        <>
                          <CameraOff size={18} aria-hidden="true" />
                          <span>你的摄像头尚未开启</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div
                  className="live-control-bar"
                  role="group"
                  aria-label="演示媒体控件"
                >
                  <button
                    type="button"
                    className="round-control"
                    aria-pressed={!muted}
                    aria-label={muted ? "开启面试官声音" : "关闭面试官声音"}
                    title={muted ? "开启面试官声音" : "关闭面试官声音"}
                    disabled={!speechSupported}
                    onClick={() => setMuted((m) => !m)}
                  >
                    {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
                  </button>
                  <button
                    type="button"
                    className="round-control"
                    aria-label="重新播报本题"
                    title="重新播报本题"
                    disabled={
                      !speechSupported || muted || speaking || preparing || voiceBusy
                    }
                    onClick={() => {
                      unlock();
                      speak(currentQuestion);
                    }}
                  >
                    <RotateCcw size={18} />
                  </button>
                  <button
                    type="button"
                    className="round-control"
                    aria-pressed={camera.on}
                    aria-label={camera.on ? "关闭摄像头" : "开启摄像头"}
                    title={camera.on ? "关闭摄像头" : "开启摄像头"}
                    onClick={() => void camera.toggle()}
                  >
                    {camera.on ? <Camera size={19} /> : <CameraOff size={19} />}
                  </button>
                </div>
                {camera.error && (
                  <p className="media-error" role="status">
                    {camera.error}
                  </p>
                )}
                {!speechSupported && (
                  <p className="media-error" role="status">
                    当前浏览器不支持语音播报，可继续文字练习。
                  </p>
                )}
                <p className="control-caption">
                  摄像头仅用于本机预览和动作识别。
                </p>
              </div>
              <div className="practice-live-right">
                <div className="practice-question">
                  <span className="practice-kicker">
                    <MessageSquare size={15} /> 示例追问 ·{" "}
                    {String(shown + 1).padStart(2, "0")}
                  </span>
                  <h3 tabIndex={-1} ref={questionHead}>
                    {currentQuestion}
                  </h3>
                  <p>
                    结合合成材料中你代入的部分回答；没有做过或尚未验证的内容，可以直接说明。
                  </p>
                  <small>规则演示，非AI评估</small>
                  <div className="question-progress-row">
                    <span>第 {shown + 1} / 5 题</span>
                    <div className="question-progress" aria-hidden="true">
                      <span style={{ width: `${((shown + 1) / 5) * 100}%` }} />
                    </div>
                  </div>
                </div>
                <section className="practice-dialogue" aria-label="本题对话">
                  <h3>本题对话</h3>
                  <ol
                    className="practice-dialogue-messages"
                    ref={transcript}
                    aria-live="polite"
                  >
                    {dialogue.map((message, i) => (
                      <li key={i}>
                        <p className={message.who === "陈老师" ? "reply" : undefined}>
                          <strong>{message.who}</strong>
                          {message.text}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
                <details className="practice-material-preview">
                  <summary>
                    <FileText size={14} /> 材料依据 · {dimensions[shown].label}
                  </summary>
                  <blockquote>
                    {sample.project[dimensions[shown].field]}
                  </blockquote>
                  <details>
                    <summary>
                      展开完整项目材料 <ChevronDown size={14} />
                    </summary>
                    {(
                      [
                        "background",
                        "responsibility",
                        "implementation",
                        "problems",
                        "verification",
                      ] as const
                    ).map((key, i) => (
                      <div key={key}>
                        <h3>
                          {
                            [
                              "项目背景",
                              "个人职责",
                              "关键实现",
                              "已知问题",
                              "验证记录",
                            ][i]
                          }
                        </h3>
                        <p>{sample.project[key]}</p>
                      </div>
                    ))}
                  </details>
                </details>
                {view !== null ? (
                  <div className="practice-answer">
                    <span className="probe-label">你已提交的回答</span>
                    <p className="experience-saved-answer">
                      {state.answers[view]}
                    </p>
                    <button className="button" onClick={() => setView(null)}>
                      回到当前追问 <ArrowRight size={16} />
                    </button>
                  </div>
                ) : handsFree ? (
                  <>
                    <ExperienceVoice
                      auto
                      suspended={
                        speaking ||
                        preparing ||
                        !!state.draft.trim() ||
                        (!muted && speechSupported && playedQuestion !== currentQuestion)
                      }
                      disabled={false}
                      remaining={3000}
                      onAppend={submitVoice}
                      onBusy={setVoiceBusy}
                    />
                    <div className="practice-answer-actions">
                      <button
                        type="button"
                        className="practice-voice-switch"
                        onClick={() => setVoiceRoom(false)}
                      >
                        改用文字回答
                      </button>
                    </div>
                    {state.draft.trim() && (
                      <p className="practice-voice-status">
                        有一段未发送的草稿，可改用文字回答继续编辑。
                      </p>
                    )}
                  </>
                ) : (
                  <form className="practice-answer" onSubmit={submitAnswer}>
                    <label>
                      我的回答
                      <textarea
                        autoComplete="off"
                        aria-label="本轮回答"
                        rows={6}
                        maxLength={3000}
                        value={state.draft}
                        placeholder="从实际步骤说起；没有做过的部分，直接说明。"
                        onChange={(e) =>
                          setState((s) => ({ ...s, draft: e.target.value }))
                        }
                      />
                    </label>
                    <div className="practice-answer-actions">
                      <small>{state.draft.length} / 3000 · 草稿自动保留</small>
                      <button
                        className="button"
                        type="submit"
                        disabled={!state.draft.trim()}
                      >
                        {index === 4 ? "保存并查看复盘" : "保存回答，继续追问"}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    {inRoom && !state.draft.trim() && (
                      <button
                        type="button"
                        className="practice-voice-switch"
                        onClick={() => openRoom(true)}
                      >
                        同意并开始语音面试
                      </button>
                    )}
                  </form>
                )}
                {state.answers.length > 0 && (
                  <div className="experience-history">
                    <span className="probe-label">回看已提交的问答</span>
                    <div>
                      {state.answers.map((_, i) => (
                        <button
                          key={i}
                          className={view === i ? "active" : ""}
                          onClick={() => setView(i)}
                        >
                          <Check size={13} /> {dimensions[i].title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            ),
            workspaceSurface,
          )}
          <dialog
            ref={roomDialog}
            className="practice-room"
            aria-labelledby="experience-room-title"
            onCancel={(event) => {
              event.preventDefault();
              closeRoom();
            }}
          >
            <header className="practice-room-header">
              <div>
                <h2 id="experience-room-title">示例面试室</h2>
                <p>{sample.project.name} · 本地规则演示</p>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={closeRoom}
              >
                <ArrowLeft size={16} aria-hidden="true" /> 返回练习
              </button>
            </header>
            <div className="practice-room-content" ref={roomContent} />
          </dialog>
        </>
      )}
    </section>
  );
}
