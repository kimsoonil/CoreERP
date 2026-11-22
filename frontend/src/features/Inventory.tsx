import ServerTable from "../components/ServerTable";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { GridColDef } from "@mui/x-data-grid";
import { api, can, type User, type Inventory as Row } from "../api";
import { Heading, ErrorNotice } from "../components/Common";
import RemoteSelect from "../components/RemoteSelect";
import { useTask, useRequestKey } from "../components/useTask";
export default function Inventory({ user }: { user: User }) {
  const [warehouse, setWarehouse] = useState<{
      id: number;
      code?: string;
      name: string;
      active: boolean;
    } | null>(null),
    [low, setLow] = useState(false),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [row, setRow] = useState<Row | null>(null);
  const task = useTask(),
    key = useRequestKey(),
    form = useForm<{ delta: number; reason: string }>();
  const columns: GridColDef<Row>[] = [
    { field: "warehouseName", headerName: "창고", width: 140 },
    { field: "sku", headerName: "SKU", width: 145 },
    { field: "name", headerName: "상품", flex: 1, minWidth: 180 },
    { field: "onHand", headerName: "현재고", width: 100 },
    { field: "reserved", headerName: "예약", width: 90 },
    {
      field: "available",
      headerName: "가용",
      width: 95,
      renderCell: (p) => (
        <Typography
          component="strong"
          color={
            p.row.onHand - p.row.reserved < p.row.safetyStock
              ? "error"
              : "inherit"
          }
        >
          {p.row.onHand - p.row.reserved}
        </Typography>
      ),
    },
    { field: "safetyStock", headerName: "안전재고", width: 100 },
    ...(can(user, "WAREHOUSE")
      ? [
          {
            field: "action",
            headerName: "관리",
            width: 90,
            renderCell: (p: { row: Row }) => (
              <Button
                size="small"
                onClick={() => {
                  setRow(p.row);
                  key.reset();
                  task.setError(null);
                  form.reset({ delta: 1, reason: "" });
                }}
              >
                조정
              </Button>
            ),
          },
        ]
      : []),
  ];
  const params =
    "q=" +
    encodeURIComponent(query) +
    (warehouse ? "&warehouse=" + warehouse.id : "") +
    "&low=" +
    low;
  return (
    <>
      <Heading
        title="창고 재고"
        description="가용 재고 = 현재고 − 예약. 창고별 수량과 안전재고 부족 여부를 확인합니다."
      />
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 2 }}>
        <Stack sx={{ minWidth: 220 }}>
          <RemoteSelect
            path="/warehouses"
            label="창고 필터"
            value={warehouse}
            onChange={setWarehouse}
          />
        </Stack>
        <TextField
          label="SKU·상품명 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setQuery(search);
          }}
        />
        <Button variant="outlined" onClick={() => setQuery(search)}>
          검색
        </Button>
        <FormControlLabel
          control={
            <Checkbox
              checked={low}
              onChange={(e) => setLow(e.target.checked)}
            />
          }
          label="안전재고 미만만"
        />
      </Stack>
      <ErrorNotice error={task.error} />
      {task.message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {task.message}
        </Alert>
      )}
      <ServerTable<Row>
        key={params}
        path="/inventory"
        params={params}
        columns={columns}
        rowId={(r) => r.warehouseId + "-" + r.productId}
      />
      <Dialog open={!!row} onClose={() => !task.busy && setRow(null)}>
        <form
          onSubmit={form.handleSubmit(
            (v) =>
              void task.run(async () => {
                const payload = {
                  warehouseId: row!.warehouseId,
                  productId: row!.productId,
                  delta: Number(v.delta),
                  reason: v.reason,
                };
                await api("/inventory/adjustments", {
                  ...payload,
                  requestKey: key.key(payload),
                });
                setRow(null);
                key.reset();
              }, "재고를 조정했습니다."),
          )}
        >
          <DialogTitle>재고 조정 · {row?.name}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography>
                창고: {row?.warehouseName} · 현재고 {row?.onHand} / 예약{" "}
                {row?.reserved}
              </Typography>
              <TextField
                label="증감 수량"
                type="number"
                {...form.register("delta", {
                  valueAsNumber: true,
                  required: true,
                  min: -1000000,
                  max: 1000000,
                  validate: (n) => n !== 0,
                })}
                required
                helperText="입고 조정은 양수, 차감은 음수"
              />
              <TextField
                label="조정 사유"
                {...form.register("reason", { required: true, maxLength: 200 })}
                required
              />
              <ErrorNotice error={task.error} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setRow(null)} disabled={task.busy}>
              닫기
            </Button>
            <Button type="submit" disabled={task.busy} variant="contained">
              조정 확정
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
