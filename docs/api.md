# API 및 권한

실행 후 Swagger `/swagger-ui.html`, 원본 명세 `/v3/api-docs`. [저장된 OpenAPI](openapi.json)도 제공합니다. 명세에는 비밀 값이나 실행 토큰이 없습니다.

## 인증

1. GET `/api/auth/csrf` → `{header,token}` 및 세션 쿠키.
2. POST `/api/auth/login`, form-urlencoded username/password, 발급받은 CSRF 헤더 포함.
3. 로그인 후 GET `/api/auth/csrf`를 다시 호출해 새 토큰을 사용.
4. 쓰기 요청(POST/PUT/PATCH/DELETE)에 CSRF 헤더와 세션 쿠키 첨부. 로그아웃은 POST `/api/auth/logout`.

Swagger UI의 Try it out도 쓰기 요청에는 같은 보안 절차가 필요합니다. 브라우저 로그인 세션과 CSRF 토큰이 없는 호출이 403으로 거부되는 것은 정상입니다. 자동화 사용 예는 브라우저 테스트의 실제 UI 흐름과 MockMvc 테스트를 참고하세요.

| 경로                                  | 주요 작업                                          | 권한(ADMIN은 모두)                     |
| ------------------------------------- | -------------------------------------------------- | -------------------------------------- |
| /api/products                         | GET/POST, /{id} PUT/DELETE                         | 조회 모든 역할, 변경 PURCHASE          |
| /api/suppliers                        | GET/POST, /{id} PUT/DELETE                         | 조회 PURCHASE·WAREHOUSE, 변경 PURCHASE |
| /api/customers                        | GET/POST, /{id} PUT/DELETE                         | 조회 SALES·WAREHOUSE, 변경 SALES       |
| /api/warehouses                       | GET/POST, /{id} PUT/DELETE                         | 조회 모든 역할, 변경 ADMIN             |
| /api/inventory                        | GET warehouse/q/low/page/size                      | 모든 역할                              |
| /api/inventory/adjustments            | POST requestKey/warehouseId/productId/delta/reason | WAREHOUSE                              |
| /api/purchases                        | GET 목록, POST 다품목 생성                         | 조회 PURCHASE·WAREHOUSE, 생성 PURCHASE |
| /api/purchases/{id}                   | GET 상세                                           | PURCHASE·WAREHOUSE                     |
| /api/purchases/{id}/approve, /cancel  | POST 승인/취소                                     | PURCHASE                               |
| /api/purchases/{id}/receipts          | POST 부분 입고                                     | WAREHOUSE                              |
| /api/sales                            | GET 목록, POST 다품목 예약                         | 조회 SALES·WAREHOUSE, 생성 SALES       |
| /api/sales/{id}                       | GET 상세                                           | SALES·WAREHOUSE                        |
| /api/sales/{id}/cancel                | POST 예약 취소                                     | SALES                                  |
| /api/sales/{id}/shipments             | POST 전체 출고                                     | WAREHOUSE                              |
| /api/sales/{id}/shipment-cancellation | POST 출고 취소                                     | WAREHOUSE                              |
| /api/reports/sales                    | GET from/to/unit(day 또는 month)                   | SALES                                  |
| /api/reports/flows                    | GET from/to                                        | PURCHASE·WAREHOUSE                     |
| /api/movements                        | GET 재고 이력 page/size                            | WAREHOUSE                              |
| /api/audits                           | GET 감사 로그 page/size                            | ADMIN                                  |
| /api/users                            | GET 목록·POST 계정 생성                            | ADMIN                                  |
| /api/users/{id}/status                | PATCH ACTIVE/LOCKED                                | ADMIN                                  |

서버 페이지는 0부터, page<=100,000, size 1~200. 검색은 코드·이름 prefix이며 `%`·`_`·`!`를 이스케이프하고 값은 MyBatis로 바인딩합니다. 대규모 깊은 페이지에는 OFFSET 비용이 있으므로 무제한 확장 성능을 주장하지 않습니다.

구매 입력: `{requestKey,warehouseId,supplierId,items:[{productId,quantity,unitPrice}]}`. 판매 입력: `{requestKey,warehouseId,customerId,items:[{productId,quantity}]}`. 입고 입력: `{requestKey,items:[{productId,quantity}]}`. 출고 입력: `{requestKey}`. 새 요청 키는 UUID이며 같은 내용 재시도에는 재사용합니다.

## 표준 오류

```json
{
  "code": "BUSINESS_CONFLICT",
  "message": "가용 재고가 부족합니다.",
  "fieldErrors": {},
  "path": "/api/sales",
  "timestamp": "2026-11-22T00:00:00Z"
}
```

400: VALIDATION_ERROR / INVALID_PERIOD / INVALID_UNIT, 401: AUTH_REQUIRED / LOGIN_FAILED / ACCOUNT_DISABLED, 403: FORBIDDEN(CSRF 포함), 404: NOT_FOUND, 409: BUSINESS_CONFLICT / DATA_CONFLICT, 500: INTERNAL_ERROR. 검증 실패는 fieldErrors를 포함합니다. SQL 구문·DB 비밀번호·예외 스택은 API 응답에 포함하지 않습니다.
