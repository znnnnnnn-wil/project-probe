CREATE TABLE material_jobs (
  user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
  kind VARCHAR(20) NOT NULL,
  input_key VARCHAR(64) NOT NULL,
  token VARCHAR(36) NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, kind, input_key)
);
