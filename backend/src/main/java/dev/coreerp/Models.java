package dev.coreerp;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.OffsetDateTime;
import java.util.*;

public final class Models {
  private Models() {}

  public record Product(
      long id, String sku, String name, long price, int safetyStock, boolean active) {}

  public record ProductInput(
      @NotBlank @Size(max = 40) @Pattern(regexp = "[A-Za-z0-9_-]+") String sku,
      @NotBlank @Size(max = 120) String name,
      @Min(0) @Max(1000000000) long price,
      @Min(0) @Max(1000000) int safetyStock) {}

  public record Master(long id, String code, String name, boolean active) {}

  public record MasterInput(
      @NotBlank @Size(max = 40) @Pattern(regexp = "[A-Za-z0-9_-]+") String code,
      @NotBlank @Size(max = 120) String name) {}

  public record Inventory(
      long warehouseId,
      long productId,
      String warehouseName,
      String sku,
      String name,
      int onHand,
      int reserved,
      int safetyStock) {}

  public record Stock(int onHand, int reserved) {}

  public record Document(
      long id,
      long partnerId,
      String partnerName,
      long warehouseId,
      String warehouseName,
      String status,
      String actor,
      OffsetDateTime createdAt) {}

  public record Item(
      long productId, String sku, String name, int quantity, int processed, long unitPrice) {}

  public record Detail(Document order, List<Item> items, Long shipmentId) {}

  public record Line(@Positive long productId, @Min(1) @Max(1000000) int quantity) {}

  public record BuyLine(
      @Positive long productId,
      @Min(1) @Max(1000000) int quantity,
      @Min(0) @Max(1000000000) long unitPrice) {}

  public record PurchaseInput(
      @NotNull UUID requestKey,
      @Positive long warehouseId,
      @Positive long supplierId,
      @NotEmpty @Size(max = 100) List<@Valid BuyLine> items) {}

  public record SalesInput(
      @NotNull UUID requestKey,
      @Positive long warehouseId,
      @Positive long customerId,
      @NotEmpty @Size(max = 100) List<@Valid Line> items) {}

  public record ReceiptInput(
      @NotNull UUID requestKey, @NotEmpty @Size(max = 100) List<@Valid Line> items) {}

  public record RequestKey(@NotNull UUID requestKey) {}

  public record Adjustment(
      @NotNull UUID requestKey,
      @Positive long warehouseId,
      @Positive long productId,
      @Min(-1000000) @Max(1000000) int delta,
      @NotBlank @Size(max = 200) String reason) {}

  public record Page<T>(List<T> items, long total) {}

  public record Receipt(String fingerprint, long resultId) {}

  public record Account(
      long id, String username, String password, String status, OffsetDateTime lastLoginAt) {}

  public record UserInput(
      @NotBlank @Pattern(regexp = "[a-zA-Z0-9_-]{3,40}") String username,
      @NotBlank @Size(min = 12, max = 72) String password,
      @NotBlank @Pattern(regexp = "ADMIN|PURCHASE|WAREHOUSE|SALES") String role) {}

  public record UserStatus(@NotBlank @Pattern(regexp = "ACTIVE|LOCKED") String status) {}

  public record UserView(
      long id, String username, String status, OffsetDateTime lastLoginAt, List<String> roles) {}

  public record SalesDay(String period, String amount, long shipments) {}

  public record ProductSales(
      long productId, String sku, String name, long quantity, String amount, long rank) {}

  public record CustomerSales(long customerId, String name, long quantity, String amount) {}

  public record FlowStats(
      String day,
      long purchases,
      long orderedQuantity,
      long receipts,
      long receiptQuantity,
      long shipments,
      long shippedQuantity) {}

  public record Movement(
      long id,
      String warehouseName,
      String productName,
      int delta,
      String kind,
      Long referenceId,
      String actor,
      OffsetDateTime createdAt) {}

  public record Audit(
      long id,
      String actor,
      String action,
      String entityType,
      Long entityId,
      String details,
      OffsetDateTime createdAt) {}
}
