package dev.coreerp;

import static dev.coreerp.BatchModels.*;
import static dev.coreerp.Models.*;

import java.time.*;
import java.util.*;
import org.apache.ibatis.annotations.*;

@Mapper
public interface DailySummaryMapper {
  @Select("SELECT pg_try_advisory_xact_lock(20261122,901)")
  boolean tryLock();

  @Select(
      "SELECT coalesce((SELECT version FROM coreerp.daily_summary_sources WHERE"
          + " business_date=#{date}),0)")
  long sourceVersion(LocalDate date);

  @Select("SELECT source_version FROM coreerp.daily_summaries WHERE business_date=#{date}")
  Long calculatedVersion(LocalDate date);

  @Update(
      "UPDATE coreerp.daily_summary_runs r SET source_version=coalesce((SELECT source_version FROM"
          + " coreerp.daily_summaries s WHERE s.run_id=r.id),r.source_version),status=CASE WHEN"
          + " EXISTS(SELECT 1 FROM coreerp.daily_summaries s WHERE s.run_id=r.id) THEN 'SUCCEEDED'"
          + " ELSE 'ABANDONED' END,finished_at=clock_timestamp(),error_code=CASE WHEN EXISTS(SELECT"
          + " 1 FROM coreerp.daily_summaries s WHERE s.run_id=r.id) THEN 'RECOVERED_AFTER_COMMIT'"
          + " ELSE 'PROCESS_INTERRUPTED' END WHERE status='RUNNING'")
  void recoverInterrupted();

  @Insert(
      "INSERT INTO coreerp.daily_summary_runs(id,business_date,status,trigger_type,actor)"
          + " VALUES(#{id},#{date},'RUNNING',#{trigger},#{actor})")
  void start(
      @Param("id") UUID id,
      @Param("date") LocalDate date,
      @Param("trigger") String trigger,
      @Param("actor") String actor);

  @Update(
      "UPDATE coreerp.daily_summary_runs SET"
          + " status=#{status},source_version=#{version},error_code=#{error},finished_at=clock_timestamp()"
          + " WHERE id=#{id} AND status='RUNNING'")
  void finish(
      @Param("id") UUID id,
      @Param("status") String status,
      @Param("version") Long version,
      @Param("error") String error);

  @Delete("DELETE FROM coreerp.daily_summaries WHERE business_date=#{date}")
  void clear(LocalDate date);

  void insertSummary(
      @Param("date") LocalDate date,
      @Param("version") long version,
      @Param("id") UUID id,
      @Param("from") OffsetDateTime from,
      @Param("to") OffsetDateTime to);

  void insertProducts(
      @Param("date") LocalDate date,
      @Param("from") OffsetDateTime from,
      @Param("to") OffsetDateTime to);

  void insertCustomers(
      @Param("date") LocalDate date,
      @Param("from") OffsetDateTime from,
      @Param("to") OffsetDateTime to);

  Summary summary(LocalDate date);

  List<Summary> summaries(@Param("from") LocalDate from, @Param("to") LocalDate to);

  @Select(
      "SELECT r.business_date FROM coreerp.daily_summary_sources r LEFT JOIN"
          + " coreerp.daily_summaries s USING(business_date) WHERE r.business_date < #{today} AND"
          + " r.business_date >= #{oldest} AND (s.business_date IS NULL OR"
          + " s.source_version<>r.version) ORDER BY r.business_date LIMIT #{limit}")
  List<LocalDate> dirtyDates(
      @Param("today") LocalDate today,
      @Param("oldest") LocalDate oldest,
      @Param("limit") int limit);

  @Select(
      "SELECT * FROM coreerp.daily_summary_runs ORDER BY started_at DESC,id DESC LIMIT #{size}"
          + " OFFSET #{offset}")
  List<Run> runs(@Param("offset") long offset, @Param("size") int size);

  @Select("SELECT count(*) FROM coreerp.daily_summary_runs")
  long runCount();

  @Select(
      "SELECT d.product_id,p.sku,p.name,d.quantity,d.amount::text,dense_rank() OVER(ORDER BY"
          + " d.amount DESC) rank FROM coreerp.daily_product_summaries d JOIN coreerp.products p ON"
          + " p.id=d.product_id WHERE business_date=#{date} ORDER BY rank,d.product_id LIMIT 100")
  List<ProductSales> products(LocalDate date);

  @Select(
      "SELECT d.customer_id,c.name,d.quantity,d.amount::text FROM coreerp.daily_customer_summaries"
          + " d JOIN coreerp.customers c ON c.id=d.customer_id WHERE business_date=#{date} ORDER BY"
          + " d.amount DESC,d.customer_id LIMIT 100")
  List<CustomerSales> customers(LocalDate date);
}
