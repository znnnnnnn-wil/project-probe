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
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    signal,
    headers: { "Content-Type": "application/json" },
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
): Promise<T> {
  const data = new FormData();
  data.append("file", file, filename);
  for (const [key, value] of Object.entries(extra)) data.append(key, value);
  const response = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    body: data,
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
  name: "校园自习室预约系统",
  background: "合成演示项目：学生预约自习室座位，避免预约时间冲突。",
  stack: "Java 17 / Spring Boot / PostgreSQL",
  resume:
    "实现座位预约、取消和预约记录查询。以下材料用于演示，不代表真实用户经历或已验证的性能成果。",
  responsibility:
    "我负责预约创建接口、数据库约束和部分集成测试；前端由同学实现。",
  architecture: "浏览器请求后端 REST API，后端通过事务读写 PostgreSQL。",
  implementation:
    "预约表记录用户、座位、时间段和状态。在数据库中约束同一座位同一时段的有效预约唯一。",
  problems: "并发预约可能在检查余量后同时写入，计划通过唯一约束防止重复占用。",
  verification:
    "计划用两个并发请求预约同一座位，验证仅一笔成功；尚未记录压测结果。",
};
