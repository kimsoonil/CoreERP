import ServerTable from "../components/ServerTable";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Alert,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { api, kst, today, type User } from "../api";
import { Heading, ErrorNotice } from "../components/Common";
import { useTask } from "../components/useTask";
type UserRow = {
  id: number;
  username: string;
  status: string;
  roles: string[];
  lastLoginAt: string | null;
};
export default function Operations({
  type,
  user,
}: {
  type: "flows" | "movements" | "audits" | "users";
  user: User;
}) {
  const [from, setFrom] = useState(
      new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    ),
    [to, setTo] = useState(today()),
    [creating, setCreating] = useState(false),
    [confirm, setConfirm] = useState<UserRow | null>(null),
    task = useTask(),
    form = useForm<{ username: string; password: string; role: string }>({
      defaultValues: { role: "SALES" },
    });
  const users = useQuery({
      queryKey: ["users"],
      queryFn: () => api<UserRow[]>("/users"),
      enabled: type === "users",
    }),
    flows = useQuery({
      queryKey: ["flows", from, to],
      queryFn: () =>
        api<
          {
            day: string;
            purchases: number;
            orderedQuantity: number;
            receipts: number;
            receiptQuantity: number;
            shipments: number;
            shippedQuantity: number;
          }[]
        >("/reports/flows?from=" + from + "&to=" + to),
      enabled: type === "flows" && !!from && !!to,
    });
  const movementColumns: GridColDef[] = [
      {
        field: "createdAt",
        headerName: "일시 · KST",
        width: 180,
        renderCell: (p) => kst(p.value),
      },
      { field: "warehouseName", headerName: "창고", width: 140 },
      { field: "productName", headerName: "상품", flex: 1, minWidth: 180 },
      { field: "kind", headerName: "유형", width: 130 },
      { field: "delta", headerName: "증감", width: 100 },
      { field: "referenceId", headerName: "참조 문서", width: 110 },
      { field: "actor", headerName: "처리자", width: 130 },
    ],
    auditColumns: GridColDef[] = [
      {
        field: "createdAt",
        headerName: "일시 · KST",
        width: 180,
        renderCell: (p) => kst(p.value),
      },
      { field: "actor", headerName: "사용자", width: 130 },
      { field: "action", headerName: "작업", width: 190 },
      { field: "entityType", headerName: "대상 유형", width: 130 },
      { field: "entityId", headerName: "대상 ID", width: 100 },
      { field: "details", headerName: "세부 정보", flex: 1, minWidth: 200 },
    ],
    userColumns: GridColDef<UserRow>[] = [
      { field: "username", headerName: "아이디", width: 180 },
      {
        field: "roles",
        headerName: "역할",
        width: 180,
        renderCell: (p) => p.row.roles.join(", "),
      },
      { field: "status", headerName: "상태", width: 120 },
      {
        field: "lastLoginAt",
        headerName: "최근 로그인 · KST",
        width: 200,
        renderCell: (p) => (p.value ? kst(p.value) : "없음"),
      },
      {
        field: "action",
        headerName: "관리",
        width: 140,
        renderCell: (p) => (
          <Button
            size="small"
            color={p.row.status === "ACTIVE" ? "warning" : "primary"}
            disabled={p.row.username === user.username}
            onClick={() => setConfirm(p.row)}
          >
            {p.row.status === "ACTIVE" ? "계정 잠금" : "잠금 해제"}
          </Button>
        ),
      },
    ];
  const title = {
    flows: "발주·입출고 통계",
    movements: "재고 이력",
    audits: "감사 로그",
    users: "사용자 관리",
  }[type];
  return (
    <>
      <Heading
        title={title}
        description={
          {
            flows:
              "한국 시간 기준으로 발주·입고·출고 건수와 수량을 확인합니다.",
            movements: "수동 조정·입고·출고·출고 취소 내역을 확인합니다.",
            audits:
              "로그인·상태 변경·업무 처리 기록을 확인합니다. 비밀번호는 기록하지 않습니다.",
            users:
              "역할별 계정을 생성하고 사용 상태를 관리합니다. 잠긴 계정의 기존 접속도 차단합니다.",
          }[type]
        }
      />
      <ErrorNotice error={task.error} />
      {task.message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {task.message}
        </Alert>
      )}
      {type === "flows" ? (
        <>
          <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
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
          </Stack>
          <ErrorNotice error={flows.error} />
          <DataGrid
            sx={{ height: 570 }}
            rows={flows.data || []}
            getRowId={(r) => r.day}
            columns={[
              { field: "day", headerName: "날짜", width: 150 },
              { field: "purchases", headerName: "발주 건수", width: 130 },
              { field: "orderedQuantity", headerName: "발주 수량", width: 130 },
              { field: "receipts", headerName: "입고 건수", width: 130 },
              { field: "receiptQuantity", headerName: "입고 수량", width: 130 },
              { field: "shipments", headerName: "확정 출고", width: 130 },
              { field: "shippedQuantity", headerName: "출고 수량", width: 130 },
            ]}
            loading={flows.isFetching}
            disableRowSelectionOnClick
          />
        </>
      ) : type === "users" ? (
        <>
          <Button
            variant="contained"
            sx={{ mb: 2 }}
            onClick={() => {
              form.reset({ username: "", password: "", role: "SALES" });
              task.setError(null);
              setCreating(true);
            }}
          >
            사용자 생성
          </Button>
          <ErrorNotice error={users.error} />
          <DataGrid
            sx={{ height: 570 }}
            rows={users.data || []}
            columns={userColumns}
            loading={users.isFetching}
            disableRowSelectionOnClick
          />
        </>
      ) : (
        <ServerTable
          path={"/" + type}
          columns={type === "audits" ? auditColumns : movementColumns}
        />
      )}
      <Dialog open={creating} onClose={() => !task.busy && setCreating(false)}>
        <form
          onSubmit={form.handleSubmit(
            (v) =>
              void task.run(async () => {
                await api("/users", v);
                setCreating(false);
              }, "사용자를 생성했습니다."),
          )}
        >
          <DialogTitle>사용자 생성</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1, minWidth: 280 }}>
              <TextField
                label="아이디"
                {...form.register("username", {
                  required: true,
                  pattern: /^[a-zA-Z0-9_-]{3,40}$/,
                })}
                required
                helperText="영문·숫자·밑줄·하이픈 3~40자"
              />
              <TextField
                label="초기 비밀번호"
                type="password"
                autoComplete="new-password"
                {...form.register("password", {
                  required: true,
                  minLength: 12,
                  maxLength: 72,
                })}
                required
                helperText="12자 이상·UTF-8 72바이트 이하. 안전한 별도 경로로 전달하세요."
              />
              <TextField
                select
                label="역할"
                defaultValue="SALES"
                {...form.register("role", { required: true })}
              >
                {["ADMIN", "PURCHASE", "WAREHOUSE", "SALES"].map((r) => (
                  <MenuItem key={r} value={r}>
                    {r}
                  </MenuItem>
                ))}
              </TextField>
              <ErrorNotice error={task.error} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={task.busy} onClick={() => setCreating(false)}>
              닫기
            </Button>
            <Button variant="contained" type="submit" disabled={task.busy}>
              생성
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Dialog open={!!confirm} onClose={() => !task.busy && setConfirm(null)}>
        <DialogTitle>계정 상태 변경</DialogTitle>
        <DialogContent>
          {confirm?.username} 계정을{" "}
          {confirm?.status === "ACTIVE"
            ? "잠급니다. 기존 접속도 차단됩니다."
            : "다시 활성화합니다."}
          <ErrorNotice error={task.error} />
        </DialogContent>
        <DialogActions>
          <Button disabled={task.busy} onClick={() => setConfirm(null)}>
            닫기
          </Button>
          <Button
            disabled={task.busy}
            onClick={() =>
              void task.run(async () => {
                await api(
                  "/users/" + confirm!.id + "/status",
                  {
                    status: confirm!.status === "ACTIVE" ? "LOCKED" : "ACTIVE",
                  },
                  "PATCH",
                );
                setConfirm(null);
              }, "계정 상태를 변경했습니다.")
            }
          >
            확정
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
