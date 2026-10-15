CREATE TABLE project_trials (
  user_id VARCHAR(36) PRIMARY KEY REFERENCES app_users(id),
  project_id VARCHAR(36) NOT NULL,
  status VARCHAR(20) NOT NULL,
  body TEXT NOT NULL,
  lease_until BIGINT NOT NULL DEFAULT 0,
  lease_token VARCHAR(36)
);
