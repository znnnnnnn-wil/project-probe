import { test, expect, type Page } from "@playwright/test";
import { emptyProject } from "../src/api";
import type { Project } from "../src/types";

const projectId = "33333333-3333-4333-8333-333333333333";
const editorUrl = "/#/projects/" + projectId;
const draftKey = "project-draft:" + projectId;
const legacyFields = [
  ["responsibility", "个人职责"],
  ["architecture", "项目架构"],
  ["implementation", "实现细节"],
  ["problems", "问题与难点"],
  ["verification", "验证方式"],
  ["materials", "补充材料"],
] as const;
const clearedLegacy = Object.fromEntries(legacyFields.map(([key]) => [key, ""]));
const legacyProject: Project = {
  ...emptyProject,
  id: projectId,
  version: 7,
  name: "旧版六项材料项目",
  background: "旧版项目简介",
  stack: "Java / PostgreSQL",
  resume: " 原项目经历，保留首尾空白。 ",
  responsibility: " 旧职责：实现预约接口。 ",
  architecture: "旧架构：浏览器调用后端。",
  implementation: "旧实现：使用数据库唯一约束。\n保留第二行。",
  problems: "旧难点：并发重复预约。",
  verification: "旧验证：测试两个并发请求。",
  materials: "旧补充：尚未测量性能。",
};
const mergedResume = (project: Project) =>
  [
    project.resume,
    ...legacyFields.flatMap(([key, title]) =>
      project[key].trim() ? [`${title}\n${project[key]}`] : [],
    ),
  ].filter(Boolean).join("\n\n");
const readDraft = (page: Page): Promise<Project | null> =>
  page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) || "null"), draftKey);

async function fixture(page: Page, overrides: Partial<Project> = {}) {
  let stored = { ...legacyProject, ...overrides };
  const puts: Project[] = [];
  const writes: string[] = [];
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (method !== "GET") writes.push(method + " " + path);
    let json: unknown;
    if (path === "/api/projects/" + projectId && method === "PUT") {
      const body = request.postDataJSON() as Project;
      puts.push(body);
      stored = { ...stored, ...body, version: stored.version! + 1 };
      json = stored;
    } else if (method !== "GET") {
      throw new Error("未预期写入：" + method + " " + path);
    } else if (path === "/api/config") json = { modelMode: "demo" };
    else if (path === "/api/me") json = { id: "legacy-user", username: "旧材料回归" };
    else if (path === "/api/projects/" + projectId) json = stored;
    else if (path === "/api/projects") json = [stored];
    else if (path === "/api/trainings") json = [];
    else if (path === "/api/training-overview") json = { items: [] };
    else throw new Error("未预期请求：" + path);
    await route.fulfill({ json });
  });
  return { puts, writes, stored: () => stored };
}

async function openWithDraft(page: Page, draft: Project) {
  // Wait for account-scoped session initialization before seeding an old draft.
  await page.goto("/#/projects");
  await expect(page.getByRole("heading", { name: "我的项目", exact: true })).toBeVisible();
  await page.evaluate(({ key, value }) => {
    sessionStorage.setItem(key, JSON.stringify(value));
  }, { key: draftKey, value: draft });
  await page.getByRole("link", { name: "编辑材料", exact: true }).click();
}

test("六项旧材料完整归并到本地可编辑经历，刷新不重复且不写服务端", async ({ page }) => {
  const server = await fixture(page);
  await page.goto(editorUrl);
  await expect(page.locator(".form-fields input, .form-fields textarea")).toHaveCount(5);
  await expect(page.getByRole("textbox", { name: "项目经历", exact: true })).toHaveValue(mergedResume(legacyProject));
  await expect(page.getByText(/旧版材料已合并.*保存后以当前五字段为准/)).toBeVisible();
  await expect.poll(() => readDraft(page)).toMatchObject({
    ...clearedLegacy,
    resume: mergedResume(legacyProject),
  });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "项目经历", exact: true })).toHaveValue(mergedResume(legacyProject));
  await expect(page.getByText("已恢复此标签页未保存的材料", { exact: true })).toBeVisible();
  expect(server.stored()).toEqual(legacyProject);
  expect(server.writes).toEqual([]);
});

for (const [action, resume] of [
  ["修改", mergedResume(legacyProject).replace(legacyProject.problems, "已修改难点：用户核实后的新说明。")],
  ["删除全部", ""],
]) {
  test(`${action}归并文字后草稿不丢失，保存清空六旧项且再次编辑不复活`, async ({ page }) => {
    const server = await fixture(page);
    await page.goto(editorUrl);
    const experience = page.getByRole("textbox", { name: "项目经历", exact: true });
    await expect(experience).toHaveValue(mergedResume(legacyProject));
    await experience.fill(resume);
    await expect.poll(() => readDraft(page)).toMatchObject({ ...clearedLegacy, resume });
    await page.reload();
    await expect(experience).toHaveValue(resume);
    await page.getByRole("button", { name: "返回项目列表", exact: true }).click();
    await page.getByRole("link", { name: "编辑材料", exact: true }).click();
    await expect(experience).toHaveValue(resume);
    expect(server.writes).toEqual([]);
    expect(server.stored()).toEqual(legacyProject);

    await page.getByRole("button", { name: "保存项目材料" }).click();
    await expect(page.getByText("材料已保存", { exact: true }).first()).toBeVisible();
    expect(server.puts).toEqual([{ ...legacyProject, ...clearedLegacy, resume }]);
    expect(server.writes).toEqual(["PUT /api/projects/" + projectId]);
    await expect.poll(() => readDraft(page)).toBeNull();
    await expect(page.getByText(/旧版材料已合并/)).toHaveCount(0);

    await page.reload();
    await expect(experience).toHaveValue(resume);
    await page.getByRole("button", { name: "返回项目列表", exact: true }).click();
    await page.getByRole("link", { name: "编辑材料", exact: true }).click();
    await expect(experience).toHaveValue(resume);
    await expect(page.getByText(/旧版材料已合并/)).toHaveCount(0);
    expect(server.puts).toHaveLength(1);
  });
}

test("恢复迁移前的旧草稿时保留用户修改，只归并一次", async ({ page }) => {
  const server = await fixture(page);
  const draft = {
    ...legacyProject,
    name: "旧草稿中修改的名称",
    resume: "草稿已有经历",
    responsibility: "草稿中更新的职责",
    materials: "草稿中的补充材料",
  };
  await openWithDraft(page, draft);
  await expect(page.getByLabel("项目名称", { exact: true })).toHaveValue(draft.name);
  await expect(page.getByRole("textbox", { name: "项目经历", exact: true })).toHaveValue(mergedResume(draft));
  await expect.poll(() => readDraft(page)).toMatchObject({ ...clearedLegacy, resume: mergedResume(draft) });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "项目经历", exact: true })).toHaveValue(mergedResume(draft));
  expect(server.writes).toEqual([]);
  expect(server.stored()).toEqual(legacyProject);
});

test("过期草稿不覆盖当前版本的旧材料", async ({ page }) => {
  const server = await fixture(page);
  await openWithDraft(page, { ...legacyProject, ...clearedLegacy, version: 6, resume: "过期归并草稿" });
  await expect(page.getByText("材料已在其他页面更新，旧草稿未覆盖新版本", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "项目经历", exact: true })).toHaveValue(mergedResume(legacyProject));
  expect(server.writes).toEqual([]);
});

test("未保存返回列表取消本次编辑，不修改服务端材料", async ({ page }) => {
  const server = await fixture(page);
  await page.goto(editorUrl);
  await expect(page.getByRole("textbox", { name: "项目经历", exact: true })).toHaveValue(mergedResume(legacyProject));
  await page.getByRole("textbox", { name: "项目经历", exact: true }).fill("本次未提交的替换内容");
  await page.getByRole("button", { name: "返回项目列表", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的项目", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "编辑材料", exact: true })).toBeVisible();
  expect(server.stored()).toEqual(legacyProject);
  expect(server.writes).toEqual([]);
});

test("归并超长内容不截断且禁止提交，整理到12000字后才可保存", async ({ page }) => {
  const original = { ...legacyProject, resume: "长".repeat(11990) };
  const server = await fixture(page, original);
  const merged = mergedResume(original);
  expect(merged.length).toBeGreaterThan(12000);
  await page.goto(editorUrl);
  const experience = page.getByRole("textbox", { name: "项目经历", exact: true });
  const save = page.getByRole("button", { name: "保存项目材料" });
  await expect(experience).toHaveValue(merged);
  await expect(page.getByRole("alert")).toContainText("项目经历超过 12000 字");
  await expect(save).toBeDisabled();
  await experience.fill(merged + "\n继续整理超长草稿");
  await expect.poll(() => readDraft(page)).toMatchObject({ resume: merged + "\n继续整理超长草稿" });
  // A submit event must also be guarded, not just the disabled button.
  await page.locator("#project-materials form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.reload();
  await expect(experience).toHaveValue(merged + "\n继续整理超长草稿");
  await expect(save).toBeDisabled();
  expect(server.writes).toEqual([]);
  expect(server.stored()).toEqual(original);

  await experience.fill("新".repeat(12001));
  await expect(experience).toHaveValue("新".repeat(12001));
  await expect(save).toBeDisabled();
  await experience.fill("新".repeat(12000));
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => server.puts.length).toBe(1);
  expect(server.puts[0]).toMatchObject({ ...clearedLegacy, resume: "新".repeat(12000) });
});

test("没有非空旧材料的五字段项目不添加标题或迁移提示", async ({ page }) => {
  const server = await fixture(page, { ...clearedLegacy, responsibility: " \n " });
  await page.goto(editorUrl);
  await expect(page.getByRole("textbox", { name: "项目经历", exact: true })).toHaveValue(legacyProject.resume);
  await expect(page.getByText(/旧版材料已合并/)).toHaveCount(0);
  expect(await readDraft(page)).toBeNull();
  expect(server.writes).toEqual([]);
});

for (const mode of ["manual", "resume", "upload"] as const) {
  test(`新建项目${mode}入口归并旧材料，超长不截断且仅提交整理后的五字段`, async ({ page }) => {
    await fixture(page);
    const project = { ...legacyProject, id: undefined, version: undefined, resume: "长".repeat(11990) };
    const merged = mergedResume(project);
    await page.goto("/#/projects");
    await expect(page.getByRole("heading", { name: "我的项目", exact: true })).toBeVisible();
    if (mode !== "upload") {
      await page.evaluate(({ mode, project }) => {
        const key = mode === "manual" ? "project-draft:new" : "project-resume-draft:new";
        const value = mode === "manual" ? project : { requestKey: "legacy-import", projects: [{ key: "entry", project }] };
        sessionStorage.setItem(key, JSON.stringify(value));
      }, { mode, project });
    }
    await page.goto("/#/projects/new");
    if (mode === "upload") {
      await page.route("**/api/resume/import", route => route.fulfill({ json: { projects: [project] } }));
      await page.getByRole("button", { name: "上传简历", exact: true }).click();
      await page.getByRole("checkbox", { name: /同意将简历文字/ }).check();
      await page.getByLabel("上传简历文件").setInputFiles({ name: "synthetic.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic resume") });
    }
    const experience = page.getByRole("textbox", { name: "项目经历", exact: true });
    const save = page.getByRole("button", { name: mode === "manual" ? "保存项目材料" : "保存 1 个项目", exact: true });
    await expect(experience).toHaveValue(merged);
    await expect(save).toBeDisabled();
    await expect(page.getByRole("alert")).toContainText("项目经历超过 12000 字");
    const submitted: Project[] = [];
    await page.route(mode === "manual" ? "**/api/projects" : "**/api/projects/batch", route => {
      const body = route.request().postDataJSON();
      submitted.push(...(mode === "manual" ? [body] : body.projects));
      return route.fulfill({ json: mode === "manual" ? { ...body, id: projectId } : [{ ...body.projects[0], id: projectId }] });
    });
    await page.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect(submitted).toHaveLength(0);
    await experience.fill("整理后的经历");
    await page.reload();
    await expect(experience).toHaveValue("整理后的经历");
    await save.click();
    await expect.poll(() => submitted.length).toBe(1);
    expect(submitted[0]).toMatchObject({ ...clearedLegacy, resume: "整理后的经历" });
  });
}
