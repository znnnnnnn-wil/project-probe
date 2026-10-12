CREATE TABLE extraction_limits (
  user_id VARCHAR(36) PRIMARY KEY REFERENCES app_users(id),
  window_start BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until BIGINT NOT NULL DEFAULT 0,
  lease_token VARCHAR(36)
);
