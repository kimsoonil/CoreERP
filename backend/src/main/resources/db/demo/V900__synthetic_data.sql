-- Synthetic data only. Flyway demo profile, isolated database.

INSERT INTO coreerp.warehouses(code, name)
SELECT 'WH-'||n,
       '합성 창고 '||n
FROM generate_series(1, 3)n;


INSERT INTO coreerp.suppliers(code, name)
SELECT 'SUP-'||lpad(n::text, 3, '0'),
       '합성 공급사 '||n
FROM generate_series(1, 20)n;


INSERT INTO coreerp.customers(code, name)
SELECT 'CUS-'||lpad(n::text, 3, '0'),
       '합성 고객사 '||n
FROM generate_series(1, 30)n;


INSERT INTO coreerp.products(sku, name, price, safety_stock)
SELECT 'SKU-'||lpad(n::text, 5, '0'),(ARRAY['산업용 센서',
                                            '포장 박스',
                                            '작업 장갑',
                                            '전원 어댑터',
                                            '물류 라벨',
                                            '모터 부품'])[1+(n%6)]||' '||n,
                                                     1000+(n%50)*1000,
                                                     5
FROM generate_series(1, 10000)n;


INSERT INTO coreerp.inventory(warehouse_id, product_id, on_hand)
SELECT w.id,
       p.id,
       CASE
           WHEN p.id<=10 THEN 3
           ELSE 100
       END
FROM coreerp.warehouses w
CROSS JOIN coreerp.products p;


INSERT INTO coreerp.stock_movements(warehouse_id, product_id, delta, kind, actor)
SELECT warehouse_id,
       product_id,
       on_hand,
       'OPENING',
       'demo-seed'
FROM coreerp.inventory;


INSERT INTO coreerp.purchase_orders(supplier_id, warehouse_id, status, actor, created_at)
SELECT 1+(n%20),
       1+(n%3),
       'APPROVED',
       'demo-seed',
       (CURRENT_DATE-(n%30))::timestamp AT TIME ZONE 'ASIA/SEOUL'
FROM generate_series(1, 120)n;


INSERT INTO coreerp.purchase_order_items(order_id, product_id, quantity, unit_price)
SELECT o.id,
       11+(o.id%200),
       20,
       p.price*7/10
FROM coreerp.purchase_orders o
JOIN coreerp.products p ON p.id=11+(o.id%200);


INSERT INTO coreerp.goods_receipts(purchase_order_id, actor, created_at)
SELECT id,
       'demo-seed',
       created_at+interval '9 hours'
FROM coreerp.purchase_orders
WHERE id<=12;


INSERT INTO coreerp.goods_receipt_items(receipt_id, product_id, quantity)
SELECT g.id,
       i.product_id,
       5
FROM coreerp.goods_receipts g
JOIN coreerp.purchase_order_items i ON i.order_id=g.purchase_order_id;


UPDATE coreerp.purchase_orders
SET status='PARTIAL'
WHERE id<=12;


UPDATE coreerp.purchase_order_items
SET received=5
WHERE order_id<=12;


UPDATE coreerp.inventory i
SET on_hand=on_hand+5
FROM coreerp.purchase_orders o
JOIN coreerp.purchase_order_items p ON p.order_id=o.id
WHERE o.id<=12
  AND i.warehouse_id=o.warehouse_id
  AND i.product_id=p.product_id;


INSERT INTO coreerp.stock_movements(warehouse_id, product_id, delta, kind, reference_id, actor, created_at)
SELECT o.warehouse_id,
       i.product_id,
       i.quantity,
       'RECEIPT',
       g.id,
       'demo-seed',
       g.created_at
FROM coreerp.goods_receipts g
JOIN coreerp.purchase_orders o ON o.id=g.purchase_order_id
JOIN coreerp.goods_receipt_items i ON i.receipt_id=g.id;


INSERT INTO coreerp.sales_orders(customer_id, warehouse_id, status, actor, created_at)
SELECT 1+(n%30),
       1+(n%3),
       CASE
           WHEN n<=90 THEN 'SHIPPED'
           ELSE 'RESERVED'
       END,
       'demo-seed',
       (CURRENT_DATE-(n%30))::timestamp AT TIME ZONE 'ASIA/SEOUL'
FROM generate_series(1, 95)n;


INSERT INTO coreerp.sales_order_items(order_id, product_id, quantity, unit_price)
SELECT o.id,
       p.id,
       1+(o.id%3),
       p.price
FROM coreerp.sales_orders o
JOIN coreerp.products p ON p.id IN(1000+(o.id%100),
                                   2000+(o.id%100));


INSERT INTO coreerp.shipments(sales_order_id, status, actor, created_at)
SELECT id,
       'CONFIRMED',
       'demo-seed',
       created_at+interval '10 hours'
FROM coreerp.sales_orders
WHERE status='SHIPPED';


INSERT INTO coreerp.shipment_items(shipment_id, product_id, quantity)
SELECT s.id,
       i.product_id,
       i.quantity
FROM coreerp.shipments s
JOIN coreerp.sales_order_items i ON i.order_id=s.sales_order_id;


UPDATE coreerp.inventory i
SET on_hand=on_hand-x.quantity
FROM
  (SELECT o.warehouse_id,
          si.product_id,
          sum(si.quantity)::int quantity
   FROM coreerp.shipment_items si
   JOIN coreerp.shipments s ON s.id=si.shipment_id
   JOIN coreerp.sales_orders o ON o.id=s.sales_order_id
   GROUP BY o.warehouse_id,
            si.product_id)x
WHERE i.warehouse_id=x.warehouse_id
  AND i.product_id=x.product_id;


UPDATE coreerp.inventory i
SET reserved=x.quantity
FROM
  (SELECT o.warehouse_id,
          si.product_id,
          sum(si.quantity)::int quantity
   FROM coreerp.sales_order_items si
   JOIN coreerp.sales_orders o ON o.id=si.order_id
   WHERE o.status='RESERVED'
   GROUP BY o.warehouse_id,
            si.product_id)x
WHERE i.warehouse_id=x.warehouse_id
  AND i.product_id=x.product_id;


INSERT INTO coreerp.stock_movements(warehouse_id, product_id, delta, kind, reference_id, actor, created_at)
SELECT o.warehouse_id,
       i.product_id,-i.quantity,
                     'SHIP',
                     s.id,
                     'demo-seed',
                     s.created_at
FROM coreerp.shipments s
JOIN coreerp.sales_orders o ON o.id=s.sales_order_id
JOIN coreerp.shipment_items i ON i.shipment_id=s.id;


INSERT INTO coreerp.audit_logs(actor, action, entity_type, details)
VALUES('demo-seed','DEMO_SEED','SYSTEM','{"synthetic":true}');
