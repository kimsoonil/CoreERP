package dev.coreerp;

import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class ReportService {
  private final CoreMapper db;

  public ReportService(CoreMapper d) {
    db = d;
  }

  public Map<String, Object> sales(LocalDate from, LocalDate to, String unit) {
    var dates = range(from, to);
    if (!Set.of("day", "month").contains(unit))
      throw new BusinessException(HttpStatus.BAD_REQUEST, "INVALID_UNIT", "day 또는 month만 지원합니다.");
    return Map.of(
        "periods",
        db.salesByPeriod(dates[0], dates[1], unit),
        "products",
        db.productSales(dates[0], dates[1]),
        "customers",
        db.customerSales(dates[0], dates[1]));
  }

  public Object flows(LocalDate f, LocalDate t) {
    var d = range(f, t);
    return db.flowStats(d[0], d[1]);
  }

  private OffsetDateTime[] range(LocalDate f, LocalDate t) {
    if (t.isBefore(f) || ChronoUnit.DAYS.between(f, t) > 365)
      throw new BusinessException(
          HttpStatus.BAD_REQUEST, "INVALID_PERIOD", "조회 기간은 양 끝 포함 최대 366일입니다.");
    var z = ZoneId.of("Asia/Seoul");
    return new OffsetDateTime[] {
      f.atStartOfDay(z).toOffsetDateTime(), t.plusDays(1).atStartOfDay(z).toOffsetDateTime()
    };
  }
}
