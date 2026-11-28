// Owns NEW temporary clusters and child APIs only. Never accepts an existing DB directory.
import pg from "pg";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  appendFile,
  readFile,
  rm,
  chmod,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { finished } from "node:stream/promises";
import { tmpdir, cpus, platform, arch } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import net from "node:net";
const env = process.env;
assert.equal(
  env.COREERP_RECOVERY_SOAK,
  "1",
  "Explicit isolated fault-injection opt-in required",
);
const serverBin = env.PG_SERVER_BIN,
  clientBin = env.PG_CLIENT_BIN || serverBin;
assert.ok(serverBin && clientBin, "PostgreSQL binary directories required");
const minutes = Number(env.SOAK_MINUTES || 15);
assert.ok(Number.isInteger(minutes) && minutes >= 15 && minutes <= 120);
const java = env.JAVA_BIN || "java",
  jar = resolve(env.API_JAR || "../backend/target/coreerp-api-1.0.0.jar");
const output = resolve(env.EVIDENCE_DIR || "../docs/evidence");
const root = await mkdtemp(join(tmpdir(), "coreerp-recovery-"));
await chmod(root, 0o700);
const source = join(root, "source"),
  recovered = join(root, "recovered"),
  wal = join(root, "wal"),
  backup = join(root, "base");
await mkdir(wal);
const password = randomBytes(24).toString("hex"),
  admin = randomBytes(24).toString("hex"),
  demo = randomBytes(24).toString("hex");
const pwfile = join(root, "pw");
await writeFile(pwfile, password + "\n", { mode: 0o600 });
const sourcePort = 55448,
  recoveryPort = 55449,
  apiPort = 8180,
  recoveryApiPort = 8181;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let app, restoredApp, db, sampleZip, sampleFile;
let cleanupPromise;
function cleanup() {
  return cleanupPromise ??= (async () => {

  for (const child of [restoredApp, app])
    if (child && child.exitCode === null) child.kill("SIGTERM");
  await db?.end().catch(() => {});
  for (const dir of [recovered, source]) {
    try {
      ctl(dir, "stop", ["-m", "immediate"]);
    } catch {}
  }
  sampleZip?.end();
  await rm(root, { recursive: true, force: true });

  })();
}
for (const [signal, status] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(status)); });
}

function cmd(bin, name, args, timeout = 60000) {
  const r = spawnSync(join(bin, name), args, {
    env: { ...env, PGPASSWORD: password, LC_ALL: "C" },
    encoding: "utf8",
    timeout,
  });
  assert.equal(
    r.status,
    0,
    `${name} failed; inspect private temporary logs (no credentials printed)`,
  );
  return r.stdout.trim();
}
function ctl(dir, action, options = []) {
  return cmd(serverBin, "pg_ctl", [
    "-D",
    dir,
    "-w",
    "-t",
    "30",
    ...(action === "start"
      ? ["-l", join(root, dir === source ? "source.log" : "recovered.log")]
      : []),
    ...options,
    action,
  ]);
}
async function connection(port = sourcePort, database = "coreerp_demo") {
  const c = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database,
    connectionTimeoutMillis: 3000,
  });
  c.on("error", () => {});
  await c.connect();
  return c;
}
function apiProcess(port, pgport) {
  return spawn(
    java,
    ["-jar", jar, "--server.port=" + port, "--spring.profiles.active=demo"],
    {
      env: {
        ...env,
        DB_URL: `jdbc:postgresql://127.0.0.1:${pgport}/coreerp_demo`,
        DB_USER: "postgres",
        DB_PASSWORD: password,
        APP_ADMIN_PASSWORD: admin,
        APP_DEMO_PASSWORD: demo,
      },
      stdio: "ignore",
    },
  );
}
async function ready(port, child) {
  for (let i = 0; i < 300; i++) {
    assert.equal(child.exitCode, null, "Owned API exited before readiness");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("Owned API readiness timeout");
}
async function session(port = apiPort) {
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
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api` + path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body:
          body === undefined
            ? undefined
            : form
              ? new URLSearchParams(body)
              : JSON.stringify(body),
        signal: AbortSignal.timeout(40000),
      });
      const c = r.headers
        .getSetCookie()
        .find((v) => v.startsWith("JSESSIONID="));
      if (c) cookie = c.split(";")[0];
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: r.status, data, ms: performance.now() - t };
    } catch {
      return { status: 0, data: null, ms: performance.now() - t };
    }
  }
  csrf = (await request("/auth/csrf")).data;
  assert.equal(
    (await request("/auth/login", { username: "admin", password: admin }, true))
      .status,
    200,
  );
  csrf = (await request("/auth/csrf")).data;
  return request;
}
async function product(api, qty) {
  const p = await api("/products", {
    sku: "REC-" + randomUUID(),
    name: "복구·지속 부하 합성 부품",
    price: 1000,
    safetyStock: 1,
  });
  assert.equal(p.status, 200);
  assert.equal(
    (
      await api("/inventory/adjustments", {
        requestKey: randomUUID(),
        warehouseId: 1,
        productId: p.data.id,
        delta: qty,
        reason: "일회용 복구 실험",
      })
    ).status,
    200,
  );
  return p.data.id;
}
async function sale(api, p, n = 1) {
  const r = await api("/sales", {
    requestKey: randomUUID(),
    warehouseId: 1,
    customerId: 1,
    items: [{ productId: p, quantity: n }],
  });
  assert.equal(r.status, 200);
  return r.data.id;
}
async function stock(p, c = db) {
  return (
    await c.query(
      "select on_hand,reserved from coreerp.inventory where warehouse_id=1 and product_id=$1",
      [p],
    )
  ).rows[0];
}
async function fingerprint(c) {
  const out = {};
  const tables = (
    await c.query(
      "select tablename from pg_tables where schemaname='coreerp' order by tablename",
    )
  ).rows;
  for (const { tablename: t } of tables) {
    out[t] = (
      await c.query(
        `select count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) digest from coreerp."${t}" t`,
      )
    ).rows[0];
  }
  return out;
}
const result = {
  recordedAt: new Date().toISOString(),
  environment: {
    os: platform(),
    arch: arch(),
    cpu: cpus()[0].model,
    node: process.version,
    server: cmd(serverBin, "postgres", ["--version"]),
    basebackupClient: cmd(clientBin, "pg_basebackup", ["--version"]),
    api: "Java 21, Spring Boot, Hikari maximum 12",
    scope:
      "New temporary loopback-only clusters and owned child APIs; NOT production deployment",
  },
};
try {
  for (const port of [sourcePort, recoveryPort, apiPort, recoveryApiPort]) {
    await new Promise((ok, no) => {
      const s = net.createServer();
      s.once("error", no);
      s.listen(port, "127.0.0.1", () => s.close(ok));
    });
  }
  cmd(serverBin, "initdb", [
    "-D",
    source,
    "-U",
    "postgres",
    "--pwfile=" + pwfile,
    "--auth=scram-sha-256",
    "--encoding=UTF8",
    "--locale=C",
  ]);
  await appendFile(
    join(source, "postgresql.conf"),
    `\nlisten_addresses='127.0.0.1'\nport=${sourcePort}\nwal_level=replica\narchive_mode=on\narchive_command='test ! -f ${wal}/%f && cp %p ${wal}/%f'\nmax_wal_senders=5\n`,
  );
  ctl(source, "start");
  let c = await connection(sourcePort, "postgres");
  await c.query("create database coreerp_demo");
  await c.end();
  app = apiProcess(apiPort, sourcePort);
  await ready(apiPort, app);
  db = await connection();
  let api = await session();
  // Physical backup followed by two real committed shipment transactions.
  const p = await product(api, 20);
  cmd(
    clientBin,
    "pg_basebackup",
    [
      "-h",
      "127.0.0.1",
      "-p",
      String(sourcePort),
      "-U",
      "postgres",
      "-D",
      backup,
      "-Fp",
      "-X",
      "stream",
      "-c",
      "fast",
    ],
    120000,
  );
  const a = await sale(api, p, 3);
  assert.equal(
    (await api(`/sales/${a}/shipments`, { requestKey: randomUUID() })).status,
    200,
  );
  const day = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Seoul",
    }),
    reportPath = `/reports/sales?from=${day}&to=${day}&unit=day`;
  const expectedReport = (await api(reportPath)).data,
    expected = await fingerprint(db);
  const point = (
    await db.query(
      "select pg_create_restore_point('coreerp_before_later_trade')::text lsn,clock_timestamp()::text target_time",
    )
  ).rows[0];
  const b = await sale(api, p, 4);
  assert.equal(
    (await api(`/sales/${b}/shipments`, { requestKey: randomUUID() })).status,
    200,
  );
  assert.deepEqual(await stock(p), { on_hand: 13, reserved: 0 });
  const segment = (
    await db.query("select pg_walfile_name(pg_current_wal_lsn()) segment")
  ).rows[0].segment;
  await db.query("select pg_switch_wal()");
  for (let i = 0; i < 300; i++) {
    try {
      if ((await readFile(join(wal, segment))).length > 0) break;
    } catch {}
    if (i === 299) throw new Error("WAL archive timeout");
    await sleep(100);
  }
  const { cp } = await import("node:fs/promises");
  await cp(backup, recovered, { recursive: true });
  await chmod(recovered, 0o700);
  await appendFile(
    join(recovered, "postgresql.auto.conf"),
    `\nport=${recoveryPort}\narchive_mode=off\narchive_command=''\nrestore_command='cp ${wal}/%f %p'\nrecovery_target_name='coreerp_before_later_trade'\nrecovery_target_action='promote'\n`,
  );
  await writeFile(join(recovered, "recovery.signal"), "");
  const recoveryStarted = performance.now();
  ctl(recovered, "start");
  const restored = await connection(recoveryPort);
  for (let i = 0; i < 300; i++) {
    if (!(await restored.query("select pg_is_in_recovery() r")).rows[0].r)
      break;
    await sleep(100);
  }
  assert.equal(
    (await restored.query("select pg_is_in_recovery() r")).rows[0].r,
    false,
    "Recovery target must be reached and promoted before validation",
  );
  assert.deepEqual(await fingerprint(restored), expected);
  assert.deepEqual(await stock(p, restored), { on_hand: 17, reserved: 0 });
  assert.equal(
    (
      await restored.query(
        "select count(*)::int n from coreerp.sales_orders where id=$1",
        [b],
      )
    ).rows[0].n,
    0,
  );
  restoredApp = apiProcess(recoveryApiPort, recoveryPort);
  await ready(recoveryApiPort, restoredApp);
  const restoredRequest = await session(recoveryApiPort);
  assert.deepEqual((await restoredRequest(reportPath)).data, expectedReport);
  result.pitr = {
    method:
      "Physical pg_basebackup + archived WAL + named recovery target, promoted NEW cluster",
    targetName: "coreerp_before_later_trade",
    targetLsn: point.lsn,
    targetTime: point.target_time,
    tablesCompared: Object.keys(expected).length,
    allTableFingerprintsEqual: true,
    earlierCommittedShipmentPresent: true,
    laterCommittedOrderAbsent: true,
    sourceStockAfterLaterTrade: { onHand: 13, reserved: 0 },
    recoveredStock: { onHand: 17, reserved: 0 },
    restoredApiLogin: true,
    restoredApiSalesEqual: true,
    measuredRecoveryAndApiMs: +(performance.now() - recoveryStarted).toFixed(2),
    limits:
      "Local named WAL restore point, same machine/storage; no remote archive or production RPO/RTO claim; physical recovery can advance sequences",
  };
  await restored.end();
  restoredApp.kill("SIGTERM");
  await new Promise((r) => restoredApp.once("exit", r));
  restoredApp = undefined;
  ctl(recovered, "stop", ["-m", "fast"]);
  console.log(
    "PASS: archived-WAL point-in-time recovery before later committed trade",
  );
  // Abruptly stop ALL PostgreSQL processes while an API shipment transaction is in progress.
  const crashP = await product(api, 10),
    crashOrder = await sale(api, crashP, 3),
    key = randomUUID();
  await db.query(
    `create function coreerp.recovery_fault() returns trigger language plpgsql as $$ begin perform pg_sleep(15); return NEW; end $$`,
  );
  await db.query(
    "create trigger recovery_fault before insert on coreerp.shipment_items for each row execute function coreerp.recovery_fault()",
  );
  const inFlight = api(`/sales/${crashOrder}/shipments`, { requestKey: key });
  let sleeping = false;
  for (let i = 0; i < 200; i++) {
    if (
      (
        await db.query(
          "select 1 from pg_stat_activity where datname=current_database() and wait_event='PgSleep' and query ilike '%shipment_items%' ",
        )
      ).rows.length
    ) {
      sleeping = true;
      break;
    }
    await sleep(50);
  }
  assert.ok(sleeping);
  const crashStarted = performance.now();
  ctl(source, "stop", ["-m", "immediate"]);
  const failed = await inFlight;
  assert.equal(failed.status, 500);
  app.kill("SIGKILL");
  await new Promise((r) => app.once("exit", r));
  app = undefined;
  await db.end().catch(() => {});
  ctl(source, "start");
  db = await connection();
  assert.deepEqual(await stock(crashP), { on_hand: 10, reserved: 3 });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from coreerp.shipments where sales_order_id=$1",
        [crashOrder],
      )
    ).rows[0].n,
    0,
  );
  assert.deepEqual(await stock(p), { on_hand: 13, reserved: 0 });
  await db.query("drop trigger recovery_fault on coreerp.shipment_items");
  await db.query("drop function coreerp.recovery_fault()");
  app = apiProcess(apiPort, sourcePort);
  await ready(apiPort, app);
  assert.equal((await api("/auth/me")).status, 401);
  api = await session();
  assert.equal(
    (await api(`/sales/${crashOrder}`)).data.order.status,
    "RESERVED",
  );
  assert.equal(
    (await api(`/sales/${crashOrder}/shipments`, { requestKey: key })).status,
    200,
  );
  assert.deepEqual(await stock(crashP), { on_hand: 7, reserved: 0 });
  result.serverCrash = {
    injection:
      "pg_ctl stop -m immediate (entire PostgreSQL instance) during shipment; SIGKILL owned Java API; restart both",
    inFlightStatus: failed.status,
    committedTradeSurvived: true,
    uncommittedShipmentRolledBack: true,
    stockAfterCrash: { onHand: 10, reserved: 3 },
    oldSessionAfterApiRestart: 401,
    reloginAndSameKeyRetry: 200,
    stockAfterRetry: { onHand: 7, reserved: 0 },
    recoveryToSuccessfulRetryMs: +(performance.now() - crashStarted).toFixed(2),
    crashRecoveryLogObserved: (
      await readFile(join(root, "source.log"), "utf8")
    ).includes("database system was interrupted"),
    limits:
      "Service processes on one host, NOT OS power loss, disk corruption, multi-node failover, or operator response time",
  };
  console.log(
    "PASS: complete PostgreSQL/API process crash and restart; committed/rolled-back states verified",
  );
  // 15-minute paced mixed workload, eight independent authenticated sessions.
  const soakProduct = await product(api, 100000),
    clients = await Promise.all(Array.from({ length: 8 }, () => session()));
  for (let i = 0; i < 30; i++)
    assert.equal((await clients[0]("/products?page=0&size=25")).status, 200);
  await mkdir(output, { recursive: true });
  sampleFile = createWriteStream(join(output, "recovery-soak-samples.csv.gz"));
  sampleZip = createGzip();
  sampleZip.pipe(sampleFile);
  sampleZip.write("elapsed_ms,operation,status,latency_ms\n");
  const started = performance.now(),
    buckets = [],
    all = [],
    statuses = {},
    operations = {};
  let cycles = 0,
    failures = 0,
    sequence = 0;
  function record(op, r) {
    const elapsed = performance.now() - started,
      index = Math.floor(elapsed / 60000);
    const bucket =
      buckets[index] ||
      (buckets[index] = { minute: index + 1, times: [], statuses: {} });
    bucket.times.push(r.ms);
    bucket.statuses[r.status] = (bucket.statuses[r.status] || 0) + 1;
    all.push(r.ms);
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    operations[op] = (operations[op] || 0) + 1;
    if (r.status !== 200) failures++;
    sampleZip.write(
      `${elapsed.toFixed(2)},${op},${r.status},${r.ms.toFixed(2)}\n`,
    );
  }
  const progress = setInterval(
    () =>
      console.log(
        `SOAK progress: ${Math.floor((performance.now() - started) / 60000)} min, ${all.length} HTTP responses, unexpected=${failures}`,
      ),
    60000,
  );
  const resources = [];
  const resourceTimer = setInterval(async () => {
    try {
      resources.push({
        elapsedSeconds: Math.round((performance.now() - started) / 1000),
        javaRssKiB: Number(
          spawnSync("ps", ["-o", "rss=", "-p", String(app.pid)], {
            encoding: "utf8",
          }).stdout.trim(),
        ),
        databaseBytes: Number(
          (await db.query("select pg_database_size(current_database()) n"))
            .rows[0].n,
        ),
      });
    } catch {}
  }, 60000);
  try {
    await Promise.all(
      clients.map(async (client, i) => {
        while (performance.now() - started < minutes * 60000) {
          if (i < 6) {
            const n = sequence++,
              op = n % 3;
            const path =
              op === 0
                ? "/products?page=" + (n % 40) + "&size=25"
                : op === 1
                  ? "/inventory?page=" + (n % 40) + "&size=25"
                  : reportPath;
            record(
              ["products", "inventory", "salesReport"][op],
              await client(path),
            );
            await sleep(40);
          } else {
            const order = await client("/sales", {
              requestKey: randomUUID(),
              warehouseId: 1,
              customerId: 1,
              items: [{ productId: soakProduct, quantity: 1 }],
            });
            record("reserve", order);
            if (order.status === 200) {
              const shipped = await client(
                `/sales/${order.data.id}/shipments`,
                { requestKey: randomUUID() },
              );
              record("ship", shipped);
              if (shipped.status === 200) {
                const cancelled = await client(
                  `/sales/${order.data.id}/shipment-cancellation`,
                  {},
                );
                record("cancelShipment", cancelled);
                if (cancelled.status === 200) cycles++;
              }
            }
            await sleep(200);
          }
        }
      }),
    );
  } finally {
    clearInterval(progress);
    clearInterval(resourceTimer);
    sampleZip.end();
    await finished(sampleFile);
  }
  const summarize = (times) => {
    times.sort((a, b) => a - b);
    return {
      requests: times.length,
      p50Ms: +times[Math.ceil(times.length * 0.5) - 1].toFixed(2),
      p95Ms: +times[Math.ceil(times.length * 0.95) - 1].toFixed(2),
      p99Ms: +times[Math.ceil(times.length * 0.99) - 1].toFixed(2),
      maxMs: +times.at(-1).toFixed(2),
    };
  };
  const actualSeconds = (performance.now() - started) / 1000;
  assert.equal(failures, 0);
  assert.deepEqual(await stock(soakProduct), { on_hand: 100000, reserved: 0 });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from coreerp.inventory where on_hand<0 or reserved<0 or reserved>on_hand",
      )
    ).rows[0].n,
    0,
  );
  result.soak = {
    configuredMinutes: minutes,
    actualSeconds: +actualSeconds.toFixed(3),
    sessions: 8,
    readWorkers: 6,
    writeWorkers: 2,
    readThinkTimeMs: 40,
    writeCycleThinkTimeMs: 200,
    warmupExcluded: 30,
    ...summarize(all),
    statuses,
    operations,
    completedReserveShipCancelCycles: cycles,
    finalStock: { onHand: 100000, reserved: 0 },
    invalidInventoryRows: 0,
    perMinute: buckets
      .filter(Boolean)
      .map((b) => ({
        minute: b.minute,
        ...summarize(b.times),
        statuses: b.statuses,
      })),
    resourceSamples: resources,
    rawSamples: "recovery-soak-samples.csv.gz",
    limits:
      "15-minute paced closed-loop local mixed workload; not 24-hour soak, saturation capacity, real concurrent user count, or proof against memory leaks",
  };
  await writeFile(
    join(output, "recovery-soak.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `PASS: ${minutes}-minute mixed soak, ${all.length} requests, zero unexpected failures; evidence saved`,
  );
} finally {
  await cleanup();
}
