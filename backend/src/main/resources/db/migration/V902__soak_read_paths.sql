-- Exclude cancelled history from the live sales-report range scan.
-- Existing rows and history remain intact; no change to stock or report semantics.
CREATE INDEX shipments_confirmed_created
ON coreerp.shipments(created_at,id) INCLUDE(sales_order_id)
WHERE status='CONFIRMED';
