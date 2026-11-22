# Java·React 커버리지 측정과 보강

2026-11-22, 개인 프로젝트의 동일 업무 소스에 대해 기존 테스트와 보강 테스트를 각각 실행했습니다. 운영 배포 전입니다.

| 측정 대상 | 보강 전 라인 | 보강 후 라인 | 보강 전 분기 | 보강 후 분기 |
| --- | ---: | ---: | ---: | ---: |
| Java 전체 | 82.43% (516/626) | 83.71% (524/626) | 71.94% (141/196) | 76.02% (149/196) |
| React 전체 | 21.29% (82/385) | 42.33% (163/385) | 17.94% (61/340) | 43.82% (149/340) |

카운터 원본 요약: [보강 전](evidence/coverage-before.json) · [보강 후](evidence/coverage-after.json). 기존 테스트 기준 소스는 `aee3b33931b9754b65fb12a169512989fd7df96c`입니다. 테스트 수는 Java 46→52개, Vitest 17→27개입니다. 별도 Playwright 4개는 아래 커버리지에 합산하지 않습니다.

## 측정 범위와 재현

- Java: JaCoCo 0.8.14, Java 21, 전체 컴파일 클래스 포함(별도 제외 없음). 단위·MockMvc·실제 DB 통합 테스트를 함께 실행합니다. MyBatis XML/SQL 자체의 커버리지 수치는 아닙니다.
- React: Vitest 4.1.12 V8, jsdom, `src/**/*.{ts,tsx}` 전체 포함. 미검사 파일도 0으로 포함합니다. 테스트·테스트 설정·타입 선언만 제외합니다. 실제 브라우저 레이아웃 검증 비율이 아닙니다.
- 로컬 PostgreSQL 18.7의 일회용 `_test` DB, 동일 합성 데이터 초기화 조건으로 전후 비교했습니다. CI는 PostgreSQL 17 Testcontainers에서 다시 검사하고 별도 HTML/XML·V8 보고서를 아티팩트로 저장합니다. 로컬 수치를 CI 측정값으로 바꾸어 부르지 않습니다.

```sh
cd backend
./mvnw clean verify
# target/site/jacoco/index.html, jacoco.xml
cd ../frontend
npm ci
npm run test:coverage
# coverage/index.html, coverage-summary.json, coverage-final.json
```

루트에서 측정 카운터를 추출하려면:

```sh
python3 tools/summarize-coverage.py --java backend/target/site/jacoco/jacoco.xml --react frontend/coverage/coverage-summary.json --output /tmp/coreerp-coverage.json
```

CI와 같은 회귀 방지 기준: Java 라인 83%·분기 75%, React 라인/구문 42%·분기 43%·함수 32%. 전체가 충분히 검증됐다는 목표치가 아니라 이번에 확보한 검증이 줄어드는 것을 잡는 하한입니다.

## 발견한 공백과 추가 검증

Java는 동일 상품의 중복 발주 라인 정규화·단가 충돌·합산 상한, 중복 판매 라인의 예약과 반복 취소, 부분 입고 후 취소/재승인 거부, 마지막 활성 관리자 잠금 차단·UTF-8 비밀번호 상한, 거래처 사용 중지 후 신규 거래 차단과 기존 이력 보존을 DB 결과와 함께 검사했습니다(6개).

React는 발주·판매 Documents 화면이 기존 Vitest에서 0%였습니다. 실제 MUI·React Query를 렌더링하여 역할별 작업 노출, 확인 전 변경 금지, 출고 실패 후 동일 요청 키 재사용, 출고 완료 후 취소, 부분 입고의 0·음수·소수 입력 차단과 양수 전송, 승인 확인 취소를 검사했습니다(5개). 로그인 빈 값·인증 실패 재시도·대기 중 재전송 방지(3개), 요청 키 수명과 업무 실패/성공 캐시 갱신(2개)도 추가했습니다.

보강 후 Documents 라인 62.65%·분기 74.28%, Login과 useTask 라인 100%입니다. 숫자만 채우는 렌더링 테스트 대신 상태·요청·오류·재시도 결과를 검사했습니다.

## 남은 검증

React 전체 라인은 아직 42.33%입니다. App 라우팅/세션 화면 전환, Inventory·Masters·Reports·Dashboard·Operations·RemoteSelect와 Documents의 생성 폼은 단위/컴포넌트 검사가 부족합니다. 기존 Playwright가 일부 업무를 다루더라도 이 V8 수치에는 포함되지 않습니다. Java도 직렬화/해시의 내부 오류, 일부 API·보안 오류 분기가 남습니다. 커버리지 통과가 모든 업무 조건·보안·동시성·성능을 보장하지 않습니다.
