# SQL 실행계획·인덱스 개선 사례

## 확인하려는 문제

창고·상품·기간별 재고 증감 합계를 조회할 때 전체 stock_movements를 읽는 비용을 비교합니다. UI 렌더링/FPS/네트워크 성능이나 동시 사용자 처리량 측정이 아닙니다.

```sql
SELECT coalesce(sum(delta), 0)
FROM coreerp.stock_movements
WHERE warehouse_id = $1 AND product_id = $2
  AND created_at >= $3 AND created_at < $4;

CREATE INDEX movements_lookup
  ON coreerp.stock_movements(warehouse_id, product_id, created_at);
```

## 측정 조건

- 2026-11-22, macOS arm64, Apple M4, 임시 PostgreSQL 18.7, 합성 이력 200,000행 / 상품 1,000개 / 창고 3개. 정확한 버전·CPU 문자열은 원본 JSON 참조.
- 고정 인자: 창고 1, 상품 42, 2026-11-01 00:00Z 이상~11-08 00:00Z 미만. 일치 2행, 결과 합계 -2.
- 동일 세션·동일 데이터·동일 SQL·같은 인자, jit off / parallel workers 0.
- 각 조건 3회 워밍업 후 EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) 7회. DB Execution Time 중앙값 사용.
- 인덱스 생성 시간은 측정에서 제외. 전후 ANALYZE, 캐시가 따뜻한 조건. 실행 순서는 인덱스 없음 → 있음이며 무작위 교차 실험은 아님.

| 조건             | 계획                          | 중앙값  | 읽은 캐시 블록(대표 실행) |
| ---------------- | ----------------------------- | ------- | ------------------------- |
| 복합 인덱스 없음 | Seq Scan, 199,998행 필터 제거 | 5.535ms | 2,062                     |
| 복합 인덱스 있음 | Index Scan, 2행 반환          | 0.003ms | 5                         |

이 값은 단일 고선택도 조회의 관측 결과입니다. 0.003ms는 매우 작은 수치로 타이머 해상도·캐시의 영향을 크게 받습니다. 배수 단위의 일반적인 성능 개선이나 운영 지연시간 보장으로 해석하지 않습니다. 쓰기 시 인덱스 유지 비용·저선택도 검색·냉 캐시·동시 부하는 별도로 검토해야 합니다. SKU/이름 ILIKE OR 검색이 이 인덱스로 빨라진다는 주장도 하지 않습니다.

[원본 실행계획·7회 결과·측정 환경 JSON](evidence/sql-index-benchmark.json)

## 같은 실험 재현

반드시 **새로 만든 빈 coreerp_perf DB**를 사용합니다. 도구는 DB 이름을 확인하고, 기존 coreerp 스키마가 있으면 생성이 실패합니다. 기존 업무 테이블을 자동 삭제하지 않습니다.

Docker 실행 중:

```sh
docker compose exec db createdb -U coreerp coreerp_perf
docker compose --profile tools run --build --rm benchmark
```

또는 PostgreSQL에 직접 접속할 수 있는 개발 환경:

```sh
cd tools
npm ci
# PERF_DATABASE_URL을 새 coreerp_perf DB의 PostgreSQL URL로 설정(채팅·Git에 값 저장 금지)
npm run benchmark
```

결과는 docs/evidence/sql-index-benchmark.json에 기록합니다. 재실행할 때는 새 빈 실험 DB를 준비해야 합니다. 환경이 달라지면 수치도 달라집니다. GitHub Actions는 별도 PostgreSQL 17에서 같은 스크립트를 실행하고 결과를 아티팩트로 보관합니다.

## 집계 SQL

CoreMapper.xml의 confirmedLines는 출고·주문·품목을 JOIN합니다. productSales는 CTE에서 품목별 수량·금액을 집계하고 DENSE_RANK로 매출 순위를 계산합니다. flowStats는 발주·입고·출고를 각각 CTE에서 일별 집계한 뒤 FULL JOIN해 한 종류의 거래만 있는 날짜도 보존합니다. JUnit에서 고정 거래의 예상값 및 원본 거래 합계와 비교합니다.
