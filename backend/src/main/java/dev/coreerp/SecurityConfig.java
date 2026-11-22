package dev.coreerp;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import org.springframework.context.annotation.*;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.*;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.csrf.*;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {
  @Bean
  PasswordEncoder encoder() {
    return new BCryptPasswordEncoder();
  }

  @Bean
  UserDetailsService users(CoreMapper db) {
    return name -> {
      var u = db.account(name);
      if (u == null) throw new UsernameNotFoundException("Unknown user");
      return User.withUsername(name)
          .password(u.password())
          .roles(db.roles(name).toArray(String[]::new))
          .disabled(!u.status().equals("ACTIVE"))
          .build();
    };
  }

  @Bean
  SecurityFilterChain chain(HttpSecurity http, CoreMapper db, ObjectMapper json) throws Exception {
    http.authorizeHttpRequests(
            a ->
                a.requestMatchers(
                        "/api/health",
                        "/api/auth/csrf",
                        "/swagger-ui.html",
                        "/swagger-ui/**",
                        "/v3/api-docs/**")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .csrf(
            c ->
                c.csrfTokenRepository(new HttpSessionCsrfTokenRepository())
                    .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()))
        .formLogin(
            f ->
                f.loginProcessingUrl("/api/auth/login")
                    .successHandler(
                        (q, s, a) -> {
                          db.loginAt(a.getName());
                          db.audit(a.getName(), "LOGIN_SUCCESS", "AUTH", null, "{}");
                          s.setContentType("application/json");
                          s.getWriter().write("{\"ok\":true}");
                        })
                    .failureHandler(
                        (q, s, e) -> {
                          String actor = q.getParameter("username");
                          if (actor == null) actor = "anonymous";
                          db.audit(
                              actor.substring(0, Math.min(80, actor.length())),
                              "LOGIN_FAILURE",
                              "AUTH",
                              null,
                              "{}");
                          ApiErrors.security(q, s, json, 401, "LOGIN_FAILED", "계정과 비밀번호를 확인해 주세요.");
                        })
                    .permitAll())
        .logout(
            l ->
                l.logoutUrl("/api/auth/logout")
                    .logoutSuccessHandler(
                        (q, s, a) -> {
                          if (a != null) db.audit(a.getName(), "LOGOUT", "AUTH", null, "{}");
                          s.setStatus(204);
                        }))
        .exceptionHandling(
            e ->
                e.authenticationEntryPoint(
                        (q, s, x) ->
                            ApiErrors.security(q, s, json, 401, "AUTH_REQUIRED", "로그인이 필요합니다."))
                    .accessDeniedHandler(
                        (q, s, x) ->
                            ApiErrors.security(
                                q, s, json, 403, "FORBIDDEN", "권한이 없거나 보안 토큰이 유효하지 않습니다.")))
        .requestCache(c -> c.disable());
    http.addFilterBefore(
        new OncePerRequestFilter() {
          @Override
          protected void doFilterInternal(
              HttpServletRequest q, HttpServletResponse s, FilterChain chain)
              throws ServletException, IOException {
            var a = SecurityContextHolder.getContext().getAuthentication();
            if (a != null && a.isAuthenticated() && !a.getName().equals("anonymousUser")) {
              var u = db.account(a.getName());
              if (u == null || !u.status().equals("ACTIVE")) {
                SecurityContextHolder.clearContext();
                var session = q.getSession(false);
                if (session != null) session.invalidate();
                ApiErrors.security(q, s, json, 401, "ACCOUNT_DISABLED", "계정이 잠겼습니다.");
                return;
              }
            }
            chain.doFilter(q, s);
          }
        },
        AuthorizationFilter.class);
    return http.build();
  }
}
