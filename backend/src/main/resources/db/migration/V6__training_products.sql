ALTER TABLE purchase_orders ADD COLUMN product_code VARCHAR(30) NOT NULL DEFAULT 'LEGACY_PAIR';
ALTER TABLE purchase_orders ADD COLUMN product_name VARCHAR(100) NOT NULL DEFAULT '项目深挖训练包';
ALTER TABLE purchase_orders ADD COLUMN training_limit INTEGER NOT NULL DEFAULT 2;
ALTER TABLE purchase_orders ADD COLUMN lifetime BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE training_packages ADD COLUMN product_code VARCHAR(30) NOT NULL DEFAULT 'LEGACY_PAIR';
ALTER TABLE training_packages ADD COLUMN training_limit INTEGER NOT NULL DEFAULT 2;
ALTER TABLE training_packages ADD COLUMN training_used BIGINT NOT NULL DEFAULT 0;
ALTER TABLE training_packages ADD COLUMN lifetime BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE training_packages ADD CONSTRAINT training_quota_valid CHECK (training_used >= 0 AND training_limit >= 0 AND (lifetime = TRUE OR training_used <= training_limit));
