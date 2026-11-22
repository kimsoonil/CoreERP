package dev.coreerp;

import org.springframework.http.HttpStatus;

public class BusinessException extends RuntimeException {
  public final HttpStatus status;
  public final String code;

  public BusinessException(HttpStatus s, String c, String m) {
    super(m);
    status = s;
    code = c;
  }

  public static BusinessException conflict(String m) {
    return new BusinessException(HttpStatus.CONFLICT, "BUSINESS_CONFLICT", m);
  }

  public static BusinessException missing() {
    return new BusinessException(HttpStatus.NOT_FOUND, "NOT_FOUND", "대상을 찾을 수 없습니다.");
  }
}
