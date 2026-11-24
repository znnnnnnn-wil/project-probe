CREATE TABLE example_sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL UNIQUE REFERENCES app_users(id),
  expires_at BIGINT NOT NULL
);

CREATE INDEX example_sessions_expiration ON example_sessions(expires_at);
