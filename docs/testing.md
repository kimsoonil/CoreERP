# 테스트 구성

운영 DB·게임 DB 대신 일회용 PostgreSQL과 합성 데이터만 사용합니다. 테스트 개수는 커버리지 비율이나 운영 성능을 뜻하지 않습니다.

## Java — JUnit·Mockito·MockMvc·PostgreSQL

| 파일 | 검증 대상 |
| --- | --- |
| CoreIntegrationTest | 발주·부분 입고·예약·출고·취소, 동시 요청·멱등 처리·롤백·권한·CSRF |
| DailySummaryIntegrationTest | 집계 원본/상세 정합성, 중복·동시 실행, 실패 재처리·커밋 후 이력 복구 |
| DailySummaryMigrationTest | 기존 V900 데이터를 V901로 업그레이드할 때 상품·주문 수 보존 |
| ReportServiceTest | KST 포함 시작/제외 종료, 연도·윤년 경계, 최대 366일, 역전·초과 기간 및 잘못된 집계 단위 차단 |
| DailySummarySchedulerTest | 오래된 날짜 우선 처리, 어제 중복 제거, BUSY 시 나머지 연기, 실패 날짜의 다음 트리거 재시도 |

`backend`에서 `./mvnw verify`로 46개를 실행합니다. Docker가 있으면 PostgreSQL 17 Testcontainers가 자동 기동됩니다. 단위 테스트만 실행하려면 `./mvnw -Dtest=ReportServiceTest,DailySummarySchedulerTest test`를 사용합니다.

## React — Vitest·Testing Library·jsdom

| 파일 | 검증 대상 |
| --- | --- |
| api.test.ts | 역할, 큰 정수 금액, 상태 문구, 날짜 계산 |
| api-client.test.ts | 세션 요청·CSRF 발급/재사용/로그인 후 갱신, 401 만료 통지와 다음 요청의 토큰 재발급, 업무/비JSON 오류, CSRF 실패 시 변경 차단 |
| features/DailyBatch.test.tsx | 빈 결과와 기본 날짜, 실행 중 중복 클릭 방지, SKIPPED 문구, 실패 후 이력 갱신·재시도, 조회 오류, 상품·고객사 상세·닫기 |

`frontend`에서 `npm ci && npm test`로 17개를 실행하고 `npm run build`로 TypeScript와 배포 빌드를 확인합니다. 컴포넌트 테스트는 실제 MUI·React Query 컴포넌트를 렌더링하며 API 경계만 모의 응답으로 대체합니다. 테스트마다 캐시를 격리하고 자동 재시도를 꺼 예상하지 못한 요청이 검사를 가리지 않게 합니다.

jsdom 검사는 실제 브라우저 레이아웃이나 DB 트랜잭션 검사를 대신하지 않습니다. `npm run test:e2e`의 Playwright 4개는 실행 중인 demo API·Vite와 합성 DB로 실제 업무 흐름·모바일 권한·1만 상품 페이지·일별 집계를 별도로 검사합니다. Vitest include는 src의 단위/컴포넌트 테스트만 포함해 Playwright와 분리합니다.

## CI

기존 backend·frontend 작업에서 새 테스트도 함께 실행합니다. browser·docker·sql-performance 작업은 실제 브라우저, Compose 기동 및 SQL 측정을 별도로 유지합니다. 성공한 실행은 README와 troubleshooting의 Actions 링크로 확인합니다.
