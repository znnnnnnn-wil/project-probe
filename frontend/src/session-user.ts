// 在展示私人页面前绑定本标签页的缓存归属；同一账号刷新可继续恢复草稿。
export function syncSessionUser(userId: string) {
  if (sessionStorage.getItem("auth:owner") === userId) return;
  const returnPath = sessionStorage.getItem("auth:return");
  sessionStorage.clear();
  if (returnPath) sessionStorage.setItem("auth:return", returnPath);
  sessionStorage.setItem("auth:owner", userId);
}
