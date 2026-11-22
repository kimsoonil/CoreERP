package dev.coreerp;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ReportServiceTest {
  private final CoreMapper db = mock(CoreMapper.class);
  private final ReportService service = new ReportService(db);

  @Test
  void singleDayUsesInclusiveKstStartAndExclusiveNextDay() {
    var date = LocalDate.of(2026, 1, 1);
    var from = OffsetDateTime.parse("2026-01-01T00:00:00+09:00");
    var to = OffsetDateTime.parse("2026-01-02T00:00:00+09:00");
    when(db.salesByPeriod(from, to, "day")).thenReturn(List.of());
    when(db.productSales(from, to)).thenReturn(List.of());
    when(db.customerSales(from, to)).thenReturn(List.of());
    var report = service.sales(date, date, "day");
    assertEquals(List.of(), report.get("periods"));
    assertEquals(List.of(), report.get("products"));
    assertEquals(List.of(), report.get("customers"));
    verify(db).salesByPeriod(from, to, "day");
    verify(db).productSales(from, to);
    verify(db).customerSales(from, to);
    verifyNoMoreInteractions(db);
  }

  @Test
  void leapYear366DaysAreAcceptedWithoutClippingMonthRange() {
    service.sales(LocalDate.of(2024, 1, 1), LocalDate.of(2024, 12, 31), "month");
    verify(db)
        .salesByPeriod(
            OffsetDateTime.parse("2024-01-01T00:00:00+09:00"),
            OffsetDateTime.parse("2025-01-01T00:00:00+09:00"),
            "month");
  }

  @Test
  void reversedRangeDoesNotReachDatabase() {
    var e =
        assertThrows(
            BusinessException.class,
            () -> service.flows(LocalDate.of(2026, 2, 2), LocalDate.of(2026, 2, 1)));
    assertEquals("INVALID_PERIOD", e.code);
    verifyNoInteractions(db);
  }

  @Test
  void rangeLongerThan366DaysDoesNotReachDatabase() {
    var start = LocalDate.of(2026, 1, 1);
    var e =
        assertThrows(
            BusinessException.class, () -> service.sales(start, start.plusDays(366), "day"));
    assertEquals("INVALID_PERIOD", e.code);
    verifyNoInteractions(db);
  }

  @ParameterizedTest
  @ValueSource(strings = {"week", "DAY", "day; DROP TABLE shipments"})
  void unsupportedGroupingNeverReachesSql(String unit) {
    var date = LocalDate.of(2026, 1, 1);
    assertEquals(
        "INVALID_UNIT",
        assertThrows(BusinessException.class, () -> service.sales(date, date, unit)).code);
    verifyNoInteractions(db);
  }

  @Test
  void flowsUsesSameKstDateBoundaryAcrossYearChange() {
    service.flows(LocalDate.of(2025, 12, 31), LocalDate.of(2026, 1, 1));
    verify(db)
        .flowStats(
            OffsetDateTime.parse("2025-12-31T00:00:00+09:00"),
            OffsetDateTime.parse("2026-01-02T00:00:00+09:00"));
  }
}
