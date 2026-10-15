ALTER TABLE trainings ADD COLUMN history_key VARCHAR(64);
CREATE INDEX trainings_history ON trainings(user_id, history_key, created_at);
CREATE INDEX trainings_project_history ON trainings(user_id, project_id, created_at);
CREATE TABLE training_question_index (
  turn_id VARCHAR(36) PRIMARY KEY,
  training_id VARCHAR(36) NOT NULL REFERENCES trainings(id),
  user_id VARCHAR(36) NOT NULL REFERENCES app_users(id),
  project_id VARCHAR(36) NOT NULL REFERENCES projects(id),
  history_key VARCHAR(64) NOT NULL,
  question_hash VARCHAR(64) NOT NULL
);
CREATE INDEX question_by_project ON training_question_index(user_id, project_id, question_hash);
CREATE INDEX question_by_resume ON training_question_index(user_id, history_key, question_hash);
