package dev.coreerp;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.*;
import jakarta.validation.ConstraintViolationException;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import org.slf4j.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class ApiErrors {
  private static final Logger log = LoggerFactory.getLogger(ApiErrors.class);

  public record ErrorBody(
      String code,
      String message,
      Map<String, String> fieldErrors,
      String path,
      String timestamp) {}

  public static ErrorBody body(
      String code, String message, String path, Map<String, String> fields) {
    return new ErrorBody(code, message, fields, path, Instant.now().toString());
  }

  public static void security(
      HttpServletRequest q,
      HttpServletResponse s,
      ObjectMapper json,
      int status,
      String code,
      String message)
      throws IOException {
    s.setStatus(status);
    s.setContentType("application/json;charset=UTF-8");
    json.writeValue(s.getOutputStream(), body(code, message, q.getRequestURI(), Map.of()));
  }

  @ExceptionHandler(BusinessException.class)
  ResponseEntity<ErrorBody> business(BusinessException e, HttpServletRequest q) {
    return ResponseEntity.status(e.status)
        .body(body(e.code, e.getMessage(), q.getRequestURI(), Map.of()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<ErrorBody> validation(MethodArgumentNotValidException e, HttpServletRequest q) {
    var fields = new LinkedHashMap<String, String>();
    e.getBindingResult()
        .getFieldErrors()
        .forEach(f -> fields.put(f.getField(), f.getDefaultMessage()));
    return ResponseEntity.badRequest()
        .body(body("VALIDATION_ERROR", "입력값을 확인해 주세요.", q.getRequestURI(), fields));
  }

  @ExceptionHandler({
    ConstraintViolationException.class,
    org.springframework.web.method.annotation.HandlerMethodValidationException.class,
    org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class,
    org.springframework.http.converter.HttpMessageNotReadableException.class,
    org.springframework.web.bind.MissingServletRequestParameterException.class
  })
  ResponseEntity<ErrorBody> invalid(Exception e, HttpServletRequest q) {
    return ResponseEntity.badRequest()
        .body(body("VALIDATION_ERROR", "입력값과 조회 범위를 확인해 주세요.", q.getRequestURI(), Map.of()));
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<ErrorBody> constraint(Exception e, HttpServletRequest q) {
    return ResponseEntity.status(409)
        .body(body("DATA_CONFLICT", "중복 코드 또는 데이터 제약조건을 확인해 주세요.", q.getRequestURI(), Map.of()));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<ErrorBody> unexpected(Exception e, HttpServletRequest q) {
    if (e instanceof org.springframework.security.access.AccessDeniedException)
      return ResponseEntity.status(403)
          .body(body("FORBIDDEN", "권한이 없습니다.", q.getRequestURI(), Map.of()));
    log.error("Request failed: {}", q.getRequestURI(), e);
    return ResponseEntity.internalServerError()
        .body(
            body(
                "INTERNAL_ERROR",
                "처리 중 오류가 발생했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해 주세요.",
                q.getRequestURI(),
                Map.of()));
  }
}
