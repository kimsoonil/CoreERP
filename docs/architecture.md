# 아키텍처 및 구현 단계

## 프로젝트 경계

기존 flow-ledger는 읽기 전용으로 분석했습니다. Maven Wrapper, 인증 설정 패턴, 행 잠금·요청 키 처리 개념을 활용했고, 재고를 상품 단위에서 창고×상품 단위로 확장해 새 모델로 작성했습니다. 기존 게임·ERP DB 연결정보·배포 설정·회사 소스는 복사하지 않았습니다.

`frontend/`: React SPA. `backend/`: Spring Boot REST API. `tools/`: 별도 SQL 성능 실험. `docs/`: 설계·검증. 복잡한 분산 아키텍처 없이 한 API·한 DB에서 업무 트랜잭션을 처리합니다.

## 계층

- ApiController: 입력 검증·역할 권한, HTTP 계약. 업무 판단은 서비스에 위임.
- MasterService: 기준정보 등록/수정/사용 중지. SQL 동적 테이블명은 내부 enum의 suppliers/customers/warehouses 세 개만 허용.
- BusinessService: 발주·입고·주문·출고·취소 및 재고의 단일 트랜잭션.
- UserService: BCrypt 계정·상태 변경, 마지막 활성 관리자 보호.
- ReportService: 기간 검증과 한국 시간 경계 계산.
- CoreMapper: 바인딩 SQL, 조인·집계·잠금. DTO record는 API와 SQL 결과 계약을 명시.

## 상태 관리와 화면

React Query가 API 조회·캐시·재조회, React Hook Form이 입력, React Router가 화면 URL을 관리합니다. 업무 데이터는 서버의 PostgreSQL이 기준입니다. MUI DataGrid Community의 서버 페이지 조회·기본 가상화·필터 화면을 사용하며, 검색은 명시적 검색 버튼으로 반영합니다. 문서 상세와 확인 다이얼로그를 통해 상태 변경 전 내용을 확인합니다. 화면별 lazy import와 별도 DataGrid 모듈로 초기 번들을 분리합니다.

## 보안

세션 쿠키(HttpOnly / SameSite=Lax), BCrypt, Spring Security CSRF, API별 메서드 권한. 로그인 성공 후 새 CSRF 토큰을 받습니다. 비밀번호·세션 토큰을 localStorage에 저장하지 않습니다. 세션이 있어도 매 요청 사용자 상태를 검사해 잠금 계정 접근을 차단합니다. 역할은 서버 DB에서 로그인 시 읽으며 공개 가입 API가 없습니다.

ADMIN은 모든 기능. PURCHASE는 상품·공급업체·구매 발주/승인, WAREHOUSE는 기준정보 조회·입고·재고 조정·출고/취소, SALES는 고객사·판매 주문/취소·매출 조회입니다. 창고 목록·상품·재고 조회는 모든 로그인 역할이 사용할 수 있습니다. 단일 회사 작업공간 모델이며 회사별 데이터 격리는 제공하지 않습니다.

## Phase 기록

1. 독립 모노레포·Java 21·React·PostgreSQL·Compose 초기화, Java 빌드 확인.
2. 19개 테이블과 Flyway, 기준정보 API, 계정/RBAC/CSRF/감사·표준 오류 구현. MockMvc 및 DB 검사.
3. 부분 입고·원자적 예약·출고·취소·요청 키 구현. 강제 트리거 오류와 동시 연결로 롤백·정합성 검사.
4. MUI 업무 화면·서버 검색/페이지·보고서 구현. 브라우저에서 실제 업무 흐름 검사.
5. Swagger·ERD·SQL 20만 건 실행계획·README·CI·이력서 요약 작성. 외부 운영 배포와 2차 일별 배치는 미구현.
