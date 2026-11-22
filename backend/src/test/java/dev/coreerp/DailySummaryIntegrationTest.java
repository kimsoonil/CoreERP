package dev.coreerp;

import static dev.coreerp.BatchModels.*;
import static dev.coreerp.MasterService.Kind.*;
import static dev.coreerp.Models.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.math.BigInteger;
import java.sql.Connection;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
    properties = {"app.admin-password=test-admin-password-123", "spring.profiles.active=test"})
@AutoConfigureMockMvc
class DailySummaryIntegrationTest extends PostgresTestSupport {
  @Autowired DailySummaryService batch;
  @Autowired DailySummaryMapper daily;
  @Autowired BusinessService business;
  @Autowired MasterService masters;
  @Autowired CoreMapper core;
  @Autowired UserService users;
  @Autowired JdbcTemplate sql;
  @Autowired MockMvc mvc;
  @Autowired DataSource dataSource;
  @Autowired ApplicationContext context;
  LocalDate date;
  long warehouse, supplier, customer, otherCustomer, a, b, firstSale, secondSale;

  @BeforeEach
  void fixture() {
    assertTrue(sql.queryForObject("SELECT current_database()", String.class).endsWith("_test"));
    sql.execute(
        "TRUNCATE"
            + " coreerp.daily_product_summaries,coreerp.daily_customer_summaries,coreerp.daily_summaries,coreerp.daily_summary_runs,coreerp.daily_summary_sources,coreerp.requests,coreerp.audit_logs,coreerp.stock_movements,coreerp.shipment_items,coreerp.shipments,coreerp.sales_order_items,coreerp.sales_orders,coreerp.goods_receipt_items,coreerp.goods_receipts,coreerp.purchase_order_items,coreerp.purchase_orders,coreerp.inventory,coreerp.products,coreerp.suppliers,coreerp.customers,coreerp.warehouses"
            + " RESTART IDENTITY CASCADE");
    for (String role : List.of("PURCHASE", "WAREHOUSE", "SALES"))
      if (core.account(role.toLowerCase()) == null)
        users.create("admin", new UserInput(role.toLowerCase(), "test-member-password-123", role));
    sql.update("UPDATE coreerp.users SET status='ACTIVE'");
    date = batch.today().minusDays(1);
    warehouse = masters.save("admin", WAREHOUSES, null, new MasterInput("W1", "창고"));
    supplier = masters.save("admin", SUPPLIERS, null, new MasterInput("S1", "공급사"));
    customer = masters.save("admin", CUSTOMERS, null, new MasterInput("C1", "고객사 1"));
    otherCustomer = masters.save("admin", CUSTOMERS, null, new MasterInput("C2", "고객사 2"));
    a = masters.product("admin", null, new ProductInput("A", "상품 A", 1000, 5));
    b = masters.product("admin", null, new ProductInput("B", "상품 B", 2000, 5));
    for (long p : List.of(a, b))
      business.adjust("admin", new Adjustment(UUID.randomUUID(), warehouse, p, 100, "일별 검사 초기 재고"));
    long po =
        business.createPurchase(
            "admin",
            new PurchaseInput(
                UUID.randomUUID(),
                warehouse,
                supplier,
                List.of(new BuyLine(a, 10, 700), new BuyLine(b, 20, 1400))));
    business.approve("admin", po);
    long receipt =
        business.receive(
            "admin",
            po,
            new ReceiptInput(UUID.randomUUID(), List.of(new Line(a, 4), new Line(b, 5))));
    sql.update("UPDATE coreerp.purchase_orders SET created_at=? WHERE id=?", time(date, 9), po);
    sql.update(
        "UPDATE coreerp.goods_receipts SET created_at=? WHERE id=?", time(date, 10), receipt);
    firstSale = sale(customer, List.of(new Line(a, 3), new Line(b, 2)), date, 11);
    secondSale = sale(otherCustomer, List.of(new Line(b, 1)), date, 12);
  }

  OffsetDateTime time(LocalDate d, int hour) {
    return d.atTime(hour, 0).atZone(ZoneId.of("Asia/Seoul")).toOffsetDateTime();
  }

  long sale(long customer, List<Line> items, LocalDate d, int hour) {
    long id =
        business.createSale("admin", new SalesInput(UUID.randomUUID(), warehouse, customer, items));
    business.ship("admin", id, new RequestKey(UUID.randomUUID()));
    sql.update(
        "UPDATE coreerp.shipments SET created_at=? WHERE sales_order_id=?", time(d, hour), id);
    return id;
  }

  RunResult run() {
    return batch.run(date, "admin", "MANUAL");
  }

  void waitFor(BooleanSupplier condition) throws Exception {
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while (!condition.getAsBoolean()) {
      if (System.nanoTime() > end) fail("Timed out waiting for deterministic database pause");
      Thread.sleep(10);
    }
  }

  void installPause() {
    sql.execute(
        "CREATE FUNCTION coreerp.pause_summary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN"
            + " PERFORM pg_advisory_xact_lock(77,901); RETURN NEW; END $$");
    sql.execute(
        "CREATE TRIGGER pause_summary BEFORE INSERT ON coreerp.daily_summaries FOR EACH ROW EXECUTE"
            + " FUNCTION coreerp.pause_summary()");
  }

  void dropPause() {
    sql.execute("DROP TRIGGER IF EXISTS pause_summary ON coreerp.daily_summaries");
    sql.execute("DROP FUNCTION IF EXISTS coreerp.pause_summary()");
  }

  @Test
  void aggregateMatchesRawSalesProductsCustomersAndFlows() {
    var r = run();
    assertEquals("SUCCEEDED", r.status());
    var s = daily.summary(date);
    assertEquals("9000", s.salesAmount());
    assertEquals(2, s.salesShipments());
    assertEquals(6, s.shippedQuantity());
    assertEquals(1, s.purchases());
    assertEquals(30, s.orderedQuantity());
    assertEquals(1, s.receipts());
    assertEquals(9, s.receiptQuantity());
    assertFalse(s.stale());
    var from = time(date, 0);
    var to = time(date.plusDays(1), 0);
    assertEquals(core.salesByPeriod(from, to, "day").getFirst().amount(), s.salesAmount());
    assertEquals(core.productSales(from, to), daily.products(date));
    assertEquals(core.customerSales(from, to), daily.customers(date));
    var f = core.flowStats(from, to).getFirst();
    assertEquals(f.receiptQuantity(), s.receiptQuantity());
    assertEquals(f.orderedQuantity(), s.orderedQuantity());
  }

  @Test
  void repeatedRunSkipsWithoutDuplicatingOrReplacingSnapshot() {
    run();
    var before = daily.summary(date);
    assertEquals("SKIPPED", run().status());
    assertEquals(before, daily.summary(date));
    assertEquals(
        1, sql.queryForObject("SELECT count(*) FROM coreerp.daily_summaries", Integer.class));
    assertEquals(
        2,
        sql.queryForObject("SELECT count(*) FROM coreerp.daily_product_summaries", Integer.class));
    assertEquals(2, daily.runCount());
  }

  @Test
  void lateCancellationMarksStaleAndRebuildDeletesOldDimensions() {
    run();
    business.cancelShipment("admin", firstSale);
    assertTrue(daily.summary(date).stale());
    assertEquals("SUCCEEDED", run().status());
    var s = daily.summary(date);
    assertEquals("2000", s.salesAmount());
    assertFalse(s.stale());
    assertEquals(1, daily.products(date).size());
    assertEquals(b, daily.products(date).getFirst().productId());
    assertEquals(1, daily.customers(date).size());
    business.cancelShipment("admin", secondSale);
    run();
    assertEquals("0", daily.summary(date).salesAmount());
    assertTrue(daily.products(date).isEmpty());
    assertTrue(daily.customers(date).isEmpty());
  }

  @Test
  void futureOrOpenDayIsRejectedAndEmptyClosedDateIsExplicitZero() {
    assertThrows(BusinessException.class, () -> batch.run(batch.today(), "admin", "MANUAL"));
    assertThrows(
        BusinessException.class, () -> batch.run(batch.today().plusDays(1), "admin", "MANUAL"));
    var empty = date.minusDays(40);
    assertEquals("SUCCEEDED", batch.run(empty, "admin", "MANUAL").status());
    assertEquals("0", daily.summary(empty).salesAmount());
    assertEquals(0, daily.summary(empty).sourceVersion());
    assertEquals("SKIPPED", batch.run(empty, "admin", "MANUAL").status());
  }

  @Test
  void kstBoundaryIncludesMidnightAndExcludesFollowingMidnight() {
    sql.update(
        "UPDATE coreerp.shipments SET created_at=? WHERE sales_order_id=?",
        time(date, 0).minusSeconds(1),
        firstSale);
    sql.update(
        "UPDATE coreerp.shipments SET created_at=? WHERE sales_order_id=?",
        time(date, 0),
        secondSale);
    sale(customer, List.of(new Line(a, 1)), date.plusDays(1), 0);
    run();
    assertEquals("2000", daily.summary(date).salesAmount());
    assertEquals(1, daily.summary(date).salesShipments());
  }

  @Test
  void failureRollsBackReplacementAndSurvivesInJournalThenRetries() {
    run();
    var previous = daily.summary(date);
    sale(customer, List.of(new Line(a, 1)), date, 13);
    sql.execute(
        "CREATE FUNCTION coreerp.fail_summary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE"
            + " EXCEPTION 'injected sensitive database detail'; END $$");
    sql.execute(
        "CREATE TRIGGER fail_summary BEFORE INSERT ON coreerp.daily_customer_summaries FOR EACH ROW"
            + " EXECUTE FUNCTION coreerp.fail_summary()");
    try {
      var e = assertThrows(BusinessException.class, this::run);
      assertEquals("BATCH_FAILED", e.code);
      assertFalse(e.getMessage().contains("sensitive"));
    } finally {
      sql.execute("DROP TRIGGER fail_summary ON coreerp.daily_customer_summaries");
      sql.execute("DROP FUNCTION coreerp.fail_summary()");
    }
    assertEquals(previous.salesAmount(), daily.summary(date).salesAmount());
    assertEquals(previous.runId(), daily.summary(date).runId());
    assertTrue(daily.summary(date).stale());
    assertEquals("FAILED", daily.runs(0, 10).getFirst().status());
    assertEquals("CALCULATION_FAILED", daily.runs(0, 10).getFirst().errorCode());
    assertEquals("SUCCEEDED", run().status());
    assertEquals("10000", daily.summary(date).salesAmount());
    assertFalse(daily.summary(date).stale());
  }

  @Test
  void firstFailureLeavesNoPartialSummary() {
    sql.execute(
        "CREATE FUNCTION coreerp.fail_first() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE"
            + " EXCEPTION 'injected'; END $$");
    sql.execute(
        "CREATE TRIGGER fail_first BEFORE INSERT ON coreerp.daily_product_summaries FOR EACH ROW"
            + " EXECUTE FUNCTION coreerp.fail_first()");
    try {
      assertThrows(BusinessException.class, this::run);
    } finally {
      sql.execute("DROP TRIGGER fail_first ON coreerp.daily_product_summaries");
      sql.execute("DROP FUNCTION coreerp.fail_first()");
    }
    assertNull(daily.summary(date));
    assertEquals("FAILED", daily.runs(0, 10).getFirst().status());
    assertEquals("SUCCEEDED", run().status());
  }

  @Test
  void concurrentExecutionIsBusyAndOnlyOneSnapshotIsCommitted() throws Exception {
    installPause();
    try (Connection gate = dataSource.getConnection();
        var pool = Executors.newSingleThreadExecutor()) {
      gate.createStatement().execute("SELECT pg_advisory_lock(77,901)");
      var first = pool.submit(this::run);
      try {
        waitFor(
            () ->
                sql.queryForObject(
                        "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=77 AND"
                            + " objid=901 AND NOT granted",
                        Integer.class)
                    > 0);
        var e = assertThrows(BusinessException.class, this::run);
        assertEquals("BATCH_BUSY", e.code);
      } finally {
        gate.createStatement().execute("SELECT pg_advisory_unlock(77,901)");
      }
      assertEquals("SUCCEEDED", first.get(10, TimeUnit.SECONDS).status());
      assertEquals(1, daily.runCount());
      assertEquals("9000", daily.summary(date).salesAmount());
    } finally {
      dropPause();
    }
  }

  @Test
  void concurrentSourceChangeCannotMixSnapshotsAndRemainsStale() throws Exception {
    installPause();
    try (Connection gate = dataSource.getConnection();
        var pool = Executors.newSingleThreadExecutor()) {
      gate.createStatement().execute("SELECT pg_advisory_lock(77,901)");
      var first = pool.submit(this::run);
      try {
        waitFor(
            () ->
                sql.queryForObject(
                        "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=77 AND"
                            + " objid=901 AND NOT granted",
                        Integer.class)
                    > 0);
        business.cancelShipment("admin", firstSale);
      } finally {
        gate.createStatement().execute("SELECT pg_advisory_unlock(77,901)");
      }
      assertEquals("SUCCEEDED", first.get(10, TimeUnit.SECONDS).status());
      assertEquals("9000", daily.summary(date).salesAmount());
      assertEquals(
          new BigInteger("9000"),
          daily.products(date).stream()
              .map(p -> new BigInteger(p.amount()))
              .reduce(BigInteger.ZERO, BigInteger::add));
      assertTrue(daily.summary(date).stale());
    } finally {
      dropPause();
    }
    run();
    assertEquals("2000", daily.summary(date).salesAmount());
    assertFalse(daily.summary(date).stale());
  }

  @Test
  void interruptedBeforeCommitBecomesAbandonedAndCanBeRetried() {
    UUID orphan = UUID.randomUUID();
    daily.start(orphan, date, "MANUAL", "admin");
    run();
    var old =
        daily.runs(0, 10).stream().filter(r -> r.id().equals(orphan)).findFirst().orElseThrow();
    assertEquals("ABANDONED", old.status());
    assertEquals("PROCESS_INTERRUPTED", old.errorCode());
    assertEquals("9000", daily.summary(date).salesAmount());
  }

  @Test
  void committedSummaryWithFailedFinalJournalIsRecoveredWithoutRecalculation() {
    sql.execute(
        "CREATE FUNCTION coreerp.fail_journal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF"
            + " NEW.status='SUCCEEDED' THEN RAISE EXCEPTION 'injected journal failure'; END IF;"
            + " RETURN NEW; END $$");
    sql.execute(
        "CREATE TRIGGER fail_journal BEFORE UPDATE ON coreerp.daily_summary_runs FOR EACH ROW"
            + " EXECUTE FUNCTION coreerp.fail_journal()");
    try {
      var e = assertThrows(BusinessException.class, this::run);
      assertEquals("BATCH_HISTORY_PENDING", e.code);
    } finally {
      sql.execute("DROP TRIGGER fail_journal ON coreerp.daily_summary_runs");
      sql.execute("DROP FUNCTION coreerp.fail_journal()");
    }
    var committed = daily.summary(date);
    assertNotNull(committed);
    assertEquals("RUNNING", daily.runs(0, 10).getFirst().status());
    assertEquals("SKIPPED", run().status());
    assertEquals(committed, daily.summary(date));
    var recovered =
        daily.runs(0, 10).stream()
            .filter(r -> r.id().equals(committed.runId()))
            .findFirst()
            .orElseThrow();
    assertEquals("SUCCEEDED", recovered.status());
    assertEquals("RECOVERED_AFTER_COMMIT", recovered.errorCode());
    assertEquals(committed.sourceVersion(), recovered.sourceVersion());
  }

  @Test
  void schedulerCatchesChangedPastDatesAndUsesKstCron() {
    LocalDate old = date.minusDays(3);
    sql.update("UPDATE coreerp.shipments SET created_at=?", time(old, 12));
    batch.run(old, "admin", "MANUAL");
    business.cancelShipment("admin", firstSale);
    assertTrue(daily.summary(old).stale());
    new DailySummaryScheduler(batch, daily).execute();
    assertFalse(daily.summary(old).stale());
    assertEquals("2000", daily.summary(old).salesAmount());
    assertNotNull(daily.summary(date));
    assertFalse(context.containsBean("dailySummaryScheduler"));
    var next =
        CronExpression.parse("0 10 2 * * *").next(date.atStartOfDay(ZoneId.of("Asia/Seoul")));
    assertEquals(2, next.getHour());
    assertEquals(10, next.getMinute());
  }

  @Test
  void adminApiAndCsrfBoundaries() throws Exception {
    String body = "{\"businessDate\":\"" + date + "\"}";
    mvc.perform(
            post("/api/batches/daily")
                .with(user("purchase").roles("PURCHASE"))
                .with(csrf())
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/batches/daily/runs").with(user("sales").roles("SALES")))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/batches/daily")
                .with(user("admin").roles("ADMIN"))
                .contentType("application/json")
                .content(body))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/batches/daily")
                .with(user("admin").roles("ADMIN"))
                .with(csrf())
                .contentType("application/json")
                .content("{}"))
        .andExpect(status().isBadRequest());
    mvc.perform(
            post("/api/batches/daily")
                .with(user("admin").roles("ADMIN"))
                .with(csrf())
                .contentType("application/json")
                .content(body))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("SUCCEEDED"));
    mvc.perform(get("/api/batches/daily/summaries/" + date).with(user("admin").roles("ADMIN")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.summary.salesAmount").value("9000"))
        .andExpect(jsonPath("$.summary.stale").value(false));
  }
}
