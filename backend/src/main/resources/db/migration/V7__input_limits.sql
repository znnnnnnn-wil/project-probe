CREATE TABLE input_limits (
  user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
  kind VARCHAR(20) NOT NULL,
  window_start BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until BIGINT NOT NULL DEFAULT 0,
  lease_token VARCHAR(36),
  PRIMARY KEY (user_id, kind)
);
