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

`backend`에서 `./mvnw verify`로 52개를 실행합니다. Docker가 있으면 PostgreSQL 17 Testcontainers가 자동 기동됩니다. 단위 테스트만 실행하려면 `./mvnw -Dtest=ReportServiceTest,DailySummarySchedulerTest test`를 사용합니다.

## React — Vitest·Testing Library·jsdom

| 파일 | 검증 대상 |
| --- | --- |
| api.test.ts | 역할, 큰 정수 금액, 상태 문구, 날짜 계산 |
| api-client.test.ts | 세션 요청·CSRF 발급/재사용/로그인 후 갱신, 401 만료 통지와 다음 요청의 토큰 재발급, 업무/비JSON 오류, CSRF 실패 시 변경 차단 |
| features/DailyBatch.test.tsx | 빈 결과와 기본 날짜, 실행 중 중복 클릭 방지, SKIPPED 문구, 실패 후 이력 갱신·재시도, 조회 오류, 상품·고객사 상세·닫기 |

`frontend`에서 `npm ci && npm test`로 53개를 실행하고 `npm run build`로 TypeScript와 배포 빌드를 확인합니다. 컴포넌트 테스트는 실제 MUI·React Query 컴포넌트를 렌더링하며 API 경계만 모의 응답으로 대체합니다. 테스트마다 캐시를 격리하고 자동 재시도를 꺼 예상하지 못한 요청이 검사를 가리지 않게 합니다.

jsdom 검사는 실제 브라우저 레이아웃이나 DB 트랜잭션 검사를 대신하지 않습니다. `npm run test:e2e`의 Playwright 4개는 실행 중인 demo API·Vite와 합성 DB로 실제 업무 흐름·모바일 권한·1만 상품 페이지·일별 집계를 별도로 검사합니다. Vitest include는 src의 단위/컴포넌트 테스트만 포함해 Playwright와 분리합니다.

## React 라인 80% 목표 보강

App.test.tsx 10개는 세션 조회 대기·익명 전환, 로그인 후 캐시 제거, 판매 역할의 사용자/발주/배치/공급업체 URL 거부, 관리자 메뉴·직접 진입·알 수 없는 경로, 세션 만료와 리스너 정리, 로그아웃 실패 재시도를 검사합니다. 실제 Router·QueryClient·업무 화면을 사용합니다.

DocumentCreation.test.tsx 4개는 필수 창고/거래처/품목, 다품목 발주와 중복 추가 방지, 수량·매입 단가의 숫자 변환, 품목 제외·잘못된 수량 차단, 판매 주문의 단가 필드 제외, 실패 재시도의 동일 요청 키 및 입력 변경 후 새 키를 검사합니다. 실제 RemoteSelect·React Hook Form으로 입력하고 요청 본문·상세 전환까지 확인합니다.

## React 라인 70% 목표 보강

ManagementScreens.test.tsx 12개를 추가했습니다. 상품 등록 필수값/숫자 변환, 수정 PUT·사용 중지 확인, 역할별 편집 제한과 검색 제출, 고객사 등록 실패 재시도, 재고 조정 0 차단·실패 시 요청 키 유지, 부족/창고 필터, 큰 정수 매출·월별 기간 변경·빈 매출, 대시보드 권한 링크, 자기 계정 잠금 차단·다른 계정 잠금, 사용자 생성, 입출고 기간 변경을 실제 MUI·React Query에서 검사합니다.

## 이번 커버리지 기반 보강

CoreIntegrationTest에 중복 품목·단가·수량 상한·부분 입고 상태·마지막 관리자·비활성 거래처 6개를 추가했습니다. Documents.test.tsx 5개, Login.test.tsx 3개, useTask.test.tsx 2개는 입고·출고·인증·멱등 재시도 화면을 검사합니다. [전후 커버리지와 재현 조건](coverage.md)을 함께 확인하세요.

## CI

기존 backend·frontend 작업에서 새 테스트도 함께 실행합니다. browser·docker·sql-performance 작업은 실제 브라우저, Compose 기동 및 SQL 측정을 별도로 유지합니다. 성공한 실행은 README와 troubleshooting의 Actions 링크로 확인합니다.
