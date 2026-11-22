import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Box,
  MenuItem,
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
import { api, money, today, type SalesReport } from "../api";
import { Heading, ErrorNotice, Loading } from "../components/Common";
export default function Reports() {
  const [to, setTo] = useState(today()),
    [from, setFrom] = useState(
      new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    ),
    [unit, setUnit] = useState("day");
  const q = useQuery({
    queryKey: ["sales-report", from, to, unit],
    queryFn: () =>
      api<SalesReport>(
        "/reports/sales?" + new URLSearchParams({ from, to, unit }),
      ),
    enabled: !!from && !!to,
  });
  const rows = q.data?.periods || [],
    total = rows.reduce((n, r) => n + BigInt(r.amount), 0n),
    maximum = rows.reduce(
      (n, r) => (BigInt(r.amount) > n ? BigInt(r.amount) : n),
      1n,
    );
  return (
    <>
      <Heading
        title="매출 분석"
        description="출고 확정일 기준 · 한국 시간 · 종료일 포함 최대 366일. 출고 취소 거래는 집계에서 제외합니다."
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          type="date"
          label="시작일"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          type="date"
          label="종료일"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          select
          label="집계 단위"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          sx={{ minWidth: 130 }}
        >
          <MenuItem value="day">일별</MenuItem>
          <MenuItem value="month">월별</MenuItem>
        </TextField>
      </Stack>
      <ErrorNotice error={q.error} />
      {q.isPending ? (
        <Loading />
      ) : (
        <>
          <Box className="metric-grid">
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography color="text.secondary">기간 출고 매출</Typography>
              <Typography variant="h4" sx={{ mt: 2 }}>
                {money(total)}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography color="text.secondary">출고 건수</Typography>
              <Typography variant="h4" sx={{ mt: 2 }}>
                {rows.reduce((n, r) => n + r.shipments, 0)}건
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography color="text.secondary">상품별 집계</Typography>
              <Typography sx={{ mt: 2 }}>
                판매가 스냅샷 · 수량 합계
                <br />
                금액 순위: SQL DENSE_RANK
              </Typography>
            </Paper>
          </Box>
          <Paper variant="outlined" sx={{ p: 3, my: 3 }}>
            <Typography variant="h6">기간별 매출</Typography>
            {!rows.length ? (
              <Typography sx={{ py: 5 }}>
                선택한 기간의 출고 매출이 없습니다.
              </Typography>
            ) : (
              <>
                <div className="sales-chart" aria-label="기간별 매출 차트">
                  {rows.map((r) => (
                    <div
                      key={r.period}
                      title={r.period + " " + money(r.amount)}
                    >
                      <span
                        style={{
                          height:
                            Math.max(
                              2,
                              Number((BigInt(r.amount) * 100n) / maximum),
                            ) + "%",
                        }}
                      />
                      <small>{r.period.slice(5)}</small>
                    </div>
                  ))}
                </div>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>기간</TableCell>
                        <TableCell align="right">출고</TableCell>
                        <TableCell align="right">매출</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.period}>
                          <TableCell>{r.period}</TableCell>
                          <TableCell align="right">{r.shipments}건</TableCell>
                          <TableCell align="right">{money(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Paper>
          <Box className="two-grid">
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6">
                상품별 판매량·매출 · 상위 100개
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>순위·상품</TableCell>
                      <TableCell>수량</TableCell>
                      <TableCell align="right">매출</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {q.data?.products.map((r) => (
                      <TableRow key={r.productId}>
                        <TableCell>
                          {r.rank}. {r.name}
                        </TableCell>
                        <TableCell>{r.quantity}</TableCell>
                        <TableCell align="right">{money(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6">고객사별 매출 · 상위 100개</Typography>
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
                    {q.data?.customers.map((r) => (
                      <TableRow key={r.customerId}>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>{r.quantity}</TableCell>
                        <TableCell align="right">{money(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Box>
        </>
      )}
    </>
  );
}
