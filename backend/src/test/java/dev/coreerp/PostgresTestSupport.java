package dev.coreerp;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

abstract class PostgresTestSupport {
  private static PostgreSQLContainer<?> container;

  @DynamicPropertySource
  static void postgres(DynamicPropertyRegistry r) {
    String external = System.getenv("DB_URL");
    if (external != null && !external.isBlank()) {
      r.add("spring.datasource.url", () -> external);
      r.add("spring.datasource.username", () -> System.getenv("DB_USER"));
      r.add("spring.datasource.password", () -> System.getenv("DB_PASSWORD"));
    } else {
      container = new PostgreSQLContainer<>("postgres:17-alpine").withDatabaseName("coreerp_test");
      container.start();
      r.add("spring.datasource.url", container::getJdbcUrl);
      r.add("spring.datasource.username", container::getUsername);
      r.add("spring.datasource.password", container::getPassword);
      Runtime.getRuntime().addShutdownHook(new Thread(() -> container.stop()));
    }
  }
}
