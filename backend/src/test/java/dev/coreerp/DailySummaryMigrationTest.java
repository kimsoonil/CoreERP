package dev.coreerp;

import static org.junit.jupiter.api.Assertions.*;

import java.sql.DriverManager;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

@SpringBootTest(
    properties = {"app.admin-password=test-admin-password-123", "spring.profiles.active=test"})
class DailySummaryMigrationTest extends PostgresTestSupport {
  @Autowired JdbcTemplate admin;

  @Value("${spring.datasource.url}")
  String url;

  @Value("${spring.datasource.username}")
  String username;

  @Value("${spring.datasource.password}")
  String password;

  @Test
  void existingV900DemoUpgradesWithoutChangingSourceData() throws Exception {
    String name = "coreerp_upgrade_" + UUID.randomUUID().toString().replace("-", "") + "_test";
    assertTrue(name.matches("coreerp_upgrade_[a-f0-9]+_test"));
    admin.execute("CREATE DATABASE " + name);
    String jdbc = url.replaceFirst("/[^/?]+(?=\\?|$)", "/" + name);
    try {
      Flyway.configure()
          .dataSource(jdbc, username, password)
          .schemas("coreerp")
          .defaultSchema("coreerp")
          .locations("classpath:db/migration", "classpath:db/demo")
          .target("900")
          .load()
          .migrate();
      try (var connection = DriverManager.getConnection(jdbc, username, password);
          var statement = connection.createStatement()) {
        try (var rows = statement.executeQuery("SELECT count(*) FROM coreerp.products")) {
          rows.next();
          assertEquals(10000, rows.getLong(1));
        }
        try (var rows = statement.executeQuery("SELECT count(*) FROM coreerp.sales_orders")) {
          rows.next();
          assertEquals(95, rows.getLong(1));
        }
      }
      var upgraded =
          Flyway.configure()
              .dataSource(jdbc, username, password)
              .schemas("coreerp")
              .defaultSchema("coreerp")
              .locations("classpath:db/migration", "classpath:db/demo")
              .load();
      upgraded.migrate();
      upgraded.validate();
      assertEquals(0, upgraded.migrate().migrationsExecuted);
      try (var connection = DriverManager.getConnection(jdbc, username, password);
          var statement = connection.createStatement()) {
        try (var rows =
            statement.executeQuery(
                "SELECT (SELECT count(*) FROM coreerp.products),(SELECT count(*) FROM"
                    + " coreerp.sales_orders),(SELECT count(*) FROM"
                    + " coreerp.daily_summary_sources),(SELECT count(*) FROM"
                    + " coreerp.daily_summaries)")) {
          rows.next();
          assertEquals(10000, rows.getLong(1));
          assertEquals(95, rows.getLong(2));
          assertTrue(rows.getLong(3) > 0);
          assertEquals(0, rows.getLong(4));
        }
      }
    } finally {
      admin.execute("DROP DATABASE " + name + " WITH (FORCE)");
    }
  }
}
