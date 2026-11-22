package dev.coreerp;

import java.time.Clock;
import org.springframework.context.annotation.*;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
public class BatchConfiguration {
  @Bean
  Clock batchClock() {
    return Clock.systemUTC();
  }
}
