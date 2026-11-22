package dev.coreerp;

import jakarta.validation.constraints.NotNull;
import java.time.*;
import java.util.UUID;

public final class BatchModels {
  private BatchModels() {}

  public record DailyRequest(@NotNull LocalDate businessDate) {}

  public record RunResult(UUID runId, LocalDate businessDate, String status, long sourceVersion) {}

  public record Run(
      UUID id,
      LocalDate businessDate,
      String status,
      Long sourceVersion,
      String triggerType,
      String actor,
      OffsetDateTime startedAt,
      OffsetDateTime finishedAt,
      String errorCode) {}

  public record DayDetail(
      Summary summary,
      java.util.List<Models.ProductSales> products,
      java.util.List<Models.CustomerSales> customers) {}

  public record Summary(
      LocalDate businessDate,
      long sourceVersion,
      long currentSourceVersion,
      UUID runId,
      OffsetDateTime calculatedAt,
      String salesAmount,
      long salesShipments,
      long shippedQuantity,
      long purchases,
      long orderedQuantity,
      long receipts,
      long receiptQuantity,
      boolean stale) {}
}
