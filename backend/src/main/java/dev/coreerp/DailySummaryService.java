package dev.coreerp;

import static dev.coreerp.BatchModels.*;

import java.time.*;
import java.util.*;
import org.slf4j.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class DailySummaryService {
  private static final Logger log = LoggerFactory.getLogger(DailySummaryService.class);
  private final DailySummaryMapper db;
  private final CoreMapper core;
  private final Clock clock;
  private final TransactionTemplate lockTx, historyTx, snapshotTx;

  public DailySummaryService(
      DailySummaryMapper db, CoreMapper core, Clock clock, PlatformTransactionManager manager) {
    this.db = db;
    this.core = core;
    this.clock = clock;
    lockTx = new TransactionTemplate(manager);
    lockTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    lockTx.setTimeout(180);
    historyTx = new TransactionTemplate(manager);
    historyTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    historyTx.setTimeout(15);
    snapshotTx = new TransactionTemplate(manager);
    snapshotTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    snapshotTx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    snapshotTx.setTimeout(90);
  }

  public LocalDate today() {
    return LocalDate.now(clock.withZone(ZoneId.of("Asia/Seoul")));
  }

  public RunResult run(LocalDate date, String actor, String trigger) {
    if (date == null || !date.isBefore(today()) || date.isBefore(LocalDate.of(2000, 1, 1)))
      throw new BusinessException(
          HttpStatus.BAD_REQUEST, "INVALID_BATCH_DATE", "한국 시간 기준 어제까지의 날짜(2000년 이후)만 집계할 수 있습니다.");
    if (!Set.of("MANUAL", "SCHEDULED").contains(trigger))
      throw new IllegalArgumentException("Unsupported batch trigger");
    return Objects.requireNonNull(
        lockTx.execute(
            outer -> {
              if (!db.tryLock())
                throw new BusinessException(
                    HttpStatus.CONFLICT, "BATCH_BUSY", "다른 일별 집계가 실행 중입니다. 잠시 후 다시 시도해 주세요.");
              UUID runId = UUID.randomUUID();
              historyTx.executeWithoutResult(
                  tx -> {
                    db.recoverInterrupted();
                    db.start(runId, date, trigger, actor);
                  });
              RunResult result;
              try {
                result =
                    Objects.requireNonNull(snapshotTx.execute(tx -> calculate(runId, date, actor)));
              } catch (RuntimeException failure) {
                log.error("Daily summary calculation failed: run={} date={}", runId, date, failure);
                try {
                  historyTx.executeWithoutResult(
                      tx -> db.finish(runId, "FAILED", null, "CALCULATION_FAILED"));
                } catch (RuntimeException journalFailure) {
                  log.error("Daily summary failure journal pending: run={}", runId, journalFailure);
                }
                throw new BusinessException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "BATCH_FAILED",
                    "집계에 실패했습니다. 이전 집계는 유지됩니다. 실행 ID: " + runId);
              }
              try {
                historyTx.executeWithoutResult(
                    tx -> db.finish(runId, result.status(), result.sourceVersion(), null));
              } catch (RuntimeException journalFailure) {
                log.error(
                    "Daily summary committed; journal recovery needed: run={}",
                    runId,
                    journalFailure);
                throw new BusinessException(
                    HttpStatus.INTERNAL_SERVER_ERROR,
                    "BATCH_HISTORY_PENDING",
                    "집계 처리는 끝났으나 이력 확정을 확인하지 못했습니다. 같은 날짜를 다시 실행해 상태를 복구해 주세요. 실행 ID: " + runId);
              }
              return result;
            }));
  }

  private RunResult calculate(UUID id, LocalDate date, String actor) {
    long version = db.sourceVersion(date);
    Long calculated = db.calculatedVersion(date);
    if (calculated != null && calculated == version)
      return new RunResult(id, date, "SKIPPED", version);
    var zone = ZoneId.of("Asia/Seoul");
    var from = date.atStartOfDay(zone).toOffsetDateTime();
    var to = date.plusDays(1).atStartOfDay(zone).toOffsetDateTime();
    db.clear(date);
    db.insertSummary(date, version, id, from, to);
    db.insertProducts(date, from, to);
    db.insertCustomers(date, from, to);
    core.audit(
        actor,
        "DAILY_SUMMARY",
        "BATCH",
        null,
        "{\"businessDate\":\"" + date + "\",\"runId\":\"" + id + "\"}");
    return new RunResult(id, date, "SUCCEEDED", version);
  }

  @org.springframework.transaction.annotation.Transactional(
      readOnly = true,
      isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
  public DayDetail detail(LocalDate date) {
    var summary = db.summary(date);
    if (summary == null) throw BusinessException.missing();
    return new DayDetail(summary, db.products(date), db.customers(date));
  }

  public java.util.List<Summary> summaries(LocalDate from, LocalDate to) {
    if (to.isBefore(from) || java.time.temporal.ChronoUnit.DAYS.between(from, to) > 365)
      throw new BusinessException(
          HttpStatus.BAD_REQUEST, "INVALID_PERIOD", "양 끝 포함 최대 366일까지 조회할 수 있습니다.");
    return db.summaries(from, to);
  }
}
