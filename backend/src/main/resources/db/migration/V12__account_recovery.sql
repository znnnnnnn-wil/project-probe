CREATE TABLE account_recovery (
  user_id VARCHAR(36) PRIMARY KEY REFERENCES app_users(id),
  code_hash VARCHAR(64) NOT NULL,
  created_at BIGINT NOT NULL
);
