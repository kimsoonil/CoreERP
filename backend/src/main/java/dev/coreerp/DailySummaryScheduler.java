package dev.coreerp;

import java.time.*;
import java.util.*;
import org.slf4j.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "app.batch.enabled", havingValue = "true")
public class DailySummaryScheduler {
  private static final Logger log = LoggerFactory.getLogger(DailySummaryScheduler.class);
  private final DailySummaryService service;
  private final DailySummaryMapper db;

  public DailySummaryScheduler(DailySummaryService s, DailySummaryMapper db) {
    service = s;
    this.db = db;
  }

  @Scheduled(cron = "${app.batch.cron:0 10 2 * * *}", zone = "Asia/Seoul")
  public void execute() {
    LocalDate today = service.today();
    var dates = new TreeSet<LocalDate>();
    dates.add(today.minusDays(1));
    dates.addAll(db.dirtyDates(today, today.minusDays(366), 50));
    for (var date : dates) {
      try {
        var r = service.run(date, "daily-scheduler", "SCHEDULED");
        log.info("Daily summary: date={} state={} run={}", date, r.status(), r.runId());
      } catch (BusinessException e) {
        if (e.code.equals("BATCH_BUSY")) {
          log.info("Daily summary already running; remaining dates deferred");
          return;
        }
        log.error("Daily summary retry deferred: date={} code={}", date, e.code);
      }
    }
  }
}
