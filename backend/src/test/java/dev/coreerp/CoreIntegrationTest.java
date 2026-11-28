package dev.coreerp;

import static dev.coreerp.MasterService.Kind.*;
import static dev.coreerp.Models.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
    properties = {"app.admin-password=test-admin-password-123", "spring.profiles.active=test"})
@AutoConfigureMockMvc
class CoreIntegrationTest extends PostgresTestSupport {
  @Autowired CoreMapper db;
  @Autowired MasterService masters;
  @Autowired BusinessService business;
  @Autowired UserService users;
  @Autowired ReportService reports;
  @Autowired JdbcTemplate sql;
  @Autowired MockMvc mvc;
  long warehouse, supplier, customer;

  @BeforeEach
  void setup() {
    assertTrue(
        sql.queryForObject("SELECT current_database()", String.class).endsWith("_test"),
        "Refusing cleanup outside a _test database");
    sql.execute(
        "TRUNCATE"
            + " coreerp.daily_product_summaries,coreerp.daily_customer_summaries,coreerp.daily_summaries,coreerp.daily_summary_runs,coreerp.daily_summary_sources,coreerp.requests,coreerp.audit_logs,coreerp.stock_movements,coreerp.shipment_items,coreerp.shipments,coreerp.sales_order_items,coreerp.sales_orders,coreerp.goods_receipt_items,coreerp.goods_receipts,coreerp.purchase_order_items,coreerp.purchase_orders,coreerp.inventory,coreerp.products,coreerp.suppliers,coreerp.customers,coreerp.warehouses"
            + " RESTART IDENTITY CASCADE");
    for (String role : List.of("PURCHASE", "WAREHOUSE", "SALES"))
      if (db.account(role.toLowerCase()) == null)
        users.create("admin", new UserInput(role.toLowerCase(), "test-member-password-123", role));
    sql.update("UPDATE coreerp.users SET status='ACTIVE'");
    warehouse = masters.save("admin", WAREHOUSES, null, new MasterInput("W1", "본사 창고"));
    supplier = masters.save("admin", SUPPLIERS, null, new MasterInput("S1", "합성 공급사"));
    customer = masters.save("admin", CUSTOMERS, null, new MasterInput("C1", "합성 고객사"));
  }

  long product(String code, int stock) {
    long p = masters.product("admin", null, new ProductInput(code, code, 1000, 5));
    if (stock > 0)
      business.adjust("admin", new Adjustment(UUID.randomUUID(), warehouse, p, stock, "테스트 초기 입고"));
    return p;
  }

  long purchase(long p, int qty) {
    return business.createPurchase(
        "purchase",
        new PurchaseInput(
            UUID.randomUUID(), warehouse, supplier, List.of(new BuyLine(p, qty, 700))));
  }

  long sale(long p, int qty) {
    return business.createSale(
        "sales", new SalesInput(UUID.randomUUID(), warehouse, customer, List.of(new Line(p, qty))));
  }

  int hand(long p) {
    return sql.queryForObject(
        "SELECT on_hand FROM coreerp.inventory WHERE warehouse_id=? AND product_id=?",
        Integer.class,
        warehouse,
        p);
  }

  int reserved(long p) {
    return sql.queryForObject(
        "SELECT reserved FROM coreerp.inventory WHERE warehouse_id=? AND product_id=?",
        Integer.class,
        warehouse,
        p);
  }

  int count(String table) {
    return sql.queryForObject("SELECT count(*) FROM coreerp." + table, Integer.class);
  }

  @Test
  void purchaseApprovalAndPartialReceipts() {
    long p = product("A", 0), id = purchase(p, 10);
    assertThrows(
        BusinessException.class,
        () ->
            business.receive(
                "warehouse", id, new ReceiptInput(UUID.randomUUID(), List.of(new Line(p, 1)))));
    business.approve("purchase", id);
    var receipt = new ReceiptInput(UUID.randomUUID(), List.of(new Line(p, 4)));
    long first = business.receive("warehouse", id, receipt);
    assertEquals(first, business.receive("warehouse", id, receipt));
    assertEquals(4, hand(p));
    assertEquals("PARTIAL", business.purchaseDetail(id).order().status());
    assertThrows(
        BusinessException.class,
        () ->
            business.receive(
                "warehouse", id, new ReceiptInput(UUID.randomUUID(), List.of(new Line(p, 7)))));
    business.receive("warehouse", id, new ReceiptInput(UUID.randomUUID(), List.of(new Line(p, 6))));
    assertEquals(10, hand(p));
    assertEquals("RECEIVED", business.purchaseDetail(id).order().status());
    assertEquals(2, count("goods_receipts"));
  }

  @Test
  void excessSalesAreRejectedAndMultiItemReservationRollsBack() {
    long a = product("A", 10), b = product("B", 1);
    assertThrows(
        BusinessException.class,
        () ->
            business.createSale(
                "sales",
                new SalesInput(
                    UUID.randomUUID(),
                    warehouse,
                    customer,
                    List.of(new Line(a, 3), new Line(b, 2)))));
    assertEquals(0, reserved(a));
    assertEquals(0, count("sales_orders"));
    assertEquals(10, hand(a));
  }

  @Test
  void shipmentRejectsQuantityAboveCurrentStock() {
    long p = product("A", 2), id = sale(p, 1);
    // Simulate corrupted/imported line data to verify shipment's own defensive check.
    sql.update("UPDATE coreerp.sales_order_items SET quantity=3 WHERE order_id=?", id);
    assertThrows(
        BusinessException.class,
        () -> business.ship("warehouse", id, new RequestKey(UUID.randomUUID())));
    assertEquals(2, hand(p));
    assertEquals(1, reserved(p));
    assertEquals(0, count("shipments"));
  }

  @Test
  void concurrentSalesNeverOversell() throws Exception {
    long p = product("A", 5);
    try (var pool = Executors.newFixedThreadPool(12)) {
      var tasks = new ArrayList<Callable<Boolean>>();
      for (int i = 0; i < 48; i++)
        tasks.add(
            () -> {
              try {
                sale(p, 1);
                return true;
              } catch (BusinessException e) {
                return false;
              }
            });
      long success = 0;
      for (var f : pool.invokeAll(tasks, 30, TimeUnit.SECONDS)) if (f.get()) success++;
      assertEquals(5, success);
      assertEquals(5, reserved(p));
      assertEquals(5, count("sales_orders"));
    }
  }

  @Test
  void concurrentShipmentDoesNotDoubleDeduct() throws Exception {
    long p = product("A", 5), id = sale(p, 5);
    try (var pool = Executors.newFixedThreadPool(8)) {
      var tasks = new ArrayList<Callable<Long>>();
      for (int i = 0; i < 24; i++)
        tasks.add(() -> business.ship("warehouse", id, new RequestKey(UUID.randomUUID())));
      var ids = new HashSet<Long>();
      for (var f : pool.invokeAll(tasks, 30, TimeUnit.SECONDS)) ids.add(f.get());
      assertEquals(1, ids.size());
      assertEquals(0, hand(p));
      assertEquals(0, reserved(p));
      assertEquals(1, count("shipments"));
      assertEquals(
          1,
          sql.queryForObject(
              "SELECT count(*) FROM coreerp.stock_movements WHERE kind='SHIP'", Integer.class));
    }
  }

  @Test
  void sameRequestConcurrentAndDifferentPayloadRejected() throws Exception {
    long p = product("A", 20);
    UUID key = UUID.randomUUID();
    var in = new SalesInput(key, warehouse, customer, List.of(new Line(p, 3)));
    try (var pool = Executors.newFixedThreadPool(8)) {
      var tasks = new ArrayList<Callable<Long>>();
      for (int i = 0; i < 16; i++) tasks.add(() -> business.createSale("sales", in));
      var ids = new HashSet<Long>();
      for (var f : pool.invokeAll(tasks, 30, TimeUnit.SECONDS)) ids.add(f.get());
      assertEquals(1, ids.size());
      assertEquals(3, reserved(p));
    }
    assertThrows(
        BusinessException.class,
        () ->
            business.createSale(
                "sales", new SalesInput(key, warehouse, customer, List.of(new Line(p, 4)))));
  }

  @Test
  void oppositeItemOrderUsesConsistentLocks() throws Exception {
    long a = product("A", 30), b = product("B", 30);
    try (var pool = Executors.newFixedThreadPool(8)) {
      var tasks = new ArrayList<Callable<Long>>();
      for (int i = 0; i < 20; i++) {
        boolean reverse = i % 2 == 0;
        tasks.add(
            () ->
                business.createSale(
                    "sales",
                    new SalesInput(
                        UUID.randomUUID(),
                        warehouse,
                        customer,
                        reverse
                            ? List.of(new Line(b, 1), new Line(a, 1))
                            : List.of(new Line(a, 1), new Line(b, 1)))));
      }
      for (var f : pool.invokeAll(tasks, 30, TimeUnit.SECONDS)) assertTrue(f.get() > 0);
      assertEquals(20, reserved(a));
      assertEquals(20, reserved(b));
    }
  }

  void fault(long product, String kind) {
    sql.execute(
        "CREATE OR REPLACE FUNCTION coreerp.test_failure() RETURNS trigger LANGUAGE plpgsql AS $$"
            + " BEGIN IF NEW.product_id="
            + product
            + " AND NEW.kind='"
            + kind
            + "' THEN RAISE EXCEPTION 'injected storage failure'; END IF; RETURN NEW; END $$");
    sql.execute(
        "CREATE TRIGGER failure BEFORE INSERT ON coreerp.stock_movements FOR EACH ROW EXECUTE"
            + " FUNCTION coreerp.test_failure()");
  }

  void clearFault() {
    sql.execute("DROP TRIGGER IF EXISTS failure ON coreerp.stock_movements");
    sql.execute("DROP FUNCTION IF EXISTS coreerp.test_failure()");
  }

  @Test
  void receiptStorageFailureRollsBackWholeTransaction() {
    long a = product("A", 1), b = product("B", 1);
    long id =
        business.createPurchase(
            "purchase",
            new PurchaseInput(
                UUID.randomUUID(),
                warehouse,
                supplier,
                List.of(new BuyLine(a, 3, 100), new BuyLine(b, 3, 100))));
    business.approve("purchase", id);
    int audits = count("audit_logs");
    fault(b, "RECEIPT");
    try {
      assertThrows(
          DataAccessException.class,
          () ->
              business.receive(
                  "warehouse",
                  id,
                  new ReceiptInput(UUID.randomUUID(), List.of(new Line(a, 2), new Line(b, 2)))));
    } finally {
      clearFault();
    }
    assertEquals(1, hand(a));
    assertEquals(1, hand(b));
    assertEquals(0, count("goods_receipts"));
    assertEquals("APPROVED", business.purchaseDetail(id).order().status());
    assertEquals(0, business.purchaseDetail(id).items().getFirst().processed());
    assertEquals(audits, count("audit_logs"));
  }

  @Test
  void shipmentStorageFailureRollsBackWholeTransaction() {
    long a = product("A", 5), b = product("B", 5);
    long id =
        business.createSale(
            "sales",
            new SalesInput(
                UUID.randomUUID(), warehouse, customer, List.of(new Line(a, 2), new Line(b, 2))));
    fault(b, "SHIP");
    try {
      assertThrows(
          DataAccessException.class,
          () -> business.ship("warehouse", id, new RequestKey(UUID.randomUUID())));
    } finally {
      clearFault();
    }
    assertEquals(5, hand(a));
    assertEquals(2, reserved(a));
    assertEquals(0, count("shipments"));
    assertEquals("RESERVED", business.saleDetail(id).order().status());
  }

  @Test
  void cancellationsRestoreExactlyOnce() {
    long p = product("A", 10), id = sale(p, 3);
    business.cancelSale("sales", id);
    business.cancelSale("sales", id);
    assertEquals(0, reserved(p));
    assertEquals(10, hand(p));
    assertThrows(
        BusinessException.class,
        () -> business.ship("warehouse", id, new RequestKey(UUID.randomUUID())));
    long shipped = sale(p, 4);
    business.ship("warehouse", shipped, new RequestKey(UUID.randomUUID()));
    assertEquals(6, hand(p));
    business.cancelShipment("warehouse", shipped);
    business.cancelShipment("warehouse", shipped);
    assertEquals(10, hand(p));
    assertEquals("CANCELLED", business.saleDetail(shipped).order().status());
  }

  @Test
  void shipmentRacingReservationCancellationHasOneTerminalOutcome() throws Exception {
    long p = product("RACE", 10);
    // Separate transactions compete for the same order row; either winner is valid.
    try (var pool = Executors.newFixedThreadPool(2)) {
      for (int attempt = 0; attempt < 12; attempt++) {
        long id = sale(p, 3);
        var start = new CyclicBarrier(2);
        Callable<Boolean> ship =
            () -> {
              start.await(5, TimeUnit.SECONDS);
              try {
                business.ship("warehouse", id, new RequestKey(UUID.randomUUID()));
                return true;
              } catch (BusinessException e) {
                return false;
              }
            };
        Callable<Boolean> cancel =
            () -> {
              start.await(5, TimeUnit.SECONDS);
              try {
                business.cancelSale("sales", id);
                return true;
              } catch (BusinessException e) {
                return false;
              }
            };
        var shipped = pool.submit(ship);
        var cancelled = pool.submit(cancel);
        boolean didShip = shipped.get(10, TimeUnit.SECONDS);
        assertNotEquals(didShip, cancelled.get(10, TimeUnit.SECONDS));
        assertEquals(didShip ? "SHIPPED" : "CANCELLED", business.saleDetail(id).order().status());
        assertEquals(0, reserved(p));
        assertEquals(didShip ? 7 : 10, hand(p));
        assertEquals(
            didShip ? 1 : 0,
            sql.queryForObject(
                "SELECT count(*) FROM coreerp.shipments WHERE sales_order_id=?",
                Integer.class,
                id));
        assertEquals(
            didShip ? 1 : 0,
            sql.queryForObject(
                "SELECT count(*) FROM coreerp.audit_logs WHERE entity_id=? AND"
                    + " action='SHIP_CONFIRM'",
                Integer.class,
                id));
        if (didShip) business.cancelShipment("warehouse", id);
        assertEquals(10, hand(p));
      }
    }
  }

  @Test
  void inventoryEmptySearchMatchesFilteredCountsAndRetainsHistoricalProducts() {
    long a = product("EMPTY-A", 3), b = product("EMPTY-B", 10);
    long second = masters.save("admin", WAREHOUSES, null, new MasterInput("W2", "별도 창고"));
    business.adjust("admin", new Adjustment(UUID.randomUUID(), second, a, 8, "검색 검증"));
    assertEquals(3, masters.inventory(null, "", false, 0, 25).total());
    assertEquals(2, masters.inventory(warehouse, "", false, 0, 25).total());
    assertEquals(1, masters.inventory(null, "", true, 0, 25).total());
    assertEquals(1, masters.inventory(warehouse, "EMPTY-A", false, 0, 25).total());
    assertEquals(0, masters.inventory(null, "%", false, 0, 25).total());
    assertEquals(0, masters.inventory(null, "_", false, 0, 25).total());
    assertEquals(0, masters.inventory(null, "!", false, 0, 25).total());
    masters.disableProduct("admin", b);
    assertEquals(2, masters.products("", 0, 25).total());
    assertEquals(3, masters.inventory(null, "", false, 0, 25).total());
    assertEquals(1, masters.inventory(null, "", false, 1, 2).items().size());
    assertEquals(3, masters.inventory(null, "", false, 1, 2).total());
  }

  @Test
  void warehousesNeverBorrowStockFromEachOther() {
    long p = product("A", 20),
        other = masters.save("admin", WAREHOUSES, null, new MasterInput("W2", "분리 창고"));
    assertThrows(
        BusinessException.class,
        () ->
            business.createSale(
                "sales",
                new SalesInput(UUID.randomUUID(), other, customer, List.of(new Line(p, 1)))));
    assertEquals(20, hand(p));
  }

  @Test
  void adjustmentCannotStealReservedStock() {
    long p = product("A", 10);
    sale(p, 9);
    assertThrows(
        BusinessException.class,
        () ->
            business.adjust(
                "warehouse", new Adjustment(UUID.randomUUID(), warehouse, p, -2, "테스트")));
    assertEquals(10, hand(p));
  }

  @Test
  void purchaseCancelAndMasterDisable() {
    long p = product("A", 0), id = purchase(p, 10);
    business.cancelPurchase("purchase", id);
    assertThrows(BusinessException.class, () -> business.approve("purchase", id));
    masters.disableProduct("admin", p);
    assertThrows(BusinessException.class, () -> purchase(p, 1));
  }

  @Test
  void aggregateMatchesTransactionsAndKstBoundary() {
    long p = product("A", 30), first = sale(p, 3), second = sale(p, 4);
    business.ship("warehouse", first, new RequestKey(UUID.randomUUID()));
    business.ship("warehouse", second, new RequestKey(UUID.randomUUID()));
    sql.update(
        "UPDATE coreerp.shipments SET created_at='2026-03-01T14:59:59Z' WHERE sales_order_id=?",
        first);
    sql.update(
        "UPDATE coreerp.shipments SET created_at='2026-03-01T15:00:00Z' WHERE sales_order_id=?",
        second);
    var rows =
        db.salesByPeriod(
            OffsetDateTime.parse("2026-03-01T15:00:00Z"),
            OffsetDateTime.parse("2026-03-02T15:00:00Z"),
            "day");
    assertEquals("2026-03-02", rows.getFirst().period());
    assertEquals("4000", rows.getFirst().amount());
    var start = OffsetDateTime.parse("2026-03-01T00:00:00Z");
    var end = OffsetDateTime.parse("2026-03-03T00:00:00Z");
    assertEquals("7000", db.productSales(start, end).getFirst().amount());
    assertEquals(7, db.customerSales(start, end).getFirst().quantity());
    assertEquals(1, db.productSales(start, end).getFirst().rank());
    business.cancelShipment("warehouse", second);
    assertEquals("3000", db.productSales(start, end).getFirst().amount());
    assertEquals(
        3000L,
        sql.queryForObject(
            "SELECT sum(i.quantity*i.unit_price) FROM coreerp.sales_order_items i JOIN"
                + " coreerp.shipments s ON s.sales_order_id=i.order_id WHERE s.status='CONFIRMED'",
            Long.class));
  }

  @Test
  void flowAggregatesMatchPurchaseReceiptAndShipment() {
    long p = product("A", 10), po = purchase(p, 8);
    business.approve("purchase", po);
    business.receive("warehouse", po, new ReceiptInput(UUID.randomUUID(), List.of(new Line(p, 3))));
    long so = sale(p, 2);
    business.ship("warehouse", so, new RequestKey(UUID.randomUUID()));
    var rows = db.flowStats(OffsetDateTime.now().minusDays(1), OffsetDateTime.now().plusDays(1));
    assertEquals(1, rows.size());
    var row = rows.getFirst();
    assertEquals(1, row.purchases());
    assertEquals(8, row.orderedQuantity());
    assertEquals(1, row.receipts());
    assertEquals(3, row.receiptQuantity());
    assertEquals(1, row.shipments());
    assertEquals(2, row.shippedQuantity());
    assertEquals(
        hand(p),
        sql.queryForObject(
                "SELECT sum(delta) FROM coreerp.stock_movements WHERE warehouse_id=? AND"
                    + " product_id=?",
                Long.class,
                warehouse,
                p)
            .intValue());
  }

  @Test
  void pricesAreSnapshotsAndEscapedSearchIsLiteral() {
    long p = product("SKU_A", 10), id = sale(p, 2);
    masters.product("admin", p, new ProductInput("SKU_A", "상품", 5000, 5));
    assertEquals(1000, business.saleDetail(id).items().getFirst().unitPrice());
    product("SKUX", 1);
    assertEquals(1, masters.products("SKU_", 0, 25).total());
    assertThrows(
        BusinessException.class,
        () -> reports.sales(LocalDate.of(2026, 1, 1), LocalDate.of(2028, 1, 1), "day"));
  }

  @Test
  void anonymousAndCsrfProtection() throws Exception {
    mvc.perform(get("/api/products"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
    mvc.perform(
            post("/api/products")
                .with(user("admin").roles("ADMIN"))
                .contentType("application/json")
                .content("{}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void roleBoundariesAreEnforced() throws Exception {
    mvc.perform(get("/api/purchases").with(user("sales").roles("SALES")))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/sales").with(user("purchase").roles("PURCHASE")))
        .andExpect(status().isForbidden());
    mvc.perform(get("/api/users").with(user("warehouse").roles("WAREHOUSE")))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/sales/1/shipments")
                .with(user("purchase").roles("PURCHASE"))
                .with(csrf())
                .contentType("application/json")
                .content("{\"requestKey\":\"" + UUID.randomUUID() + "\"}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void standardValidationAndOpenApi() throws Exception {
    mvc.perform(
            post("/api/products")
                .with(user("admin").roles("ADMIN"))
                .with(csrf())
                .contentType("application/json")
                .content("{\"sku\":\"\",\"name\":\"\",\"price\":-1}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"))
        .andExpect(jsonPath("$.fieldErrors.sku").isString());
    mvc.perform(get("/api/products?size=201").with(user("admin").roles("ADMIN")))
        .andExpect(status().isBadRequest());
    mvc.perform(get("/v3/api-docs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.info.title").value("CoreERP API"));
  }

  @Test
  void lockedAccountLosesExistingSessionAccess() throws Exception {
    long id = db.account("sales").id();
    users.status("admin", id, "LOCKED");
    assertTrue(
        db.audits(0, 100).stream()
            .anyMatch(
                a ->
                    a.action().equals("USER_STATUS")
                        && a.details().contains("LOCKED")
                        && a.details().contains("ACTIVE")));
    mvc.perform(get("/api/products").with(user("sales").roles("SALES")))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("ACCOUNT_DISABLED"));
    assertThrows(
        BusinessException.class, () -> users.status("admin", db.account("admin").id(), "LOCKED"));
  }

  @Test
  void loginAndAuditDoNotExposePasswords() throws Exception {
    mvc.perform(
            post("/api/auth/login")
                .with(csrf())
                .param("username", "admin")
                .param("password", "test-admin-password-123"))
        .andExpect(status().isOk());
    mvc.perform(
            post("/api/auth/login")
                .with(csrf())
                .param("username", "admin")
                .param("password", "wrong"))
        .andExpect(status().isUnauthorized());
    assertEquals(
        1,
        sql.queryForObject(
            "SELECT count(*) FROM coreerp.audit_logs WHERE action='LOGIN_SUCCESS'", Integer.class));
    assertEquals(
        1,
        sql.queryForObject(
            "SELECT count(*) FROM coreerp.audit_logs WHERE action='LOGIN_FAILURE'", Integer.class));
    assertFalse(db.audits(0, 100).toString().contains("test-admin-password"));
  }

  @Test
  void repeatedPurchaseLinesNormalizeAndReplayWithoutDuplicateDocuments() {
    long p = product("NORMAL", 0);
    var key = UUID.randomUUID();
    long id =
        business.createPurchase(
            "purchase",
            new PurchaseInput(
                key, warehouse, supplier, List.of(new BuyLine(p, 2, 700), new BuyLine(p, 3, 700))));
    assertEquals(
        id,
        business.createPurchase(
            "purchase",
            new PurchaseInput(key, warehouse, supplier, List.of(new BuyLine(p, 5, 700)))));
    assertEquals(1, db.purchaseItems(id).size());
    assertEquals(5, db.purchaseItems(id).getFirst().quantity());
    assertEquals(1, count("purchase_orders"));
  }

  @Test
  void conflictingPriceAndMergedQuantityLimitRejectWithoutWrites() {
    long p = product("LIMIT", 0);
    assertThrows(
        BusinessException.class,
        () ->
            business.createPurchase(
                "purchase",
                new PurchaseInput(
                    UUID.randomUUID(),
                    warehouse,
                    supplier,
                    List.of(new BuyLine(p, 2, 700), new BuyLine(p, 3, 800)))));
    assertThrows(
        BusinessException.class,
        () ->
            business.createPurchase(
                "purchase",
                new PurchaseInput(
                    UUID.randomUUID(),
                    warehouse,
                    supplier,
                    List.of(new BuyLine(p, 600000, 700), new BuyLine(p, 600000, 700)))));
    assertEquals(0, count("purchase_orders"));
    assertEquals(0, count("requests"));
  }

  @Test
  void duplicateSalesLinesReserveCombinedQuantityAndCancelOnlyOnce() {
    long p = product("MERGED", 10);
    long id =
        business.createSale(
            "sales",
            new SalesInput(
                UUID.randomUUID(), warehouse, customer, List.of(new Line(p, 2), new Line(p, 3))));
    assertEquals(5, reserved(p));
    assertEquals(1, db.saleItems(id).size());
    business.cancelSale("sales", id);
    business.cancelSale("sales", id);
    assertEquals(0, reserved(p));
    assertEquals(10, hand(p));
    assertThrows(
        BusinessException.class,
        () -> business.ship("warehouse", id, new RequestKey(UUID.randomUUID())));
  }

  @Test
  void latePurchaseCancellationIsRejectedWithoutChangingReceiptOrStock() {
    long p = product("PART", 0), id = purchase(p, 10);
    business.approve("purchase", id);
    business.receive("warehouse", id, new ReceiptInput(UUID.randomUUID(), List.of(new Line(p, 4))));
    assertThrows(BusinessException.class, () -> business.cancelPurchase("purchase", id));
    assertThrows(BusinessException.class, () -> business.approve("purchase", id));
    assertEquals("PARTIAL", db.purchase(id).status());
    assertEquals(4, hand(p));
    assertEquals(1, count("goods_receipts"));
  }

  @Test
  void lastActiveAdminAndOversizeUtf8PasswordAreProtected() {
    var admin = db.account("admin");
    assertThrows(BusinessException.class, () -> users.status("admin", admin.id(), "LOCKED"));
    assertEquals("ACTIVE", db.account("admin").status());
    assertEquals(
        "PASSWORD_TOO_LONG",
        assertThrows(
                BusinessException.class,
                () -> users.create("admin", new UserInput("oversize", "가".repeat(25), "SALES")))
            .code);
    assertNull(db.account("oversize"));
    assertFalse(users.list().isEmpty());
  }

  @Test
  void disabledMasterRejectsNewOrderButPreservesHistoricalDetail() {
    long p = product("HISTORY", 10), id = sale(p, 2);
    masters.save("admin", CUSTOMERS, customer, new MasterInput("C1", "수정 고객사"));
    masters.disable("admin", CUSTOMERS, customer);
    assertThrows(BusinessException.class, () -> sale(p, 1));
    assertEquals(2, reserved(p));
    assertEquals("수정 고객사", business.saleDetail(id).order().partnerName());
    assertEquals(1, count("sales_orders"));
  }
}
