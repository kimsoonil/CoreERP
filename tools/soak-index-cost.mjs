// Narrow WAL/HOT diagnostic; every measured update is rolled back in an owned fresh DB.
import pg from "pg";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const e = process.env;
assert.equal(e.DB_NAME, "coreerp_perf");
assert.ok(["127.0.0.1", "localhost"].includes(e.DB_HOST));
const db = new pg.Client({
  host: e.DB_HOST,
  port: Number(e.DB_PORT),
  database: e.DB_NAME,
  user: e.DB_USER,
  password: e.DB_PASSWORD,
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
    "Fresh disposable DB only",
  );
  await db.query("create schema coreerp");
  for (const p of [
    "migration/V1__coreerp.sql",
    "demo/V900__synthetic_data.sql",
    "migration/V901__daily_summary_batch.sql",
    "migration/V902__soak_read_paths.sql",
  ])
    await db.query(
      await readFile(
        new URL("../backend/src/main/resources/db/" + p, import.meta.url),
        "utf8",
      ),
    );
  const id = (
    await db.query(
      "select min(id) id from coreerp.shipments where status='CONFIRMED'",
    )
  ).rows[0].id;
  async function measure() {
    const plans = [];
    for (let i = 0; i < 10; i++) {
      await db.query("begin");
      try {
        const p = (
          await db.query(
            "EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) UPDATE coreerp.shipments SET status='CANCELLED',cancelled_at=now() WHERE id=$1",
            [id],
          )
        ).rows[0]["QUERY PLAN"][0];
        if (i >= 3) plans.push(p);
      } finally {
        await db.query("rollback");
      }
    }
    assert.equal(
      (await db.query("select status from coreerp.shipments where id=$1", [id]))
        .rows[0].status,
      "CONFIRMED",
    );
    const median = (vs) => vs.sort((a, b) => a - b)[3];
    return {
      medianExecutionMs: median(plans.map((p) => p["Execution Time"])),
      medianWalBytes: median(plans.map((p) => p.Plan["WAL Bytes"] || 0)),
      medianWalRecords: median(plans.map((p) => p.Plan["WAL Records"] || 0)),
      plans,
    };
  }
  const withIndex1 = await measure();
  await db.query("drop index coreerp.shipments_confirmed_created");
  const withoutIndex = await measure();
  await db.query(
    await readFile(
      new URL(
        "../backend/src/main/resources/db/migration/V902__soak_read_paths.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const withIndex2 = await measure();
  await writeFile(
    new URL("../docs/evidence/soak-index-write-cost.json", import.meta.url),
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        scope:
          "Same single confirmed shipment and trigger, rolled-back UPDATE; 3 warmup + 7 measurements in on/off/on order. Not API transaction latency or commit fsync cost.",
        withIndex1,
        withoutIndex,
        withIndex2,
        logicalStateUnchanged: true,
      },
      null,
      2,
    ) + "\n",
  );
  for (const [k, v] of Object.entries({ withIndex1, withoutIndex, withIndex2 }))
    console.log(k, v.medianExecutionMs, v.medianWalBytes, v.medianWalRecords);
} finally {
  await db.end();
}
