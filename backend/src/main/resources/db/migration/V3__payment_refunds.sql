CREATE TABLE payment_refunds (
  order_id VARCHAR(36) PRIMARY KEY REFERENCES purchase_orders(id),
  request_no VARCHAR(64) NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  status VARCHAR(20) NOT NULL,
  attempted_at BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
CREATE TABLE payment_notification_events (
  event_key VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(36) NOT NULL REFERENCES purchase_orders(id),
  event_type VARCHAR(20) NOT NULL,
  trade_status VARCHAR(30) NOT NULL,
  created_at BIGINT NOT NULL
);
