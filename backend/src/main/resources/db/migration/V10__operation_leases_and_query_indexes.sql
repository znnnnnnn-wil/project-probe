ALTER TABLE purchase_orders ADD COLUMN query_lease_token VARCHAR(36);
CREATE INDEX sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX project_owner_updated ON projects(user_id, updated_at, id);
CREATE INDEX orders_owner_created ON purchase_orders(user_id, created_at, id);
CREATE INDEX training_owner_created ON trainings(user_id, created_at, id);
CREATE INDEX training_parent ON trainings(user_id, parent_id, kind, created_at, id);
CREATE INDEX orders_account_reconcile ON purchase_orders(mode, account_scope, status, last_query_at);
