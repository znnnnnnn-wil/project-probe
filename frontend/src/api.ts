import exampleProjects from "../../backend/src/main/resources/example-projects.json" with { type: "json" };

const apiBase = (import.meta.env.VITE_API_BASE?.trim() || "/api").replace(/\/+$/, "");

export function apiUrl(path: string) {
  return new URL(apiBase + path, location.origin);
}

export function fetchApi(path: string, options: RequestInit) {
  const url = apiUrl(path);
  return fetch(url, {
    ...options,
    credentials: url.origin === location.origin ? "same-origin" : "include",
  });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
  onSentence?: (sentence: string, speechTicket?: string) => void,
): Promise<T> {
  const response = await fetchApi(path, {
    method,
    signal,
    headers: { "Content-Type": "application/json", ...(onSentence ? { Accept: "application/x-ndjson" } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body.message ||
        ({
          401: "请先登录",
          403: "请求来源校验失败，请使用配置的访问地址",
          429: "操作过于频繁，请稍后再试",
        }[response.status] ??
          "请求失败，请稍后重试"),
      body.requestId || response.headers.get("X-Request-ID") || undefined,
    );
  }
  if (onSentence && response.body && response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let pending = "";
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const lines = (pending + chunk.value).split("\n");
        pending = lines.pop() ?? "";
        if (pending.length > 2_000_000) break;
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { sentence?: string; speechTicket?: string; result?: T; status?: number; message?: string };
          if (event.sentence) onSentence(event.sentence, event.speechTicket);
          if (event.status) throw new ApiError(event.status, event.message || "训练请求失败");
          if (event.result !== undefined) return event.result;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    throw new ApiError(503, "讲解连接已中断，可以恢复训练");
  }
  return response.status === 204 ||
    response.headers.get("content-length") === "0"
    ? (undefined as T)
    : await response.text().then((t) => (t ? JSON.parse(t) : undefined));
}
export const go = (path: string) => {
  location.hash = path;
};
export async function upload<T>(
  path: string,
  file: Blob,
  filename: string,
  extra: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const data = new FormData();
  data.append("file", file, filename);
  for (const [key, value] of Object.entries(extra)) data.append(key, value);
  const response = await fetchApi(path, {
    method: "POST",
    body: data,
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      response.status,
      body.message ||
        (response.status === 413
          ? "文件过大，请缩小后再上传"
          : response.status === 401
            ? "登录已过期，请重新登录"
            : "识别失败，请稍后重试"),
    );
  return body as T;
}
export const emptyProject = {
  name: "",
  background: "",
  targetRole: "Java 后端实习",
  stack: "",
  responsibility: "",
  resume: "",
  architecture: "",
  implementation: "",
  problems: "",
  verification: "",
  materials: "",
  facts: [],
  factsConfirmed: false,
};
export const demoProject = {
  ...emptyProject,
  ...exampleProjects[0].project,
};
