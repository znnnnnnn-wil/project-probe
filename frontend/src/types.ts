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
};
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
  retestEntry?: {
    state: "AVAILABLE" | "CONTINUE" | "COMPLETED" | "UNAVAILABLE";
    trainingId?: string;
    trainingStatus?: string;
    packageId: string;
    returned?: boolean;
  };
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
};
export type Package = {
  id: string;
  deep_used: boolean;
  retest_used: boolean;
  deep_training_id?: string;
};
export type Shop = {
  mode: string;
  configured: boolean;
  configurationIssues?: string[];
  orders: Order[];
  packages: Package[];
  product: { name: string; amountCents: number; description: string };
};
