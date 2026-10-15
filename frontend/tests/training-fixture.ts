import { expect, test, type Page } from "@playwright/test";
import { demoProject } from "../src/api";
import type { Training } from "../src/types";

export async function trainingFixture(page: Page) {
  const post = async (path: string, data: unknown = {}) => {
    const response = await page.request.post("/api" + path, {
      headers: { Origin: new URL(test.info().project.use.baseURL || "http://localhost:5174").origin }, data,
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json();
  };
  await post("/auth/register", { username: "improve-" + crypto.randomUUID(), password: "synthetic-password-123" });
  const project = await post("/projects", demoProject);
  const facts = await post(`/projects/${project.id}/extract`);
  await post(`/projects/${project.id}/confirm`, facts);
  const order = await post("/orders", { requestKey: crypto.randomUUID() });
  await post(`/orders/${order.id}/mock-pay`);
  const training: Training = await post("/trainings", { projectId: project.id, requestKey: crypto.randomUUID() });
  return { project, training, post };
}
