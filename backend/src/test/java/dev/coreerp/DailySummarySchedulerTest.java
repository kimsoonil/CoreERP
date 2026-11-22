package dev.coreerp;

import static org.mockito.Mockito.*;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class DailySummarySchedulerTest {
  private final DailySummaryService service = mock(DailySummaryService.class);
  private final DailySummaryMapper db = mock(DailySummaryMapper.class);
  private final LocalDate today = LocalDate.of(2026, 11, 22);
  private final DailySummaryScheduler scheduler = new DailySummaryScheduler(service, db);

  @BeforeEach
  void setup() {
    when(service.today()).thenReturn(today);
  }

  private void completed(LocalDate date) {
    when(service.run(date, "daily-scheduler", "SCHEDULED"))
        .thenReturn(new BatchModels.RunResult(java.util.UUID.randomUUID(), date, "SUCCEEDED", 1));
  }

  @Test
  void catchesUpOldestFirstAndDoesNotRunYesterdayTwice() {
    var old = today.minusDays(3);
    var yesterday = today.minusDays(1);
    when(db.dirtyDates(today, today.minusDays(366), 50)).thenReturn(List.of(yesterday, old));
    completed(old);
    completed(yesterday);
    scheduler.execute();
    var order = inOrder(service);
    order.verify(service).today();
    order.verify(service).run(old, "daily-scheduler", "SCHEDULED");
    order.verify(service).run(yesterday, "daily-scheduler", "SCHEDULED");
    verifyNoMoreInteractions(service);
  }

  @Test
  void busyBatchDefersRemainingDates() {
    var old = today.minusDays(3);
    when(db.dirtyDates(today, today.minusDays(366), 50)).thenReturn(List.of(old));
    when(service.run(old, "daily-scheduler", "SCHEDULED"))
        .thenThrow(new BusinessException(HttpStatus.CONFLICT, "BATCH_BUSY", "busy"));
    scheduler.execute();
    verify(service, never()).run(today.minusDays(1), "daily-scheduler", "SCHEDULED");
  }

  @Test
  void calculationFailureDoesNotPreventOtherDatesAndCanRetryNextTrigger() {
    var old = today.minusDays(3);
    var yesterday = today.minusDays(1);
    when(db.dirtyDates(today, today.minusDays(366), 50)).thenReturn(List.of(old));
    completed(yesterday);
    when(service.run(old, "daily-scheduler", "SCHEDULED"))
        .thenThrow(
            new BusinessException(HttpStatus.INTERNAL_SERVER_ERROR, "BATCH_FAILED", "failed"))
        .thenReturn(new BatchModels.RunResult(java.util.UUID.randomUUID(), old, "SUCCEEDED", 1));
    scheduler.execute();
    scheduler.execute();
    verify(service, times(2)).run(old, "daily-scheduler", "SCHEDULED");
    verify(service, times(2)).run(yesterday, "daily-scheduler", "SCHEDULED");
  }
}
