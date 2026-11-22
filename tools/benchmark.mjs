import pgModule from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { cpus, platform, arch } from "node:os";
if (!process.env.PERF_DATABASE_URL && !process.env.DB_HOST)
  throw Error(
    "Set PERF_DATABASE_URL or DB_HOST for a newly created dedicated coreerp_perf database",
  );
const c = new pgModule.Client(
  process.env.PERF_DATABASE_URL
    ? { connectionString: process.env.PERF_DATABASE_URL }
    : {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || "coreerp_perf",
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      },
);
await c.connect();
if (
  (await c.query("SELECT current_database()")).rows[0].current_database !==
  "coreerp_perf"
)
  throw Error("Dedicated perf DB required");
await c.query("CREATE SCHEMA coreerp");
await c.query(
  await readFile(
    new URL(
      "../backend/src/main/resources/db/migration/V1__coreerp.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await c.query(
  "INSERT INTO coreerp.warehouses(code,name) SELECT 'W'||n,'Synthetic warehouse '||n FROM generate_series(1,3)n;INSERT INTO coreerp.products(sku,name,price,safety_stock) SELECT 'P'||n,'Synthetic product '||n,1000,5 FROM generate_series(1,1000)n;",
);
await c.query(
  "INSERT INTO coreerp.stock_movements(warehouse_id,product_id,delta,kind,actor,created_at) SELECT 1+(n%3),1+(n%1000),CASE WHEN n%2=0 THEN 1 ELSE -1 END,'ADJUST','perf-seed','2026-01-01'::timestamptz+(n%365)*interval '1 day' FROM generate_series(1,200000)n;",
);
await c.query(
  "SET max_parallel_workers_per_gather=0;SET jit=off;DROP INDEX coreerp.movements_lookup;ANALYZE coreerp.stock_movements",
);
const sql =
  "SELECT coalesce(sum(delta),0) FROM coreerp.stock_movements WHERE warehouse_id=$1 AND product_id=$2 AND created_at >= $3 AND created_at < $4";
const params = [1, 42, "2026-11-01T00:00:00Z", "2026-11-08T00:00:00Z"];
const expected = (await c.query(sql, params)).rows[0].coalesce;
async function measure() {
  for (let i = 0; i < 3; i++) await c.query(sql, params);
  const plans = [];
  for (let i = 0; i < 7; i++)
    plans.push(
      (await c.query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params))
        .rows[0]["QUERY PLAN"][0],
    );
  return {
    medianExecutionMs: plans
      .map((p) => p["Execution Time"])
      .sort((a, b) => a - b)[3],
    executionMs: plans.map((p) => p["Execution Time"]),
    plans,
  };
}
const before = await measure();
await c.query(
  "CREATE INDEX movements_lookup ON coreerp.stock_movements(warehouse_id,product_id,created_at);ANALYZE coreerp.stock_movements",
);
const after = await measure();
if ((await c.query(sql, params)).rows[0].coalesce !== expected)
  throw Error("Result changed");
const evidence = {
  measuredAt: new Date().toISOString(),
  environment: {
    postgres: (await c.query("select version()")).rows[0].version,
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0].model,
  },
  rows: 200000,
  warehouses: 3,
  products: 1000,
  sql,
  parameters: params,
  warmup: 3,
  repeats: 7,
  scope:
    "Database Execution Time only; warm cache; serial execution; no concurrency; index creation excluded",
  expectedResult: expected,
  index:
    "CREATE INDEX movements_lookup ON coreerp.stock_movements(warehouse_id,product_id,created_at)",
  before,
  after,
};
await mkdir(new URL("../docs/evidence", import.meta.url), { recursive: true });
await writeFile(
  new URL("../docs/evidence/sql-index-benchmark.json", import.meta.url),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    rows: evidence.rows,
    beforeMs: before.medianExecutionMs,
    afterMs: after.medianExecutionMs,
    result: expected,
  }),
);
await c.end();
