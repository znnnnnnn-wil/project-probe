ALTER TABLE purchase_orders ADD COLUMN expires_at BIGINT NOT NULL DEFAULT 0;
-- 补充历史订单的有效期快照，不更改付款、金额或权益记录。
UPDATE purchase_orders SET expires_at=created_at+1800000;
CREATE INDEX orders_expiry ON purchase_orders(mode, status, expires_at);
