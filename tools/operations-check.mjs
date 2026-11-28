// Destructive fault injection is restricted to an explicitly opted-in loopback demo DB.
import pg from "pg";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir, cpus, platform, arch } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const env = process.env;
assert.equal(
  env.COREERP_LOCAL_OPERATIONS,
  "1",
  "Explicit disposable-environment opt-in required",
);
const host = env.DB_HOST || "127.0.0.1",
  port = Number(env.DB_PORT || 5432);
assert.ok(["127.0.0.1", "localhost"].includes(host));
assert.equal(env.DB_NAME, "coreerp_demo");
const base = env.API_URL || "http://127.0.0.1:8080";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
assert.ok(env.APP_ADMIN_PASSWORD && env.APP_DEMO_PASSWORD && env.DB_PASSWORD);
const db = new pg.Client({
  host,
  port,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
});
await db.connect();
assert.equal(
  (
    await db.query(
      "select count(*)::int n from pg_database where datname='coreerp_restore_test'",
    )
  ).rows[0].n,
  0,
  "Use fresh disposable databases; refusing existing restore target",
);
try {
  await fetch("http://127.0.0.1:8081/api/health");
  throw new Error("Restore API port already occupied");
} catch (e) {
  if (e.message === "Restore API port already occupied") throw e;
}
const temp = await mkdtemp(join(tmpdir(), "coreerp-operations-"));
let restoredApi;
const evidence = {
  recordedAt: new Date().toISOString(),
  environment: {
    os: platform(),
    arch: arch(),
    cpu: cpus()[0].model,
    node: process.version,
    postgres: (await db.query("show server_version")).rows[0].server_version,
    api: "Java 21 / Spring Boot, pool 12, local HTTP",
    scope: "Disposable synthetic coreerp_demo only; NOT production deployment",
  },
};
function command(name, args) {
  const r = spawnSync(join(env.PG_BIN || "", name), args, {
    env: { ...env, PGPASSWORD: env.DB_PASSWORD },
    encoding: "utf8",
    timeout: 60000,
  });
  assert.equal(
    r.status,
    0,
    `${name} failed (details intentionally omitted to protect credentials)`,
  );
  return r.stdout.trim();
}
async function session(url = base) {
  let cookie = "",
    csrf;
  async function request(path, body, form = false) {
    const headers = { Cookie: cookie };
    if (body !== undefined) {
      headers[csrf.header] = csrf.token;
      headers["Content-Type"] = form
        ? "application/x-www-form-urlencoded"
        : "application/json";
    }
    const t = performance.now();
    const r = await fetch(url + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body:
        body === undefined
          ? undefined
          : form
            ? new URLSearchParams(body)
            : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const c = r.headers.getSetCookie().find((x) => x.startsWith("JSESSIONID="));
    if (c) cookie = c.split(";")[0];
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: r.status, data, ms: performance.now() - t };
  }
  csrf = (await request("/auth/csrf")).data;
  assert.equal(
    (
      await request(
        "/auth/login",
        { username: "admin", password: env.APP_ADMIN_PASSWORD },
        true,
      )
    ).status,
    200,
  );
  csrf = (await request("/auth/csrf")).data;
  return request;
}
async function group(count, concurrency, fn, durationMs = 0) {
  let next = 0;
  const results = [];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < count || performance.now() - started < durationMs) {
        const i = next++;
        results.push(await fn(i));
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const percentile = (p) => +times[Math.ceil(times.length * p) - 1].toFixed(2);
  return {
    results,
    metrics: {
      requests: results.length,
      concurrency,
      seconds: +seconds.toFixed(3),
      requestsPerSecond: +(results.length / seconds).toFixed(2),
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: times.at(-1),
      statuses: results.reduce(
        (a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a),
        {},
      ),
      latenciesMs: times.map((x) => +x.toFixed(2)),
    },
  };
}
async function stock(id) {
  return (
    await db.query(
      "select on_hand,reserved from coreerp.inventory where warehouse_id=1 and product_id=$1",
      [id],
    )
  ).rows[0];
}
async function createProduct(api, stockAmount) {
  const r = await api("/products", {
    sku: "OPS-" + randomUUID(),
    name: "운영 검증 합성 부품",
    price: 1000,
    safetyStock: 1,
  });
  assert.equal(r.status, 200);
  const id = r.data.id;
  assert.equal(
    (
      await api("/inventory/adjustments", {
        requestKey: randomUUID(),
        warehouseId: 1,
        productId: id,
        delta: stockAmount,
        reason: "일회용 운영 테스트",
      })
    ).status,
    200,
  );
  return id;
}
try {
  const api = await session();
  // Warm-up is excluded from latency sample. Closed-loop HTTP, one authenticated session.
  for (let i = 0; i < 20; i++)
    assert.equal((await api("/products?page=0&size=25")).status, 200);
  const reads = await group(
    300,
    12,
    (i) =>
      api(
        i % 2
          ? "/products?page=" + (i % 40) + "&size=25"
          : "/inventory?page=" + (i % 40) + "&size=25",
      ),
    30000,
  );
  assert.deepEqual(Object.keys(reads.metrics.statuses), ["200"]);
  evidence.readLoad = reads.metrics;
  const p = await createProduct(api, 25);
  const orders = await group(100, 16, () =>
    api("/sales", {
      requestKey: randomUUID(),
      warehouseId: 1,
      customerId: 1,
      items: [{ productId: p, quantity: 1 }],
    }),
  );
  assert.equal(orders.metrics.statuses[200], 25);
  assert.equal(orders.metrics.statuses[409], 75);
  assert.deepEqual(await stock(p), { on_hand: 25, reserved: 25 });
  evidence.hotStock = {
    ...orders.metrics,
    expectedConflicts: 75,
    stockAfter: await stock(p),
    negativeStock: false,
  };
  const saleId = orders.results.find((r) => r.status === 200).data.id;
  const shipments = await group(40, 12, () =>
    api("/sales/" + saleId + "/shipments", { requestKey: randomUUID() }),
  );
  assert.equal(shipments.metrics.statuses[200], 40);
  assert.equal(new Set(shipments.results.map((r) => r.data.id)).size, 1);
  assert.deepEqual(await stock(p), { on_hand: 24, reserved: 24 });
  evidence.duplicateShipment = {
    ...shipments.metrics,
    uniqueShipmentIds: 1,
    stockAfter: await stock(p),
  };
  // Force a real connection loss after transaction writes have started.
  const faultProduct = await createProduct(api, 10);
  const order = await api("/sales", {
    requestKey: randomUUID(),
    warehouseId: 1,
    customerId: 1,
    items: [{ productId: faultProduct, quantity: 3 }],
  });
  assert.equal(order.status, 200);
  await db.query(
    `CREATE FUNCTION coreerp.ops_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(8); RETURN NEW; END $$`,
  );
  await db.query(
    `CREATE TRIGGER ops_fault BEFORE INSERT ON coreerp.shipment_items FOR EACH ROW EXECUTE FUNCTION coreerp.ops_fault()`,
  );
  const key = randomUUID(),
    start = performance.now();
  const pending = api("/sales/" + order.data.id + "/shipments", {
    requestKey: key,
  });
  let pid;
  for (let i = 0; i < 100; i++) {
    const r = await db.query(
      "select pid from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event='PgSleep' and query ilike '%shipment_items%' ",
    );
    if (r.rows.length) {
      pid = r.rows[0].pid;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(pid, "Did not observe fault-injected transaction");
  await db.query("select pg_terminate_backend($1)", [pid]);
  const failed = await pending;
  assert.equal(failed.status, 500);
  await db.query("DROP TRIGGER ops_fault ON coreerp.shipment_items");
  await db.query("DROP FUNCTION coreerp.ops_fault()");
  assert.deepEqual(await stock(faultProduct), { on_hand: 10, reserved: 3 });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from coreerp.shipments where sales_order_id=$1",
        [order.data.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await api("/sales/" + order.data.id)).data.order.status,
    "RESERVED",
  );
  const retry = await api("/sales/" + order.data.id + "/shipments", {
    requestKey: key,
  });
  assert.equal(retry.status, 200);
  assert.deepEqual(await stock(faultProduct), { on_hand: 7, reserved: 0 });
  assert.equal(
    (await api("/sales/" + order.data.id + "/shipments", { requestKey: key }))
      .data.id,
    retry.data.id,
  );
  evidence.connectionFailure = {
    injection: "pg_terminate_backend during shipment_items trigger sleep",
    firstStatus: failed.status,
    rollback: {
      onHand: 10,
      reserved: 3,
      shipments: 0,
      orderStatus: "RESERVED",
    },
    retrySameKeyStatus: retry.status,
    afterRetry: await stock(faultProduct),
    replaySameShipment: true,
    recoveryScenarioMs: +(performance.now() - start).toFixed(2),
    limit:
      "One API DB connection loss; not a PostgreSQL server crash or failover",
  };
  // Quiescent full database backup: fingerprint every application table and sequence.
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString(
    "sv-SE",
    { timeZone: "Asia/Seoul" },
  );
  assert.equal(
    (await api("/batches/daily", { businessDate: yesterday })).status,
    200,
  );
  const tables = (
    await db.query(
      "select tablename from pg_tables where schemaname='coreerp' order by tablename",
    )
  ).rows.map((r) => r.tablename);
  async function fingerprint(client) {
    const result = {};
    for (const t of tables) {
      const q = '"' + t.replaceAll('"', '""') + '"';
      const r = await client.query(
        `select count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) digest from coreerp.${q} t`,
      );
      result[t] = r.rows[0];
    }
    return result;
  }
  async function sequences(client) {
    const names = (
      await client.query(
        "select sequencename from pg_sequences where schemaname='coreerp' order by sequencename",
      )
    ).rows;
    const out = {};
    for (const { sequencename: n } of names) {
      out[n] = (
        await client.query(
          `select last_value::text,is_called from coreerp."${n}"`,
        )
      ).rows[0];
    }
    return out;
  }
  const before = await fingerprint(db),
    seqBefore = await sequences(db);
  const args = ["-h", host, "-p", String(port), "-U", env.DB_USER];
  const archive = join(temp, "backup.dump");
  let t = performance.now();
  command("pg_dump", [
    ...args,
    "-d",
    env.DB_NAME,
    "-Fc",
    "--no-owner",
    "--no-acl",
    "-f",
    archive,
  ]);
  const backupMs = performance.now() - t;
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from pg_database where datname='coreerp_restore_test'",
      )
    ).rows[0].n,
    0,
    "Refusing to overwrite existing restore DB",
  );
  await db.query("CREATE DATABASE coreerp_restore_test");
  t = performance.now();
  command("pg_restore", [
    ...args,
    "-d",
    "coreerp_restore_test",
    "--exit-on-error",
    "--no-owner",
    "--no-acl",
    archive,
  ]);
  const restoreMs = performance.now() - t;
  const restored = new pg.Client({
    host,
    port,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: "coreerp_restore_test",
  });
  await restored.connect();
  assert.deepEqual(await fingerprint(restored), before);
  assert.deepEqual(await sequences(restored), seqBefore);
  assert.equal(
    (
      await restored.query(
        "select count(*)::int n from coreerp.inventory where on_hand<0 or reserved<0 or reserved>on_hand",
      )
    ).rows[0].n,
    0,
  );
  const date = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Seoul",
    }),
    reportPath = `/reports/sales?from=${date}&to=${date}&unit=day`;
  const reportBefore = (await api(reportPath)).data;
  const jar = resolve(env.API_JAR || "../backend/target/coreerp-api-1.0.0.jar");
  restoredApi = spawn(
    env.JAVA_BIN || "java",
    ["-jar", jar, "--server.port=8081", "--spring.profiles.active=demo"],
    {
      env: {
        ...env,
        DB_URL: `jdbc:postgresql://${host}:${port}/coreerp_restore_test`,
      },
      stdio: "ignore",
    },
  );
  let restoredRequest;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch("http://127.0.0.1:8081/api/health");
      if (r.ok) {
        restoredRequest = await session("http://127.0.0.1:8081");
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(restoredRequest, "Restored API failed to start");
  assert.deepEqual((await restoredRequest(reportPath)).data, reportBefore);
  assert.equal(
    (await restoredRequest("/products?page=0&size=25")).data.total,
    (await api("/products?page=0&size=25")).data.total,
  );
  evidence.backupRestore = {
    method: "pg_dump custom format / pg_restore into NEW database",
    clientVersion: command("pg_dump", ["--version"]),
    backupMs: +backupMs.toFixed(2),
    restoreMs: +restoreMs.toFixed(2),
    tableCount: tables.length,
    rowsByTable: Object.fromEntries(
      Object.entries(before).map(([k, v]) => [k, v.n]),
    ),
    allTableFingerprintsEqual: true,
    allSequenceValuesEqual: true,
    invalidInventoryRows: 0,
    restoredApiLogin: true,
    restoredApiSalesEqual: true,
    restoredApiProductTotalEqual: true,
    flywayStartupSucceeded: true,
    limit:
      "Quiescent logical backup, same host and same PG version; no WAL/PITR, offsite durability or production RTO/RPO validation",
  };
  await restored.end();
  await writeFile(
    resolve(env.EVIDENCE_OUTPUT || "../docs/evidence/local-operations.json"),
    JSON.stringify(evidence, null, 2).replace(
      /("latenciesMs": )\[([\d.,\s]+)\]/g,
      (_, key, values) => key + JSON.stringify(JSON.parse("[" + values + "]")),
    ) + "\n",
  );
  console.log(
    "PASS: backup/restore, API recovery, read/hot-stock/duplicate-shipment load. Evidence saved without credentials.",
  );
} finally {
  restoredApi?.kill("SIGTERM");
  await db
    .query("DROP TRIGGER IF EXISTS ops_fault ON coreerp.shipment_items")
    .catch(() => {});
  await db.query("DROP FUNCTION IF EXISTS coreerp.ops_fault()").catch(() => {});
  await db.end();
  await rm(temp, { recursive: true, force: true });
}
