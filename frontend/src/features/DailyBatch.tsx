import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Paper,
  Stack,
  TextField,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import {
  api,
  money,
  kst,
  previousDate,
  type ProductSales,
  type CustomerSales,
} from "../api";
import { Heading, ErrorNotice, Loading } from "../components/Common";
import ServerTable from "../components/ServerTable";
type Summary = {
  businessDate: string;
  sourceVersion: number;
  currentSourceVersion: number;
  runId: string;
  calculatedAt: string;
  salesAmount: string;
  salesShipments: number;
  shippedQuantity: number;
  purchases: number;
  orderedQuantity: number;
  receipts: number;
  receiptQuantity: number;
  stale: boolean;
};
type Run = {
  id: string;
  businessDate: string;
  status: string;
  sourceVersion: number | null;
  triggerType: string;
  actor: string;
  startedAt: string;
  finishedAt: string | null;
  errorCode: string | null;
};
type Result = {
  runId: string;
  businessDate: string;
  status: string;
  sourceVersion: number;
};
const stateLabel = (s: string) =>
  ({
    RUNNING: "실행 중·복구 확인",
    SUCCEEDED: "완료",
    FAILED: "실패",
    SKIPPED: "변경 없음",
    ABANDONED: "중단·재처리 대상",
  })[s] || s;
export default function DailyBatch() {
  const client = useQueryClient(),
    [date, setDate] = useState(previousDate()),
    [from, setFrom] = useState(() => {
      let d = previousDate();
      for (let i = 0; i < 6; i++) d = previousDate(d);
      return d;
    }),
    [to, setTo] = useState(previousDate()),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [result, setResult] = useState<Result | null>(null);
  const q = useQuery({
      queryKey: ["daily-summaries", from, to],
      queryFn: () =>
        api<Summary[]>("/batches/daily/summaries?from=" + from + "&to=" + to),
      enabled: !!from && !!to,
    }),
    detail = useQuery({
      queryKey: ["daily-summary-detail", selected],
      queryFn: () =>
        api<{
          summary: Summary;
          products: ProductSales[];
          customers: CustomerSales[];
        }>("/batches/daily/summaries/" + selected),
      enabled: !!selected,
    });
  async function run(businessDate: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api<Result>("/batches/daily", { businessDate }));
    } catch (e) {
      setError(e);
    } finally {
      await client.invalidateQueries();
      setBusy(false);
    }
  }
  const columns: GridColDef<Summary>[] = [
    { field: "businessDate", headerName: "기준일 · KST", width: 145 },
    {
      field: "salesAmount",
      headerName: "출고 매출",
      width: 145,
      renderCell: (p) => money(p.row.salesAmount),
    },
    { field: "purchases", headerName: "발주", width: 85 },
    { field: "receipts", headerName: "입고", width: 85 },
    { field: "salesShipments", headerName: "출고", width: 85 },
    {
      field: "stale",
      headerName: "조회 시점 상태",
      width: 140,
      renderCell: (p) => (
        <Chip
          size="small"
          label={p.value ? "재집계 필요" : "최신"}
          color={p.value ? "warning" : "success"}
          variant="outlined"
        />
      ),
    },
    { field: "sourceVersion", headerName: "집계 버전", width: 100 },
    { field: "currentSourceVersion", headerName: "원본 버전", width: 100 },
    {
      field: "action",
      headerName: "상세",
      width: 85,
      renderCell: (p) => (
        <Button
          size="small"
          aria-label={p.row.businessDate + " 집계 상세"}
          onClick={() => setSelected(p.row.businessDate)}
        >
          보기
        </Button>
      ),
    },
  ];
  const historyColumns: GridColDef<Run>[] = [
    {
      field: "startedAt",
      headerName: "시작 · KST",
      width: 180,
      renderCell: (p) => kst(p.value),
    },
    { field: "businessDate", headerName: "기준일", width: 130 },
    {
      field: "status",
      headerName: "결과",
      width: 170,
      renderCell: (p) => (
        <Chip
          size="small"
          label={stateLabel(p.value)}
          color={
            p.value === "FAILED" || p.value === "ABANDONED"
              ? "warning"
              : p.value === "SUCCEEDED"
                ? "success"
                : "default"
          }
          variant="outlined"
        />
      ),
    },
    { field: "actor", headerName: "실행자", width: 130 },
    { field: "triggerType", headerName: "방식", width: 115 },
    {
      field: "errorCode",
      headerName: "오류·복구 코드",
      minWidth: 220,
      flex: 1,
    },
    {
      field: "retry",
      headerName: "재처리",
      width: 100,
      renderCell: (p) =>
        ["FAILED", "ABANDONED"].includes(p.row.status) ? (
          <Button
            size="small"
            disabled={busy}
            onClick={() => void run(p.row.businessDate)}
          >
            재처리
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <Heading
        title="일별 집계 배치"
        description="한국 시간 기준 어제까지 처리합니다. 실시간 원본 통계와 분리된 집계 결과·실행 이력을 확인하세요."
      />
      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Stack
          component="form"
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          onSubmit={(e) => {
            e.preventDefault();
            void run(date);
          }}
        >
          <TextField
            type="date"
            label="집계 기준일"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: "2000-01-01", max: previousDate() },
            }}
            required
            disabled={busy}
          />
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? "집계 중…" : "집계 실행"}
          </Button>
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => void client.invalidateQueries()}
          >
            새로 고침
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          원본 변경이 없으면 건너뛰고, 늦게 취소된 거래는 원래 출고일을 다시
          집계합니다. 실패하면 이전 결과를 유지합니다. 자동 스케줄은 서버
          설정으로 별도 활성화합니다.
        </Typography>
        <ErrorNotice error={error} />
        {result && (
          <Alert severity="success" role="status" sx={{ mt: 2 }}>
            {result.status === "SKIPPED"
              ? "변경 없음 · 기존 집계를 유지했습니다."
              : "집계 완료 · 날짜별 결과를 교체했습니다."}
            <br />
            {result.businessDate} · 실행 ID {result.runId}
          </Alert>
        )}
      </Paper>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          type="date"
          label="조회 시작일"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          type="date"
          label="조회 종료일"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>
      <Typography variant="h6" sx={{ mb: 2 }}>
        일별 집계 결과
      </Typography>
      <ErrorNotice error={q.error} />
      {q.data?.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          아직 집계하지 않은 날짜는 표시되지 않습니다. 거래가 없는 날짜도
          실행하면 0으로 기록됩니다.
        </Alert>
      )}
      <DataGrid
        rows={q.data || []}
        columns={columns}
        getRowId={(r) => r.businessDate}
        loading={q.isFetching}
        disableRowSelectionOnClick
        sx={{ height: 400, mb: 4 }}
      />
      <Typography variant="h6" sx={{ mb: 2 }}>
        실행 이력·실패 재처리
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        중단된 실행은 다음 집계 시작 시 커밋 여부를 확인해 복구합니다. 데이터
        커밋 후 이력 확정에 실패한 경우도 같은 날짜를 다시 실행하면 안전하게
        확인합니다.
      </Alert>
      <ServerTable<Run> path="/batches/daily/runs" columns={historyColumns} />
      <Dialog
        open={!!selected}
        onClose={() => setSelected(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{selected} 집계 상세</DialogTitle>
        <DialogContent>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <ErrorNotice error={detail.error} />
          ) : (
            detail.data && (
              <>
                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                  <Chip
                    label={
                      detail.data.summary.stale
                        ? "재집계 필요"
                        : "조회 시점 최신"
                    }
                    color={detail.data.summary.stale ? "warning" : "success"}
                  />
                  <Typography>
                    출고 매출 {money(detail.data.summary.salesAmount)}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  발주 수량 {detail.data.summary.orderedQuantity} · 입고 수량{" "}
                  {detail.data.summary.receiptQuantity} · 출고 수량{" "}
                  {detail.data.summary.shippedQuantity}
                </Typography>
                <Typography variant="h6" sx={{ mt: 3 }}>
                  상품별 매출 · 상위 100개
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>상품</TableCell>
                        <TableCell>수량</TableCell>
                        <TableCell align="right">매출</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.data.products.map((p) => (
                        <TableRow key={p.productId}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell>{p.quantity}</TableCell>
                          <TableCell align="right">{money(p.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="h6" sx={{ mt: 3 }}>
                  고객사별 매출 · 상위 100개
                </Typography>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>고객사</TableCell>
                        <TableCell>수량</TableCell>
                        <TableCell align="right">매출</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.data.customers.map((c) => (
                        <TableRow key={c.customerId}>
                          <TableCell>{c.name}</TableCell>
                          <TableCell>{c.quantity}</TableCell>
                          <TableCell align="right">{money(c.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>닫기</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
