CREATE TABLE project_practice_rounds (
  user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
  project_id VARCHAR(36) NOT NULL,
  round_id VARCHAR(36) NOT NULL,
  round_number BIGINT NOT NULL,
  started_at BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL,
  body TEXT NOT NULL,
  lease_until BIGINT NOT NULL DEFAULT 0,
  lease_token VARCHAR(36),
  PRIMARY KEY(user_id, round_id),
  UNIQUE(user_id, project_id, round_number)
);

INSERT INTO project_practice_rounds (
  user_id, project_id, round_id, round_number, started_at,
  status, body, lease_until, lease_token
)
SELECT user_id, project_id, project_id, 1, 0, status, body, lease_until, lease_token
FROM project_trials;

UPDATE journey_events SET event='PRACTICE_STARTED' WHERE event='TRIAL_STARTED';
UPDATE journey_events SET event='PRACTICE_COMPLETED' WHERE event='TRIAL_COMPLETED';

DROP TABLE project_trials;
