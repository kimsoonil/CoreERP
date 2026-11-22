package dev.coreerp;

import static dev.coreerp.MasterService.Kind.*;
import static dev.coreerp.Models.*;

import io.swagger.v3.oas.annotations.*;
import io.swagger.v3.oas.annotations.enums.*;
import io.swagger.v3.oas.annotations.info.Info;
import io.swagger.v3.oas.annotations.security.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
@Validated
@OpenAPIDefinition(
    info =
        @Info(
            title = "CoreERP API",
            version = "1.0",
            description = "발주·부분 입고·창고 재고·판매·출고 API. 쓰기 요청에는 CSRF 토큰이 필요합니다."))
@SecurityScheme(
    name = "session",
    type = SecuritySchemeType.APIKEY,
    in = SecuritySchemeIn.COOKIE,
    paramName = "JSESSIONID")
@SecurityRequirement(name = "session")
public class ApiController {
  private final CoreMapper db;
  private final MasterService master;
  private final BusinessService business;
  private final UserService users;
  private final ReportService reports;

  public ApiController(
      CoreMapper d, MasterService m, BusinessService b, UserService u, ReportService r) {
    db = d;
    master = m;
    business = b;
    users = u;
    reports = r;
  }

  @GetMapping("/health")
  public Map<String, String> health() {
    return Map.of("status", "ok");
  }

  @GetMapping("/auth/csrf")
  public Map<String, String> csrf(CsrfToken token) {
    return Map.of("token", token.getToken(), "header", token.getHeaderName());
  }

  @GetMapping("/auth/me")
  public Map<String, Object> me(Authentication a) {
    return Map.of(
        "username",
        a.getName(),
        "roles",
        a.getAuthorities().stream().map(x -> x.getAuthority().replace("ROLE_", "")).toList());
  }

  @GetMapping("/overview")
  public Object overview() {
    return db.overview();
  }

  @GetMapping("/products")
  public Page<Product> products(
      @RequestParam(defaultValue = "") @Size(max = 100) String q,
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
    return master.products(q, page, size);
  }

  @PostMapping("/products")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE')")
  public Object product(Authentication a, @Valid @RequestBody ProductInput in) {
    return Map.of("id", master.product(a.getName(), null, in));
  }

  @PutMapping("/products/{id}")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE')")
  public Object productUpdate(
      Authentication a, @PathVariable long id, @Valid @RequestBody ProductInput in) {
    return Map.of("id", master.product(a.getName(), id, in));
  }

  @DeleteMapping("/products/{id}")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE')")
  public void disableProduct(Authentication a, @PathVariable long id) {
    master.disableProduct(a.getName(), id);
  }

  @GetMapping("/suppliers")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE','WAREHOUSE')")
  public Object suppliers(
      @RequestParam(defaultValue = "") @Size(max = 100) String q,
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
    return master.list(SUPPLIERS, q, page, size);
  }

  @GetMapping("/customers")
  @PreAuthorize("hasAnyRole('ADMIN','SALES','WAREHOUSE')")
  public Object customers(
      @RequestParam(defaultValue = "") @Size(max = 100) String q,
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
    return master.list(CUSTOMERS, q, page, size);
  }

  @GetMapping("/warehouses")
  public Object warehouses(
      @RequestParam(defaultValue = "") @Size(max = 100) String q,
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
    return master.list(WAREHOUSES, q, page, size);
  }

  @PostMapping("/suppliers")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE')")
  public Object supplier(Authentication a, @Valid @RequestBody MasterInput in) {
    return Map.of("id", master.save(a.getName(), SUPPLIERS, null, in));
  }

  @PutMapping("/suppliers/{id}")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE')")
  public Object supplierUpdate(
      Authentication a, @PathVariable long id, @Valid @RequestBody MasterInput in) {
    return Map.of("id", master.save(a.getName(), SUPPLIERS, id, in));
  }

  @DeleteMapping("/suppliers/{id}")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE')")
  public void supplierDisable(Authentication a, @PathVariable long id) {
    master.disable(a.getName(), SUPPLIERS, id);
  }

  @PostMapping("/customers")
  @PreAuthorize("hasAnyRole('ADMIN','SALES')")
  public Object customer(Authentication a, @Valid @RequestBody MasterInput in) {
    return Map.of("id", master.save(a.getName(), CUSTOMERS, null, in));
  }

  @PutMapping("/customers/{id}")
  @PreAuthorize("hasAnyRole('ADMIN','SALES')")
  public Object customerUpdate(
      Authentication a, @PathVariable long id, @Valid @RequestBody MasterInput in) {
    return Map.of("id", master.save(a.getName(), CUSTOMERS, id, in));
  }

  @DeleteMapping("/customers/{id}")
  @PreAuthorize("hasAnyRole('ADMIN','SALES')")
  public void customerDisable(Authentication a, @PathVariable long id) {
    master.disable(a.getName(), CUSTOMERS, id);
  }

  @PostMapping("/warehouses")
  @PreAuthorize("hasRole('ADMIN')")
  public Object warehouse(Authentication a, @Valid @RequestBody MasterInput in) {
    return Map.of("id", master.save(a.getName(), WAREHOUSES, null, in));
  }

  @PutMapping("/warehouses/{id}")
  @PreAuthorize("hasRole('ADMIN')")
  public Object warehouseUpdate(
      Authentication a, @PathVariable long id, @Valid @RequestBody MasterInput in) {
    return Map.of("id", master.save(a.getName(), WAREHOUSES, id, in));
  }

  @DeleteMapping("/warehouses/{id}")
  @PreAuthorize("hasRole('ADMIN')")
  public void warehouseDisable(Authentication a, @PathVariable long id) {
    master.disable(a.getName(), WAREHOUSES, id);
  }

  @GetMapping("/inventory")
  public Object inventory(
      @RequestParam(required = false) @Positive Long warehouse,
      @RequestParam(defaultValue = "") @Size(max = 100) String q,
      @RequestParam(defaultValue = "false") boolean low,
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
    return master.inventory(warehouse, q, low, page, size);
  }

  @PostMapping("/inventory/adjustments")
  @PreAuthorize("hasAnyRole('ADMIN','WAREHOUSE')")
  public void adjust(Authentication a, @Valid @RequestBody Adjustment in) {
    business.adjust(a.getName(), in);
  }

  @GetMapping("/purchases")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE','WAREHOUSE')")
  public Object purchases(
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size,
      @RequestParam(defaultValue = "")
          @Pattern(regexp = "|DRAFT|APPROVED|PARTIAL|RECEIVED|CANCELLED")
          String status) {
    return new Page<>(db.purchases((long) page * size, size, status), db.purchaseCount(status));
  }

  @GetMapping("/purchases/{id}")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE','WAREHOUSE')")
  public Object purchase(@PathVariable long id) {
    return business.purchaseDetail(id);
  }

  @PostMapping("/purchases")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE')")
  public Object createPurchase(Authentication a, @Valid @RequestBody PurchaseInput in) {
    return Map.of("id", business.createPurchase(a.getName(), in));
  }

  @PostMapping("/purchases/{id}/approve")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE')")
  public void approve(Authentication a, @PathVariable long id) {
    business.approve(a.getName(), id);
  }

  @PostMapping("/purchases/{id}/cancel")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE')")
  public void cancelPurchase(Authentication a, @PathVariable long id) {
    business.cancelPurchase(a.getName(), id);
  }

  @PostMapping("/purchases/{id}/receipts")
  @PreAuthorize("hasAnyRole('ADMIN','WAREHOUSE')")
  public Object receive(
      Authentication a, @PathVariable long id, @Valid @RequestBody ReceiptInput in) {
    return Map.of("id", business.receive(a.getName(), id, in));
  }

  @GetMapping("/sales")
  @PreAuthorize("hasAnyRole('ADMIN','SALES','WAREHOUSE')")
  public Object sales(
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size,
      @RequestParam(defaultValue = "") @Pattern(regexp = "|RESERVED|SHIPPED|CANCELLED")
          String status) {
    return new Page<>(db.sales((long) page * size, size, status), db.salesCount(status));
  }

  @GetMapping("/sales/{id}")
  @PreAuthorize("hasAnyRole('ADMIN','SALES','WAREHOUSE')")
  public Object sale(@PathVariable long id) {
    return business.saleDetail(id);
  }

  @PostMapping("/sales")
  @PreAuthorize("hasAnyRole('ADMIN','SALES')")
  public Object createSale(Authentication a, @Valid @RequestBody SalesInput in) {
    return Map.of("id", business.createSale(a.getName(), in));
  }

  @PostMapping("/sales/{id}/cancel")
  @PreAuthorize("hasAnyRole('ADMIN','SALES')")
  public void cancelSale(Authentication a, @PathVariable long id) {
    business.cancelSale(a.getName(), id);
  }

  @PostMapping("/sales/{id}/shipments")
  @PreAuthorize("hasAnyRole('ADMIN','WAREHOUSE')")
  public Object ship(Authentication a, @PathVariable long id, @Valid @RequestBody RequestKey in) {
    return Map.of("id", business.ship(a.getName(), id, in));
  }

  @PostMapping("/sales/{id}/shipment-cancellation")
  @PreAuthorize("hasAnyRole('ADMIN','WAREHOUSE')")
  public void cancelShip(Authentication a, @PathVariable long id) {
    business.cancelShipment(a.getName(), id);
  }

  @GetMapping("/reports/sales")
  @PreAuthorize("hasAnyRole('ADMIN','SALES')")
  public Object salesReport(
      @RequestParam LocalDate from,
      @RequestParam LocalDate to,
      @RequestParam(defaultValue = "day") String unit) {
    return reports.sales(from, to, unit);
  }

  @GetMapping("/reports/flows")
  @PreAuthorize("hasAnyRole('ADMIN','PURCHASE','WAREHOUSE')")
  public Object flows(@RequestParam LocalDate from, @RequestParam LocalDate to) {
    return reports.flows(from, to);
  }

  @GetMapping("/movements")
  @PreAuthorize("hasAnyRole('ADMIN','WAREHOUSE')")
  public Object movements(
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
    return new Page<>(db.movements((long) page * size, size), db.movementCount());
  }

  @GetMapping("/audits")
  @PreAuthorize("hasRole('ADMIN')")
  public Object audits(
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
    return new Page<>(db.audits((long) page * size, size), db.auditCount());
  }

  @GetMapping("/users")
  @PreAuthorize("hasRole('ADMIN')")
  public Object users() {
    return users.list();
  }

  @PostMapping("/users")
  @PreAuthorize("hasRole('ADMIN')")
  public Object createUser(Authentication a, @Valid @RequestBody UserInput in) {
    return Map.of("id", users.create(a.getName(), in));
  }

  @PatchMapping("/users/{id}/status")
  @PreAuthorize("hasRole('ADMIN')")
  public void status(Authentication a, @PathVariable long id, @Valid @RequestBody UserStatus in) {
    users.status(a.getName(), id, in.status());
  }
}
