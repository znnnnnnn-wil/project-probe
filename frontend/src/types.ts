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
  topic: string;
  assessment: string;
  task: string;
  turnIds: string[];
  factIds: string[];
  evidence: { turnId: string; question: string; quote: string }[];
  materials: Fact[];
};
export type Report = {
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
  packageId: string;
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
    packageId: string;
    returned?: boolean;
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
  | "packageId"
  | "leaseUntil"
> & {
  project: Pick<Project, "id" | "name">;
  answeredCount: number;
  turnCount: number;
  retestTopics?: string[];
};
export type Order = {
  id: string;
  amount_cents: number;
  mode: string;
  status: string;
  created_at: number;
  expires_at?: number;
  can_pay?: boolean;
  query_status?: string;
  query_error?: string;
  can_operate?: boolean;
  product_code?: string;
  product_name?: string;
  training_limit?: number;
  lifetime?: boolean;
};
export type Package = {
  id: string;
  order_id?: string;
  deep_used: boolean;
  retest_used: boolean;
  deep_training_id?: string;
  product_code?: string;
  training_limit?: number;
  training_used?: number;
  lifetime?: boolean;
};
export type Product = {
  code: string;
  name: string;
  amountCents: number;
  description: string;
  trainingLimit: number;
  lifetime: boolean;
};
export type Quota = {
  unlimited: boolean;
  sharedRemaining: number;
  legacyDeepRemaining: number;
  legacyRetestRemaining: number;
  deepAvailable: number;
  retestAvailable: number;
};
export type Shop = {
  mode: string;
  configured: boolean;
  operationsEnabled?: boolean;
  configurationIssues?: string[];
  orders: Order[];
  packages: Package[];
  product: { name: string; amountCents: number; description: string };
  products?: Product[];
  quota?: Quota;
};
