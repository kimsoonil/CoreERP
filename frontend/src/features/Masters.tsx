import ServerTable from "../components/ServerTable";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  Alert,
  Chip,
} from "@mui/material";
import type { GridColDef } from "@mui/x-data-grid";
import { api, can, money, type User, type Product, type Master } from "../api";
import { Heading, ErrorNotice } from "../components/Common";
import { useTask } from "../components/useTask";
type Kind = "products" | "suppliers" | "customers" | "warehouses";
type Form = {
  sku: string;
  code: string;
  name: string;
  price: number;
  safetyStock: number;
};
export default function Masters({ type, user }: { type: Kind; user: User }) {
  const title = {
      products: "상품 관리",
      suppliers: "공급업체",
      customers: "고객사",
      warehouses: "창고 관리",
    }[type],
    isProduct = type === "products",
    editable = can(
      user,
      ...((type === "warehouses"
        ? ["ADMIN"]
        : type === "customers"
          ? ["SALES"]
          : ["PURCHASE"]) as ("ADMIN" | "SALES" | "PURCHASE")[]),
    );
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<Product | Master | null | undefined>(),
    [confirm, setConfirm] = useState<Product | Master | null>(null);
  const form = useForm<Form>(),
    task = useTask();
  function open(row?: Product | Master) {
    task.setError(null);
    setEditing(row || null);
    form.reset({
      sku: isProduct && row ? (row as Product).sku : "",
      code: !isProduct && row ? (row as Master).code : "",
      name: row?.name || "",
      price: isProduct && row ? (row as Product).price : 1000,
      safetyStock: isProduct && row ? (row as Product).safetyStock : 5,
    });
  }
  const columns: GridColDef[] = [
    {
      field: isProduct ? "sku" : "code",
      headerName: isProduct ? "SKU" : "코드",
      width: 155,
    },
    { field: "name", headerName: "이름", minWidth: 210, flex: 1 },
    ...(isProduct
      ? [
          {
            field: "price",
            headerName: "판매가",
            width: 140,
            renderCell: (p: { value?: number }) => money(p.value ?? 0),
          },
          { field: "safetyStock", headerName: "안전재고", width: 100 },
        ]
      : []),
    {
      field: "active",
      headerName: "사용 상태",
      width: 110,
      renderCell: (p) => (
        <Chip
          size="small"
          label={p.value ? "사용" : "중지"}
          color={p.value ? "success" : "default"}
          variant="outlined"
        />
      ),
    },
    ...(editable
      ? [
          {
            field: "actions",
            headerName: "관리",
            width: 170,
            sortable: false,
            renderCell: (p: { row: Product | Master }) => (
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button
                  size="small"
                  disabled={!p.row.active}
                  onClick={() => open(p.row)}
                >
                  수정
                </Button>
                <Button
                  size="small"
                  color="warning"
                  disabled={!p.row.active}
                  onClick={() => setConfirm(p.row)}
                >
                  사용 중지
                </Button>
              </Stack>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      <Heading
        title={title}
        description="업무에 사용할 기준정보를 등록·수정하고, 사용하지 않는 항목은 이력을 보존하며 중지합니다."
      />
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 2 }}
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(search);
        }}
      >
        <TextField
          size="small"
          label="코드 또는 이름 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="outlined" type="submit">
          검색
        </Button>
        {editable && (
          <Button variant="contained" onClick={() => open()}>
            등록
          </Button>
        )}
      </Stack>
      <ErrorNotice error={task.error} />
      {task.message && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {task.message}
        </Alert>
      )}
      <ServerTable
        key={query}
        path={"/" + type}
        params={"q=" + encodeURIComponent(query)}
        columns={columns}
      />
      <Dialog
        open={editing !== undefined}
        onClose={() => !task.busy && setEditing(undefined)}
        fullWidth
        maxWidth="sm"
      >
        <form
          onSubmit={form.handleSubmit(
            (values) =>
              void task.run(async () => {
                const body = isProduct
                  ? {
                      sku: values.sku,
                      name: values.name,
                      price: Number(values.price),
                      safetyStock: Number(values.safetyStock),
                    }
                  : { code: values.code, name: values.name };
                await api(
                  "/" + type + (editing ? "/" + editing.id : ""),
                  body,
                  editing ? "PUT" : "POST",
                );
                setEditing(undefined);
              }, "저장했습니다."),
          )}
        >
          <DialogTitle>
            {title} {editing ? "수정" : "등록"}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label={isProduct ? "SKU" : "코드"}
                {...form.register(isProduct ? "sku" : "code", {
                  required: true,
                  pattern: /^[A-Za-z0-9_-]+$/,
                  maxLength: 40,
                })}
                required
              />
              <TextField
                label="이름"
                {...form.register("name", { required: true, maxLength: 120 })}
                required
              />
              {isProduct && (
                <>
                  <TextField
                    label="판매가"
                    type="number"
                    slotProps={{ htmlInput: { min: 0, max: 1000000000 } }}
                    {...form.register("price", {
                      required: true,
                      valueAsNumber: true,
                      min: 0,
                      max: 1000000000,
                    })}
                    required
                  />
                  <TextField
                    label="안전재고"
                    type="number"
                    slotProps={{ htmlInput: { min: 0, max: 1000000 } }}
                    {...form.register("safetyStock", {
                      required: true,
                      valueAsNumber: true,
                      min: 0,
                      max: 1000000,
                    })}
                    required
                  />
                </>
              )}
              <ErrorNotice error={task.error} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditing(undefined)} disabled={task.busy}>
              닫기
            </Button>
            <Button type="submit" variant="contained" disabled={task.busy}>
              저장
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>사용 중지 확인</DialogTitle>
        <DialogContent>
          {confirm?.name}의 신규 거래 사용을 중지합니다. 과거 거래 이력은
          보존됩니다.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>닫기</Button>
          <Button
            color="warning"
            disabled={task.busy}
            onClick={() =>
              void task.run(async () => {
                await api("/" + type + "/" + confirm!.id, undefined, "DELETE");
                setConfirm(null);
              }, "사용 중지했습니다.")
            }
          >
            사용 중지
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
