CREATE TABLE journey_events (
  user_id VARCHAR(36) NOT NULL REFERENCES app_users(id), payment_mode VARCHAR(20) NOT NULL,
  event VARCHAR(40) NOT NULL, subject_id VARCHAR(36) NOT NULL, occurred_at BIGINT NOT NULL,
  PRIMARY KEY(user_id, payment_mode, event, subject_id)
);
CREATE INDEX journey_stage ON journey_events(payment_mode, event, occurred_at);
CREATE TABLE model_attempts (
  id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
  payment_mode VARCHAR(20) NOT NULL, model_name VARCHAR(200) NOT NULL,
  outcome VARCHAR(20) NOT NULL, elapsed_ms BIGINT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX model_attempt_owner ON model_attempts(user_id, payment_mode, created_at);
