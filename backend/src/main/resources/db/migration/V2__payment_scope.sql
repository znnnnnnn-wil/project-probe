-- 只新增字段，不修改历史订单或发放历史权益。legacy 真实订单需要独立人工审计。
ALTER TABLE purchase_orders ADD COLUMN app_id VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN seller_id VARCHAR(80) NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN account_scope VARCHAR(200) NOT NULL DEFAULT 'legacy';
ALTER TABLE purchase_orders ADD COLUMN merchant_order_no VARCHAR(64) UNIQUE;
ALTER TABLE purchase_orders ADD COLUMN last_query_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN query_lease_until BIGINT NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN query_status VARCHAR(40) NOT NULL DEFAULT 'NOT_QUERIED';
ALTER TABLE purchase_orders ADD COLUMN query_error VARCHAR(300) NOT NULL DEFAULT '';
ALTER TABLE purchase_orders ADD COLUMN checkout_requested BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX orders_reconcile ON purchase_orders(mode, status, last_query_at);
