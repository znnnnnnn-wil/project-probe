CREATE TABLE resume_import_cache (
  user_id VARCHAR(36) NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  fingerprint VARCHAR(64) NOT NULL,
  body TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, fingerprint)
);
CREATE INDEX resume_import_cache_expiry ON resume_import_cache(expires_at);
