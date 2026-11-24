export const exampleApi = "/examples";

export function practiceProjectPath(projectId: string, example: boolean) {
  return (example ? exampleApi : "") + "/projects/" + encodeURIComponent(projectId);
}

export function practiceHistoryPath(example: boolean, projectId?: string, roundId?: string) {
  if (!projectId) return "/history";
  const root = example ? "/history/examples" : "/history";
  const project = root + "/" + encodeURIComponent(projectId);
  return roundId ? project + "/" + encodeURIComponent(roundId) : project;
}
