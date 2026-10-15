CREATE TABLE user_feedback (
  id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
  request_key VARCHAR(100) NOT NULL, kind VARCHAR(20) NOT NULL,
  body TEXT NOT NULL, request_id VARCHAR(36), training_id VARCHAR(36),
  status VARCHAR(20) NOT NULL, reply TEXT NOT NULL, created_at BIGINT NOT NULL,
  UNIQUE(user_id, request_key)
);
CREATE INDEX feedback_owner ON user_feedback(user_id, created_at);
