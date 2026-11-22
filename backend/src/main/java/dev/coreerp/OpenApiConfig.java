package dev.coreerp;

import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.media.*;
import io.swagger.v3.oas.models.parameters.*;
import io.swagger.v3.oas.models.responses.*;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.*;

@Configuration
public class OpenApiConfig {
  @Bean
  OpenApiCustomizer authenticationDocs() {
    return api -> {
      api.setServers(List.of(new Server().url("/")));
      api.getPaths()
          .values()
          .forEach(
              path ->
                  path.readOperationsMap()
                      .forEach(
                          (method, operation) -> {
                            if (method != PathItem.HttpMethod.GET)
                              operation.addParametersItem(csrf());
                          }));
      for (String path : List.of("/api/health", "/api/auth/csrf"))
        api.getPaths().get(path).getGet().setSecurity(List.of());
      ObjectSchema form = new ObjectSchema();
      form.addProperty("username", new StringSchema());
      form.addProperty("password", new StringSchema().format("password"));
      form.setRequired(List.of("username", "password"));
      api.path(
          "/api/auth/login",
          new PathItem()
              .post(
                  new Operation()
                      .summary("로그인 (Spring Security filter)")
                      .security(List.of())
                      .addParametersItem(csrf())
                      .requestBody(
                          new RequestBody()
                              .required(true)
                              .content(
                                  new Content()
                                      .addMediaType(
                                          "application/x-www-form-urlencoded",
                                          new MediaType().schema(form))))
                      .responses(
                          new ApiResponses()
                              .addApiResponse(
                                  "200", new ApiResponse().description("로그인 성공; CSRF 토큰 재발급 필요"))
                              .addApiResponse("401", new ApiResponse().description("계정 또는 비밀번호 오류"))
                              .addApiResponse(
                                  "403", new ApiResponse().description("CSRF 토큰 오류")))));
      api.path(
          "/api/auth/logout",
          new PathItem()
              .post(
                  new Operation()
                      .summary("로그아웃 (Spring Security filter)")
                      .addParametersItem(csrf())
                      .responses(
                          new ApiResponses()
                              .addApiResponse("204", new ApiResponse().description("세션 종료")))));
    };
  }

  private HeaderParameter csrf() {
    return (HeaderParameter)
        new HeaderParameter()
            .name("X-CSRF-TOKEN")
            .required(true)
            .description("GET /api/auth/csrf 응답 token. 세션 쿠키와 함께 전송, 로그인 후 새 토큰 사용.")
            .schema(new StringSchema());
  }
}
