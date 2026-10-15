CREATE TABLE model_usage (
  id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
  model_name VARCHAR(200) NOT NULL, payment_mode VARCHAR(20) NOT NULL,
  prompt_tokens BIGINT NOT NULL, completion_tokens BIGINT NOT NULL,
  elapsed_ms BIGINT NOT NULL, estimated_cost_micros BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX model_usage_owner ON model_usage(user_id, payment_mode, created_at);
CREATE TABLE report_views (
  user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
  training_id VARCHAR(36) NOT NULL REFERENCES trainings(id), viewed_at BIGINT NOT NULL,
  PRIMARY KEY(user_id, training_id)
);
