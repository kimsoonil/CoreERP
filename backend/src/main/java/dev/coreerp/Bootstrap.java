package dev.coreerp;

import org.springframework.boot.*;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class Bootstrap implements ApplicationRunner {
  private final CoreMapper db;
  private final PasswordEncoder encoder;
  private final Environment env;

  public Bootstrap(CoreMapper d, PasswordEncoder e, Environment n) {
    db = d;
    encoder = e;
    env = n;
  }

  public void run(ApplicationArguments args) {
    String p = env.getProperty("app.admin-password", "");
    if (!p.isBlank()) create("admin", p, "ADMIN");
    if (env.matchesProfiles("demo")) {
      String demo = env.getProperty("app.demo-password", "");
      for (String role : new String[] {"PURCHASE", "WAREHOUSE", "SALES"})
        create(role.toLowerCase(), demo, role);
    }
  }

  private void create(String name, String password, String role) {
    if (password.length() < 12
        || password.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72)
      throw new IllegalArgumentException("Bootstrap password must contain 12-72 characters");
    if (db.account(name) == null) {
      long id = db.createUser(name, encoder.encode(password));
      db.userRole(id, role);
    }
  }
}
