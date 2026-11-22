package dev.coreerp;

import static dev.coreerp.BatchModels.*;
import static dev.coreerp.Models.*;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@io.swagger.v3.oas.annotations.security.SecurityRequirement(name = "session")
@RestController
@RequestMapping("/api/batches/daily")
@Validated
@PreAuthorize("hasRole('ADMIN')")
public class BatchController {
  private final DailySummaryService service;
  private final DailySummaryMapper db;

  public BatchController(DailySummaryService s, DailySummaryMapper db) {
    service = s;
    this.db = db;
  }

  @PostMapping
  public RunResult run(Authentication auth, @Valid @RequestBody DailyRequest input) {
    return service.run(input.businessDate(), auth.getName(), "MANUAL");
  }

  @GetMapping("/runs")
  public Page<Run> runs(
      @RequestParam(defaultValue = "0") @Min(0) @Max(100000) int page,
      @RequestParam(defaultValue = "25") @Min(1) @Max(200) int size) {
    return new Page<>(db.runs((long) page * size, size), db.runCount());
  }

  @GetMapping("/summaries")
  public java.util.List<Summary> summaries(
      @RequestParam LocalDate from, @RequestParam LocalDate to) {
    return service.summaries(from, to);
  }

  @GetMapping("/summaries/{date}")
  public DayDetail detail(@PathVariable LocalDate date) {
    return service.detail(date);
  }
}
