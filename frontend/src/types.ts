export type ListPage<T> = {
  items: T[];
  hasMore: boolean;
  total: number;
  offset: number;
  limit: number;
};
export type Fact = {
  id: string;
  text: string;
  source: string;
  sourceField?: string;
  quote?: string;
  confirmed: boolean;
};
export type Project = {
  id?: string;
  version?: number;
  name: string;
  background: string;
  targetRole: string;
  stack: string;
  responsibility: string;
  resume: string;
  architecture: string;
  implementation: string;
  problems: string;
  verification: string;
  materials: string;
  facts: Fact[];
  factsConfirmed: boolean;
};
export type Turn = {
  id: string;
  questionVersion?: number;
  question: string;
  topic: string;
  answer: string;
  answeredAt?: number;
  createdAt?: number;
};
export type ProjectSummary = Pick<
  Project,
  "id" | "version" | "name" | "stack" | "background" | "factsConfirmed"
>;
export type Finding = {
  priority?: number;
  supportExplanation?: string;
  evidenceStatus?: string;
  supportingQuotes?: { sourceId: string; quote: string }[];
  topic: string;
  assessment: string;
  task: string;
  turnIds: string[];
  factIds: string[];
  evidence: { turnId: string; question: string; quote: string }[];
  materials: Fact[];
};
export type ScoreDimension = {
  key: "clarity" | "ownership" | "depth" | "validation";
  score: number | null;
  reason: string;
  turnIds: string[];
};
export type Report = {
  scoring?: { total: number | null; dimensions: ScoreDimension[] };
  qualityReview?: { version: string; status: string; model: string; humanVerified: false };
  comparisons?: { topic: string; status: string; assessment: string;
    previousEvidence: { turnId: string; question: string; quote: string }[];
    currentEvidence: { turnId: string; question: string; quote: string }[];
  }[];
  clearParts: string[];
  findings: Finding[];
  retestTopics: string[];
  mode: string;
};
export type Training = {
  historyKey?: string;
  historyRoundNumber?: number;
  id: string;
  status: string;
  kind: string;
  project: Project;
  turns: Turn[];
  maxTurns: number;
  report?: Report;
  parentId?: string;
  previousTurns?: Turn[];
  previousProject?: Project;
  previousReport?: Report;
  focus: string;
  leaseUntil: number;
  modelMode: string;
  createdAt: number;
  error?: string;
  interviewFacts: Fact[];
  planVersion?: number;
  reportPlan?: {
    taskIndex: number;
    done: boolean;
    note: string;
    updatedAt: number;
  }[];
  retestEntry?: {
    state: "AVAILABLE" | "CONTINUE" | "COMPLETED" | "UNAVAILABLE";
    trainingId?: string;
    trainingStatus?: string;
  };
};
export type TrainingSummary = Pick<
  Training,
  | "id"
  | "status"
  | "kind"
  | "maxTurns"
  | "createdAt"
  | "historyKey"
  | "historyRoundNumber"
  | "focus"
  | "parentId"
  | "retestEntry"
  | "leaseUntil"
> & {
  project: Pick<Project, "id" | "name">;
  answeredCount: number;
  turnCount: number;
  retestTopics?: string[];
};
