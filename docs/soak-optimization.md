# 15분 부하 지연 증가 분석과 개선

**개인 프로젝트 · 운영 배포 전.** 이전 원본을 유지하고 같은 조건의 새 임시 환경에서 개선 후 측정했습니다. 캐시로 결과를 오래 보관하거나 요청 수·검색 결과·정합성 검사를 줄이는 방식은 사용하지 않았습니다.

## 원본에서 어떤 업무가 느려졌나

요청별 gzip CSV를 업무별·분별로 다시 집계했습니다. 전체 p95 하나로 모든 요청이 느려졌다고 판단하지 않았습니다.

| 업무 | 1분차 p95 | 15분차 p95 |
| --- | ---: | ---: |
| 재고 조회 | 9.80ms | 12.31ms |
| 매출 조회 | 3.34ms | 6.67ms |
| 상품 조회 | 4.11ms | 3.82ms |
| 주문 예약 | 5.21ms | 4.22ms |
| 출고 | 4.67ms | 4.04ms |
| 출고 취소 | 3.56ms | 2.96ms |

읽기 경로 두 곳을 우선 조사했습니다. 위 HTTP 기록만으로 JVM·DB·OS의 기여도를 단정하지 않았습니다. 취소 이력 증가에 따른 매출 스캔 비용과 빈 재고 검색의 불필요한 비용은 재현했지만, 원래 실행의 재고 지연 증가 전부가 특정 generic plan 전환 때문이라고 확정하지 않습니다.

## 확인한 SQL 비용

별도 빈 `coreerp_perf` DB에 V1·V900·V901을 적용하고, 취소된 주문·출고 9,000건을 추가한 고정 데이터에서 검사했습니다. 각 조건 3회 워밍업 후 `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` 7회의 DB 실행 시간 중앙값을 비교했습니다. 동일 데이터·동일 세션에서 비교하고 결과 행의 일치를 확인했습니다. API·네트워크 시간은 포함하지 않습니다.

### 빈 재고 검색의 불필요한 조건·JOIN

기존 빈 검색은 `sku ILIKE '%' OR name ILIKE '%'`와 nullable 창고 조건을 그대로 전달했습니다. 수량만 세는 쿼리도 상품을 JOIN했습니다. 진단 DB의 `plan_cache_mode=auto`에서 첫 custom plan 이후 generic plan 사용을 실제 카운터로 관측했습니다. generic count는 상품을 반복 조회해 많은 블록을 읽었습니다.

빈 검색에서는 문자열 검사를 생략하고 창고 값이 있을 때만 해당 조건을 생성합니다. 재고 총건수는 검색·안전재고 필터가 없으면 상품 JOIN을 제거합니다. 상품 FK와 NOT NULL을 유지하므로 건수 의미가 바뀌지 않습니다. 검색어가 있거나 안전재고 필터를 쓰면 필요한 JOIN·조건을 유지합니다. `%`, `_`, `!`의 문자 검색과 사용 중지된 상품의 이력도 회귀 검사합니다.

직접 진단의 late 데이터에서 자동 계획 재고 count는 **7.018→1.215ms**, generic 계획 count는 **7.096→1.206ms**였습니다. 이는 고정 조회의 SQL 실행 시간이며 API 전체의 개선 배수로 해석하지 않습니다. API 풀 안의 과거 모든 실행계획을 채집한 것은 아니므로, 진단에서 재현한 경로와 이전 HTTP 추세를 구분합니다.

### 취소 이력을 함께 읽던 매출 조회

소규모 초기 데이터의 기간 매출 SQL은 0.044ms 수준이었고, 취소 이력 9,000건이 쌓인 진단에서는 인덱스 추가 전 0.431ms였습니다. 확정 거래만 필요해도 기존 일자 인덱스는 취소 이력을 함께 포함합니다.

V902에 아래 부분 인덱스를 추가했습니다. 과거 거래를 지우거나 집계 의미를 바꾸지 않습니다.

```sql
CREATE INDEX shipments_confirmed_created
ON coreerp.shipments(created_at,id) INCLUDE(sales_order_id)
WHERE status='CONFIRMED';
```

같은 9,000건 취소 데이터에서 기간 매출 SQL 중앙값은 **0.431→0.018ms**였고 결과는 같았습니다. 매우 작은 warm-cache SQL 측정값으로 타이머·캐시의 영향을 받습니다. 확정 출고 비율이 높거나 다른 기간·부하에서는 다른 계획을 선택할 수 있습니다. 인덱스의 쓰기 유지 비용은 뒤의 동일 업무 혼합 부하에 포함합니다.

[실행계획·7회 값·generic/custom 카운터·동등성 검사](evidence/soak-query-analysis.json) · [진단 도구](../tools/soak-query-analysis.mjs)

## 같은 15분 조건의 재측정

이전/개선 후 모두 Apple M4·macOS·PostgreSQL 18.7·Java 21·Node v24.19.0·DB 풀 12개, 새 임시 클러스터, 같은 demo seed와 복구·재시작 사전 단계입니다. 15분·독립 관리자 세션 8개·조회 작업 6개/쓰기 2개, 조회 뒤 40ms·업무 사이클 뒤 200ms, 30회 워밍업을 유지했습니다. 상품·재고·매출의 조회 순서와 예약→출고→취소 업무도 같습니다.

장애 사전 검사 도구는 PostgreSQL 종료 시 HTTP 500 또는 실제 연결 단절(원본 상태 0)을 실패로 받아들이도록 보강했습니다. 성공 응답을 허용하지 않으며 롤백·재로그인·동일 키 재시도 검사는 그대로입니다. 부하 측정은 이 사전 단계가 끝난 뒤 시작하므로 부하 중 오류를 제외하지 않습니다.

| 항목 | 이전 | 개선 후 |
| --- | ---: | ---: |
| 전체 요청 | 143481 | 144922 |
| 전체 p50(ms) | 3.46 | 4.11 |
| 전체 p95(ms) | 11.23 | 7.99 |
| 전체 p99(ms) | 12.13 | 9.33 |
| 완료 업무 사이클 | 8618 | 8404 |
| 전체 1분차 → 15분차 p95(ms) | 9 → 11.69 | 7.35 → 8.46 |

| 업무 | 이전 전체 p95 | 개선 후 전체 p95 | 이전 마지막 1분 p95 | 개선 후 마지막 1분 p95 |
| --- | ---: | ---: | ---: | ---: |
| cancelShipment | 3.09ms | 5.07ms | 2.96ms | 5.35ms |
| inventory | 11.95ms | 8.85ms | 12.31ms | 9.3ms |
| products | 3.73ms | 5.89ms | 3.82ms | 5.97ms |
| reserve | 4.3ms | 8.57ms | 4.22ms | 8.76ms |
| salesReport | 5.95ms | 5.65ms | 6.67ms | 5.88ms |
| ship | 4.03ms | 7.04ms | 4.04ms | 6.98ms |

전체 p95는 **28.85% 감소**했지만, p50는 3.46→4.11ms로 증가했고 예약·출고·취소의 p95도 증가했습니다. 완료 사이클도 8,618→8,404개로 줄었습니다. 모든 요청이 빨라졌다고 결론 내리지 않습니다. 개선 후에도 전체 분별 p95는 7.35→8.46ms로 증가했으므로 증가 현상이 완전히 사라진 것은 아닙니다. 재고·매출 읽기 비용과 꼬리 지연은 줄었지만 쓰기·중앙값 회귀가 있는 절충안입니다.

개선 후 900.162초, 144,922건 모두 200, 예상 밖 오류 0개였습니다. 종료 후 현재고 100,000·예약 0·전체 재고 불변식 위반 0개와 PITR·서비스 장애 복구를 다시 통과했습니다. 원본 CSV의 건수·상태·업무별 건수·p95와 환경·작업 설정이 전후 비교 도구의 검사를 통과했습니다.

### 쓰기 회귀를 숨기지 않고 분리 검사

부분 인덱스는 상태가 바뀔 때 유지 비용이 생깁니다. 별도 새 DB에서 동일 확정 출고 행을 취소하는 UPDATE를 매번 롤백하며 인덱스 있음→없음→있음 순서로 각 3회 워밍업·7회 측정했습니다. 변경 결과는 유지하지 않습니다.

| 진단 | 인덱스 있음 1 | 없음 | 있음 2 |
| --- | ---: | ---: | ---: |
| UPDATE 계획 노드 WAL 바이트 중앙값 | 297 | 105 | 297 |
| UPDATE 계획 노드 WAL 레코드 중앙값 | 4 | 1 | 4 |
| UPDATE 실행 시간 중앙값 | 0.027ms | 0.02ms | 0.022ms |

[WAL 원본 계획](evidence/soak-index-write-cost.json) · [진단 코드](../tools/soak-index-cost.mjs). WAL 증가라는 실제 쓰기 비용은 관측했지만, 이 롤백 UPDATE 측정은 전체 업무 트랜잭션·커밋 fsync·JVM·호스트 경합을 포함하지 않습니다. 따라서 HTTP 쓰기 회귀 전체가 이 인덱스 하나 때문이라고 단정하지 않습니다. 후속으로 다회 교차 실행과 SQL/잠금/WAL/GC의 동시 관측이 필요합니다.


[원본 비교 JSON](evidence/soak-comparison.json) · [개선 후 전체 검증·분별 결과](evidence/soak-after/recovery-soak.json) · [개선 후 요청별 CSV(gzip)](evidence/soak-after/recovery-soak-samples.csv.gz) · [이전 원본](evidence/recovery-soak.json)

## 재현

1. [기존 복구·부하 가이드](recovery-soak.md)와 같은 바이너리·환경으로 개선 버전 JAR를 빌드합니다.
2. `tools`에서 `EVIDENCE_DIR=../docs/evidence/soak-after npm run check:recovery-soak`를 실행합니다. 기존 원본 폴더를 덮어쓰지 않습니다.
3. 저장소 루트에서 아래 비교를 실행합니다.

```sh
python3 tools/compare-soaks.py \
  --before docs/evidence/recovery-soak.json \
  --after docs/evidence/soak-after/recovery-soak.json \
  --output docs/evidence/soak-comparison.json
```

SQL 진단은 별도의 **빈 `coreerp_perf` DB**, loopback DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD를 환경변수로 설정한 뒤 `tools`에서 `npm run analyze:soak-queries`로 실행합니다. 이미 coreerp 스키마가 있으면 중단하고 기존 자료를 덮어쓰지 않습니다. 자격증명은 결과에 포함하지 않습니다.

## 해석의 한계

이전→개선 후 순서로 각 1회 실행했으며 무작위 교차 실험·다회 신뢰구간은 아닙니다. 같은 호스트의 외부 프로세스·온도·GC·JIT를 완전히 통제하지 않았으므로 HTTP 개선 전부를 특정 인덱스 하나의 효과라고 분해하지 않습니다. closed-loop이므로 빨라지면 완료 요청·업무 사이클 수가 달라집니다. 최대 사용자 수·포화점·운영 SLA나 메모리 누수 부재를 증명하지 않습니다. 운영 배포 전 상태를 유지합니다.

참고: [PostgreSQL 18 PREPARE와 generic/custom 계획](https://www.postgresql.org/docs/18/sql-prepare.html) · [부분 인덱스](https://www.postgresql.org/docs/18/indexes-partial.html)

## 검증 기록

Java 54개와 라인 85.46%·분기 77.55%를 새 임시 DB에서 확인했습니다. [업무 코드 6aa7e4d의 CI](https://github.com/kimsoonil/CoreERP/actions/runs/46149494559)는 backend·frontend·browser·docker·sql-performance 5개 작업을 통과했습니다. 15분 부하와 별도 WAL 진단은 로컬 실험이며 기본 CI에 자동 실행된 것으로 표기하지 않습니다.
