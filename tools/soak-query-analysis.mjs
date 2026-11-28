import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
const e = process.env;
assert.equal(e.DB_NAME, "coreerp_perf");
assert.ok(["localhost", "127.0.0.1"].includes(e.DB_HOST));
const db = new pg.Client({
  host: e.DB_HOST,
  port: Number(e.DB_PORT),
  user: e.DB_USER,
  password: e.DB_PASSWORD,
  database: e.DB_NAME,
});
await db.connect();
try {
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from pg_namespace where nspname='coreerp'",
      )
    ).rows[0].n,
    0,
    "Fresh empty performance DB required",
  );
  await db.query("CREATE SCHEMA coreerp");
  for (const path of [
    "migration/V1__coreerp.sql",
    "demo/V900__synthetic_data.sql",
    "migration/V901__daily_summary_batch.sql",
  ])
    await db.query(
      await readFile(
        new URL("../backend/src/main/resources/db/" + path, import.meta.url),
        "utf8",
      ),
    );
  await db.query("vacuum analyze");
  const inventoryFrom = `FROM coreerp.inventory i JOIN coreerp.products p ON p.id=i.product_id JOIN coreerp.warehouses w ON w.id=i.warehouse_id`;
  const filter = `WHERE ($1::bigint IS NULL OR i.warehouse_id=$1) AND (p.sku ILIKE $2 ESCAPE '!' OR p.name ILIKE $2 ESCAPE '!')`;
  const fields = `SELECT i.*,w.name warehouse_name,p.sku,p.name,p.safety_stock`;
  const items = `FROM coreerp.shipments s JOIN coreerp.sales_orders o ON o.id=s.sales_order_id JOIN coreerp.shipment_items si ON si.shipment_id=s.id JOIN coreerp.sales_order_items oi ON oi.order_id=o.id AND oi.product_id=si.product_id WHERE s.status='CONFIRMED' AND s.created_at >= $1 AND s.created_at < $2`;
  const queries = {
    inventoryListBefore: {
      sql: `${fields} ${inventoryFrom} ${filter} ORDER BY i.warehouse_id,i.product_id LIMIT $3 OFFSET $4`,
      params: [null, "%", 25, 500],
    },
    inventoryCountBefore: {
      sql: `SELECT count(*) ${inventoryFrom.replace(" JOIN coreerp.warehouses w ON w.id=i.warehouse_id", "")} ${filter}`,
      params: [null, "%"],
    },
    inventoryListAfter: {
      sql: `${fields} ${inventoryFrom} ORDER BY i.warehouse_id,i.product_id LIMIT $1 OFFSET $2`,
      params: [25, 500],
    },
    inventoryCountAfter: {
      sql: "SELECT count(*) FROM coreerp.inventory",
      params: [],
    },
    salesByPeriod: {
      sql: `SELECT to_char(date_trunc('day', s.created_at AT TIME ZONE 'Asia/Seoul'),'YYYY-MM-DD') period,sum(oi.unit_price*si.quantity)::text amount,count(DISTINCT s.id) shipments ${items} GROUP BY 1 ORDER BY 1`,
      params: [
        new Date(new Date().setHours(0, 0, 0, 0)),
        new Date(new Date().setHours(24, 0, 0, 0)),
      ],
    },
  };
  async function measure(q, mode = "auto") {
    await db.query(`SET plan_cache_mode=${mode}`);
    await db.query("DEALLOCATE ALL");
    // PREPARE/EXECUTE exposes the generic JDBC-style path rather than only literal SQL.
    await db.query("PREPARE probe AS " + q.sql);
    const literals = q.params.map((v) =>
      v === null
        ? "NULL"
        : "'" +
          (v instanceof Date ? v.toISOString() : String(v)).replaceAll(
            "'",
            "''",
          ) +
          "'",
    );
    const execute =
      "EXECUTE probe" + (literals.length ? "(" + literals.join(",") + ")" : "");
    for (let i = 0; i < 3; i++) await db.query(execute);
    const plans = [];
    for (let i = 0; i < 7; i++)
      plans.push(
        (await db.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + execute))
          .rows[0]["QUERY PLAN"][0],
      );
    const times = plans.map((p) => p["Execution Time"]).sort((a, b) => a - b);
    const rows = (await db.query(execute)).rows;
    const preparedPlanUse = (
      await db.query(
        "select generic_plans::int,custom_plans::int from pg_prepared_statements where name='probe'",
      )
    ).rows[0];
    return {
      preparedPlanUse,
      medianMs: times[3],
      timesMs: times,
      rows,
      representativePlan: plans[3],
    };
  }
  const result = {
    recordedAt: new Date().toISOString(),
    scope:
      "One disposable PostgreSQL database, same data within before/after pair; 3 warmup + 7 EXPLAIN ANALYZE BUFFERS; SQL execution only",
    postgres: (await db.query("show server_version")).rows[0].server_version,
    queries,
    early: {},
    late: {},
  };
  for (const mode of ["auto", "force_custom_plan", "force_generic_plan"])
    for (const name of [
      "inventoryListBefore",
      "inventoryCountBefore",
      "inventoryListAfter",
      "inventoryCountAfter",
    ])
      result.early[name + "_" + mode] = await measure(queries[name], mode);
  result.early.salesByPeriod = await measure(queries.salesByPeriod);
  await db.query(
    `WITH orders AS (INSERT INTO coreerp.sales_orders(customer_id,warehouse_id,status,actor) SELECT 1,1,'CANCELLED','synthetic-performance-fixture' FROM generate_series(1,9000) RETURNING id), lines AS (INSERT INTO coreerp.sales_order_items(order_id,product_id,quantity,unit_price) SELECT id,1,1,1000 FROM orders), shipped AS (INSERT INTO coreerp.shipments(sales_order_id,status,actor,cancelled_at) SELECT id,'CANCELLED','synthetic-performance-fixture',now() FROM orders RETURNING id) INSERT INTO coreerp.shipment_items(shipment_id,product_id,quantity) SELECT id,1,1 FROM shipped`,
  );
  await db.query("vacuum analyze");
  for (const mode of ["auto", "force_custom_plan", "force_generic_plan"])
    for (const name of [
      "inventoryListBefore",
      "inventoryCountBefore",
      "inventoryListAfter",
      "inventoryCountAfter",
    ])
      result.late[name + "_" + mode] = await measure(queries[name], mode);
  result.late.salesBeforeIndex = await measure(queries.salesByPeriod);
  await db.query(
    "CREATE INDEX shipments_confirmed_created ON coreerp.shipments(created_at,id) INCLUDE(sales_order_id) WHERE status='CONFIRMED'",
  );
  await db.query("analyze coreerp.shipments");
  result.late.salesAfterIndex = await measure(queries.salesByPeriod);
  assert.deepEqual(
    result.late.salesBeforeIndex.rows,
    result.late.salesAfterIndex.rows,
  );
  for (const stage of [result.early, result.late])
    for (const mode of ["auto", "force_custom_plan", "force_generic_plan"]) {
      assert.deepEqual(
        stage["inventoryListBefore_" + mode].rows,
        stage["inventoryListAfter_" + mode].rows,
      );
      assert.deepEqual(
        stage["inventoryCountBefore_" + mode].rows,
        stage["inventoryCountAfter_" + mode].rows,
      );
    }
  result.shipmentRows = (
    await db.query(
      "select status,count(*)::int n from coreerp.shipments group by status order by status",
    )
  ).rows;
  result.equivalenceVerified = true;
  // Avoid repeated response bodies in published evidence; plans and counters remain intact.
  for (const stage of [result.early, result.late])
    for (const v of Object.values(stage)) {
      v.resultRows = v.rows.length;
      delete v.rows;
    }
  await writeFile(
    new URL("../docs/evidence/soak-query-analysis.json", import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    "PASS: query plans, seven-run medians and result equivalence recorded",
  );
  for (const [k, v] of Object.entries(result.late)) console.log(k, v.medianMs);
} finally {
  await db.end();
}
