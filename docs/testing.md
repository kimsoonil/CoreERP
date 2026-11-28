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

`backend`에서 `./mvnw verify`로 54개를 실행합니다. Docker가 있으면 PostgreSQL 17 Testcontainers가 자동 기동됩니다. 단위 테스트만 실행하려면 `./mvnw -Dtest=ReportServiceTest,DailySummarySchedulerTest test`를 사용합니다.

## React — Vitest·Testing Library·jsdom

| 파일 | 검증 대상 |
| --- | --- |
| api.test.ts | 역할, 큰 정수 금액, 상태 문구, 날짜 계산 |
| api-client.test.ts | 세션 요청·CSRF 발급/재사용/로그인 후 갱신, 401 만료 통지와 다음 요청의 토큰 재발급, 업무/비JSON 오류, CSRF 실패 시 변경 차단 |
| features/DailyBatch.test.tsx | 빈 결과와 기본 날짜, 실행 중 중복 클릭 방지, SKIPPED 문구, 실패 후 이력 갱신·재시도, 조회 오류, 상품·고객사 상세·닫기 |

`frontend`에서 `npm ci && npm test`로 61개를 실행하고 `npm run build`로 TypeScript와 배포 빌드를 확인합니다. 컴포넌트 테스트는 실제 MUI·React Query 컴포넌트를 렌더링하며 API 경계만 모의 응답으로 대체합니다. 테스트마다 캐시를 격리하고 자동 재시도를 꺼 예상하지 못한 요청이 검사를 가리지 않게 합니다.

jsdom 검사는 실제 브라우저 레이아웃이나 DB 트랜잭션 검사를 대신하지 않습니다. `npm run test:e2e`의 Playwright 4개는 실행 중인 demo API·Vite와 합성 DB로 실제 업무 흐름·모바일 권한·1만 상품 페이지·일별 집계를 별도로 검사합니다. Vitest include는 src의 단위/컴포넌트 테스트만 포함해 Playwright와 분리합니다.

## React 라인 95% 목표 보강

8개를 추가해 Vitest 61개를 실행합니다. main.test.tsx는 실제 createRoot를 감싼 spy로 root 연결을 확인하고 실제 StrictMode·MUI 테마·QueryClient·BrowserRouter·App을 마운트합니다. 세션 조회 실패의 로그인 전환과 버튼 테마 적용까지 확인한 뒤 root를 unmount합니다.

DailyBatch.test.tsx는 FAILED/ABANDONED만 재처리 버튼을 제공하는지, 선택 날짜 재처리, 조회 기간·새로 고침·실행 기준일, 상세 조회 오류·Escape 닫기를 추가했습니다. Documents.test.tsx는 발주·판매 취소 확인을 닫을 때 요청하지 않는지, 확정 요청과 상태 필터를 검사합니다. ManagementScreens.test.tsx는 상품 모달 취소·계정 잠금 해제 오류와 재시도·모달 닫기를 검사합니다. 모달 전환과 busy 종료는 UI가 실제 사용 가능해질 때까지 기다리며 고정 지연으로 넘기지 않습니다.

## React 라인 80% 목표 보강

App.test.tsx 10개는 세션 조회 대기·익명 전환, 로그인 후 캐시 제거, 판매 역할의 사용자/발주/배치/공급업체 URL 거부, 관리자 메뉴·직접 진입·알 수 없는 경로, 세션 만료와 리스너 정리, 로그아웃 실패 재시도를 검사합니다. 실제 Router·QueryClient·업무 화면을 사용합니다.

DocumentCreation.test.tsx 4개는 필수 창고/거래처/품목, 다품목 발주와 중복 추가 방지, 수량·매입 단가의 숫자 변환, 품목 제외·잘못된 수량 차단, 판매 주문의 단가 필드 제외, 실패 재시도의 동일 요청 키 및 입력 변경 후 새 키를 검사합니다. 실제 RemoteSelect·React Hook Form으로 입력하고 요청 본문·상세 전환까지 확인합니다.

## React 라인 70% 목표 보강

ManagementScreens.test.tsx 12개를 추가했습니다. 상품 등록 필수값/숫자 변환, 수정 PUT·사용 중지 확인, 역할별 편집 제한과 검색 제출, 고객사 등록 실패 재시도, 재고 조정 0 차단·실패 시 요청 키 유지, 부족/창고 필터, 큰 정수 매출·월별 기간 변경·빈 매출, 대시보드 권한 링크, 자기 계정 잠금 차단·다른 계정 잠금, 사용자 생성, 입출고 기간 변경을 실제 MUI·React Query에서 검사합니다.

## 이번 커버리지 기반 보강

CoreIntegrationTest에 중복 품목·단가·수량 상한·부분 입고 상태·마지막 관리자·비활성 거래처 6개를 추가했습니다. Documents.test.tsx 5개, Login.test.tsx 3개, useTask.test.tsx 2개는 입고·출고·인증·멱등 재시도 화면을 검사합니다. [전후 커버리지와 재현 조건](coverage.md)을 함께 확인하세요.

## CI

기존 backend·frontend 작업에서 새 테스트도 함께 실행합니다. browser·docker·sql-performance 작업은 실제 브라우저, Compose 기동 및 SQL 측정을 별도로 유지합니다. 성공한 실행은 README와 troubleshooting의 Actions 링크로 확인합니다.

## 2026-11-28 — 업무 시연 검증 보강

Java에 출고·예약 취소 동시 경합 테스트를 추가했습니다. 시작 장벽과 별도 스레드의 실제 트랜잭션으로 12회 실행하며 한쪽만 성공하고 문서·재고·감사 기록이 일치하는지 확인합니다.

기존 브라우저 업무 테스트에는 출고 전 매출 기준값, 출고 후 +3,000원·출고 +1건·상품 수량 3개, 화면의 상품 매출, 출고 취소 후 기준값 원복을 추가했습니다. 테스트 개수는 4개 그대로이며 검사 내용을 보강했습니다. 날짜는 UTC가 아니라 API와 같은 KST를 사용합니다. 발주 입력·부분 입고·출고 후 매출 화면을 추가 저장합니다. [시연 가이드](demo-walkthrough.md)를 참고하세요.

## 로컬 운영 실험 — 기본 CI와 분리

2026-11-28, [운영 검증 도구](../tools/operations-check.mjs)로 실제 논리 백업/새 DB 복원, 출고 중 DB 연결 종료·롤백·동일 키 재시도, 30초 HTTP 조회 부하·재고 주문/중복 출고 경합을 검사했습니다. [실제 측정값과 한계](local-operations.md)를 확인하세요. 기존 JUnit·Vitest·Playwright 118개와는 별도 실험이며 테스트 개수에 합산하지 않았습니다.

## WAL 복구·프로세스 장애·15분 부하

[recovery-soak.mjs](../tools/recovery-soak.mjs)는 새 임시 클러스터를 직접 생성하며 기존 DB 주소를 받지 않습니다. 물리 기본 백업·WAL 목표 복구, PostgreSQL immediate 종료·Java SIGKILL 후 복구, 독립 세션 8개의 15분 혼합 부하와 마지막 재고 불변식을 검사했습니다. [실측·원본 CSV·재현](recovery-soak.md). 일반 CI 118개와 별도이며 개수를 부풀려 합산하지 않습니다.

## 조회 SQL 최적화 회귀 검사

CoreIntegrationTest에 빈 검색·창고 지정·안전재고 필터·문자 검색·사용 중지 상품·페이지 총건수 검사를 추가했습니다. 실제 PostgreSQL에서 Mapper의 동적 SQL 결과를 검사합니다. Java 54개로 늘었고 [같은 조건의 전후 측정](soak-optimization.md)은 별도 도구와 원본 CSV로 검증합니다.
