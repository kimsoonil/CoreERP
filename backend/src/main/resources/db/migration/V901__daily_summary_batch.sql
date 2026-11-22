-- V900 was the initial demo seed: append V901 so existing demo installations upgrade safely.
CREATE TABLE coreerp.daily_summary_sources (
  business_date date PRIMARY KEY,
  version bigint NOT NULL CHECK(version > 0)
);
CREATE TABLE coreerp.daily_summary_runs (
  id uuid PRIMARY KEY,
  business_date date NOT NULL,
  status varchar(16) NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','SKIPPED','ABANDONED')),
  source_version bigint,
  trigger_type varchar(12) NOT NULL CHECK(trigger_type IN ('MANUAL','SCHEDULED')),
  actor varchar(80) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  error_code varchar(40)
);
CREATE INDEX daily_runs_latest ON coreerp.daily_summary_runs(started_at DESC,id DESC);
CREATE TABLE coreerp.daily_summaries (
  business_date date PRIMARY KEY,
  source_version bigint NOT NULL CHECK(source_version >= 0),
  run_id uuid NOT NULL REFERENCES coreerp.daily_summary_runs(id),
  calculated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sales_amount numeric(38,0) NOT NULL CHECK(sales_amount >= 0),
  sales_shipments bigint NOT NULL CHECK(sales_shipments >= 0),
  shipped_quantity bigint NOT NULL CHECK(shipped_quantity >= 0),
  purchases bigint NOT NULL CHECK(purchases >= 0),
  ordered_quantity bigint NOT NULL CHECK(ordered_quantity >= 0),
  receipts bigint NOT NULL CHECK(receipts >= 0),
  receipt_quantity bigint NOT NULL CHECK(receipt_quantity >= 0)
);
CREATE TABLE coreerp.daily_product_summaries (
  business_date date REFERENCES coreerp.daily_summaries(business_date) ON DELETE CASCADE,
  product_id bigint REFERENCES coreerp.products(id),
  quantity bigint NOT NULL CHECK(quantity > 0),
  amount numeric(38,0) NOT NULL CHECK(amount >= 0),
  PRIMARY KEY(business_date,product_id)
);
CREATE TABLE coreerp.daily_customer_summaries (
  business_date date REFERENCES coreerp.daily_summaries(business_date) ON DELETE CASCADE,
  customer_id bigint REFERENCES coreerp.customers(id),
  quantity bigint NOT NULL CHECK(quantity > 0),
  amount numeric(38,0) NOT NULL CHECK(amount >= 0),
  PRIMARY KEY(business_date,customer_id)
);
-- Revision increments are transactional with source writes, including late cancellation/import corrections.
CREATE FUNCTION coreerp.mark_summary_date(d date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF d IS NOT NULL THEN
    INSERT INTO coreerp.daily_summary_sources VALUES(d,1)
    ON CONFLICT(business_date) DO UPDATE SET version=daily_summary_sources.version+1;
  END IF;
END $$;
CREATE FUNCTION coreerp.summary_header_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM coreerp.mark_summary_date((OLD.created_at AT TIME ZONE 'Asia/Seoul')::date); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM coreerp.mark_summary_date((NEW.created_at AT TIME ZONE 'Asia/Seoul')::date); END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION coreerp.summary_item_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_id bigint; new_id bigint; old_date date; new_date date;
BEGIN
  IF TG_TABLE_NAME='purchase_order_items' THEN
    IF TG_OP<>'INSERT' THEN SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date INTO old_date FROM coreerp.purchase_orders WHERE id=OLD.order_id; END IF;
    IF TG_OP<>'DELETE' THEN SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date INTO new_date FROM coreerp.purchase_orders WHERE id=NEW.order_id; END IF;
  ELSIF TG_TABLE_NAME='goods_receipt_items' THEN
    IF TG_OP<>'INSERT' THEN SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date INTO old_date FROM coreerp.goods_receipts WHERE id=OLD.receipt_id; END IF;
    IF TG_OP<>'DELETE' THEN SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date INTO new_date FROM coreerp.goods_receipts WHERE id=NEW.receipt_id; END IF;
  ELSIF TG_TABLE_NAME='shipment_items' THEN
    IF TG_OP<>'INSERT' THEN SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date INTO old_date FROM coreerp.shipments WHERE id=OLD.shipment_id; END IF;
    IF TG_OP<>'DELETE' THEN SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date INTO new_date FROM coreerp.shipments WHERE id=NEW.shipment_id; END IF;
  ELSE
    -- sales_order_items: snapshot selling-price correction for an existing shipment.
    IF TG_OP<>'INSERT' THEN SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date INTO old_date FROM coreerp.shipments WHERE sales_order_id=OLD.order_id; END IF;
    IF TG_OP<>'DELETE' THEN SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date INTO new_date FROM coreerp.shipments WHERE sales_order_id=NEW.order_id; END IF;
  END IF;
  PERFORM coreerp.mark_summary_date(old_date);
  IF new_date IS DISTINCT FROM old_date THEN PERFORM coreerp.mark_summary_date(new_date); END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION coreerp.summary_sale_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d date;
BEGIN
  SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date INTO d FROM coreerp.shipments WHERE sales_order_id=NEW.id;
  PERFORM coreerp.mark_summary_date(d);
  RETURN NULL;
END $$;
INSERT INTO coreerp.daily_summary_sources(business_date,version)
SELECT d,1 FROM (
  SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date d FROM coreerp.purchase_orders
  UNION SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date FROM coreerp.goods_receipts
  UNION SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date FROM coreerp.shipments
) dates;
CREATE TRIGGER summary_dirty AFTER INSERT OR UPDATE OR DELETE ON coreerp.purchase_orders FOR EACH ROW EXECUTE FUNCTION coreerp.summary_header_dirty();
CREATE TRIGGER summary_dirty AFTER INSERT OR UPDATE OR DELETE ON coreerp.goods_receipts FOR EACH ROW EXECUTE FUNCTION coreerp.summary_header_dirty();
CREATE TRIGGER summary_dirty AFTER INSERT OR UPDATE OR DELETE ON coreerp.shipments FOR EACH ROW EXECUTE FUNCTION coreerp.summary_header_dirty();
CREATE TRIGGER summary_dirty AFTER INSERT OR UPDATE OR DELETE ON coreerp.purchase_order_items FOR EACH ROW EXECUTE FUNCTION coreerp.summary_item_dirty();
CREATE TRIGGER summary_dirty AFTER INSERT OR UPDATE OR DELETE ON coreerp.goods_receipt_items FOR EACH ROW EXECUTE FUNCTION coreerp.summary_item_dirty();
CREATE TRIGGER summary_dirty AFTER INSERT OR UPDATE OR DELETE ON coreerp.shipment_items FOR EACH ROW EXECUTE FUNCTION coreerp.summary_item_dirty();
CREATE TRIGGER summary_dirty AFTER INSERT OR UPDATE OR DELETE ON coreerp.sales_order_items FOR EACH ROW EXECUTE FUNCTION coreerp.summary_item_dirty();
CREATE TRIGGER summary_dirty AFTER UPDATE ON coreerp.sales_orders FOR EACH ROW EXECUTE FUNCTION coreerp.summary_sale_dirty();
