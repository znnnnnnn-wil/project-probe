CREATE TABLE project_batch_creations (
  user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
  request_key VARCHAR(100) NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  project_ids VARCHAR(369) NOT NULL,
  PRIMARY KEY(user_id, request_key)
);
