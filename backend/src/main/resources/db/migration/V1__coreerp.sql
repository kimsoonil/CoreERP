CREATE TABLE coreerp.users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username varchar(80) UNIQUE NOT NULL,
  password varchar(100) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','LOCKED')),
  last_login_at timestamptz
);

CREATE TABLE coreerp.roles (
  code varchar(16) PRIMARY KEY CHECK(code IN('ADMIN','PURCHASE','WAREHOUSE','SALES'))
);

INSERT INTO coreerp.roles VALUES('ADMIN'),('PURCHASE'),('WAREHOUSE'),('SALES');

CREATE TABLE coreerp.user_roles (
  user_id bigint REFERENCES coreerp.users(id),
  role_code varchar(16) REFERENCES coreerp.roles(code),
  PRIMARY KEY(user_id,role_code)
);

CREATE TABLE coreerp.products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku varchar(40) UNIQUE NOT NULL,
  name varchar(120) NOT NULL,
  price bigint NOT NULL CHECK(price BETWEEN 0 AND 1000000000),
  safety_stock integer NOT NULL CHECK(safety_stock BETWEEN 0 AND 1000000),
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE coreerp.suppliers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(40) UNIQUE NOT NULL,
  name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE coreerp.customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(40) UNIQUE NOT NULL,
  name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE coreerp.warehouses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code varchar(40) UNIQUE NOT NULL,
  name varchar(120) NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE coreerp.inventory (
  warehouse_id bigint REFERENCES coreerp.warehouses(id),
  product_id bigint REFERENCES coreerp.products(id),
  on_hand integer NOT NULL DEFAULT 0 CHECK(on_hand BETWEEN 0 AND 1000000),
  reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=on_hand),
  PRIMARY KEY(warehouse_id,product_id)
);

CREATE TABLE coreerp.purchase_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id bigint NOT NULL REFERENCES coreerp.suppliers(id),
  warehouse_id bigint NOT NULL REFERENCES coreerp.warehouses(id),
  status varchar(12) NOT NULL CHECK(status IN('DRAFT','APPROVED','PARTIAL','RECEIVED','CANCELLED')),
  actor varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coreerp.purchase_order_items (
  order_id bigint REFERENCES coreerp.purchase_orders(id),
  product_id bigint REFERENCES coreerp.products(id),
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  received integer NOT NULL DEFAULT 0 CHECK(received BETWEEN 0 AND quantity),
  unit_price bigint NOT NULL CHECK(unit_price BETWEEN 0 AND 1000000000),
  PRIMARY KEY(order_id,product_id)
);

CREATE TABLE coreerp.goods_receipts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purchase_order_id bigint NOT NULL REFERENCES coreerp.purchase_orders(id),
  actor varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX receipts_po ON coreerp.goods_receipts(purchase_order_id);

CREATE TABLE coreerp.goods_receipt_items (
  receipt_id bigint REFERENCES coreerp.goods_receipts(id),
  product_id bigint REFERENCES coreerp.products(id),
  quantity integer NOT NULL CHECK(quantity>0),
  PRIMARY KEY(receipt_id,product_id)
);

CREATE TABLE coreerp.sales_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES coreerp.customers(id),
  warehouse_id bigint NOT NULL REFERENCES coreerp.warehouses(id),
  status varchar(12) NOT NULL CHECK(status IN('RESERVED','SHIPPED','CANCELLED')),
  actor varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coreerp.sales_order_items (
  order_id bigint REFERENCES coreerp.sales_orders(id),
  product_id bigint REFERENCES coreerp.products(id),
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  unit_price bigint NOT NULL CHECK(unit_price BETWEEN 0 AND 1000000000),
  PRIMARY KEY(order_id,product_id)
);

CREATE TABLE coreerp.shipments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sales_order_id bigint UNIQUE NOT NULL REFERENCES coreerp.sales_orders(id),
  status varchar(12) NOT NULL CHECK(status IN('CONFIRMED','CANCELLED')),
  actor varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);

CREATE TABLE coreerp.shipment_items (
  shipment_id bigint REFERENCES coreerp.shipments(id),
  product_id bigint REFERENCES coreerp.products(id),
  quantity integer NOT NULL CHECK(quantity>0),
  PRIMARY KEY(shipment_id,product_id)
);

CREATE TABLE coreerp.stock_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  warehouse_id bigint NOT NULL REFERENCES coreerp.warehouses(id),
  product_id bigint NOT NULL REFERENCES coreerp.products(id),
  delta integer NOT NULL CHECK(delta<>0),
  kind varchar(20) NOT NULL CHECK(kind IN('OPENING','ADJUST','RECEIPT','SHIP','SHIP_CANCEL')),
  reference_id bigint,
  actor varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coreerp.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor varchar(80) NOT NULL,
  action varchar(40) NOT NULL,
  entity_type varchar(40) NOT NULL,
  entity_id bigint,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE coreerp.requests (
  operation varchar(60),
  request_key uuid,
  fingerprint varchar(64) NOT NULL,
  result_id bigint NOT NULL,
  PRIMARY KEY(operation,request_key)
);

CREATE INDEX purchases_supplier ON coreerp.purchase_orders(supplier_id);

CREATE INDEX purchases_warehouse ON coreerp.purchase_orders(warehouse_id);

CREATE INDEX sales_customer ON coreerp.sales_orders(customer_id);

CREATE INDEX sales_warehouse ON coreerp.sales_orders(warehouse_id);

CREATE INDEX shipments_created ON coreerp.shipments(created_at);

CREATE INDEX inventory_product ON coreerp.inventory(product_id,warehouse_id);

CREATE INDEX movements_lookup ON coreerp.stock_movements(warehouse_id,product_id,created_at);

CREATE INDEX audit_created ON coreerp.audit_logs(created_at DESC,id DESC);

CREATE INDEX products_name ON coreerp.products(name,id);
