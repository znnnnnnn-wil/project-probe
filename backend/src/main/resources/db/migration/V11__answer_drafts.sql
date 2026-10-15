CREATE TABLE answer_drafts (
  training_id VARCHAR(36) PRIMARY KEY REFERENCES trainings(id),
  turn_id VARCHAR(36) NOT NULL,
  body TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX answer_draft_expiry ON answer_drafts(updated_at);
