import ServerTable from "../components/ServerTable";
import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  Divider,
} from "@mui/material";
import type { GridColDef } from "@mui/x-data-grid";
import {
  api,
  can,
  money,
  kst,
  type User,
  type Document,
  type Detail,
} from "../api";
import { Heading, Status, ErrorNotice, Loading } from "../components/Common";
import RemoteSelect from "../components/RemoteSelect";
import { useTask, useRequestKey } from "../components/useTask";
type Option = {
  id: number;
  name: string;
  code?: string;
  sku?: string;
  active: boolean;
  price?: number;
};
type Form = {
  items: {
    productId: number;
    name: string;
    quantity: number;
    unitPrice: number;
  }[];
};
export default function Documents({
  type,
  user,
}: {
  type: "purchases" | "sales";
  user: User;
}) {
  const purchase = type === "purchases",
    creator = can(user, purchase ? "PURCHASE" : "SALES"),
    warehouseRole = can(user, "WAREHOUSE");
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [partner, setPartner] = useState<Option | null>(null),
    [warehouse, setWarehouse] = useState<Option | null>(null),
    [product, setProduct] = useState<Option | null>(null),
    [status, setStatus] = useState(""),
    [receiveQty, setReceiveQty] = useState<Record<number, number>>({}),
    [confirm, setConfirm] = useState<{
      path: string;
      name: string;
      keyed?: boolean;
    } | null>(null);
  const form = useForm<Form>({ defaultValues: { items: [] } }),
    items = useFieldArray({ control: form.control, name: "items" }),
    task = useTask(),
    createKey = useRequestKey(),
    receiptKey = useRequestKey(),
    shipKey = useRequestKey();
  const detail = useQuery({
    queryKey: ["detail", type, selected],
    queryFn: () => api<Detail>("/" + type + "/" + selected),
    enabled: selected !== null,
  });
  const columns: GridColDef<Document>[] = [
    {
      field: "id",
      headerName: purchase ? "발주 번호" : "주문 번호",
      width: 115,
      renderCell: (p) => <strong>#{p.value}</strong>,
    },
    {
      field: "partnerName",
      headerName: purchase ? "공급업체" : "고객사",
      minWidth: 160,
      flex: 1,
    },
    { field: "warehouseName", headerName: "창고", width: 150 },
    {
      field: "status",
      headerName: "진행 상태",
      width: 130,
      renderCell: (p) => <Status value={p.value} />,
    },
    {
      field: "createdAt",
      headerName: "작성일 · KST",
      width: 175,
      renderCell: (p) => kst(p.value),
    },
    {
      field: "action",
      headerName: "상세",
      width: 85,
      renderCell: (p) => (
        <Button
          size="small"
          aria-label={(purchase ? "발주 " : "주문 ") + p.row.id + " 상세"}
          onClick={() => {
            setSelected(p.row.id);
            setReceiveQty({});
            receiptKey.reset();
            task.setError(null);
          }}
        >
          보기
        </Button>
      ),
    },
  ];
  function openCreate() {
    form.reset({ items: [] });
    setPartner(null);
    setWarehouse(null);
    setProduct(null);
    createKey.reset();
    task.setError(null);
    setCreating(true);
  }
  function action(path: string, name: string, keyed = false) {
    setConfirm({ path, name, keyed });
  }
  const states = purchase
    ? ["DRAFT", "APPROVED", "PARTIAL", "RECEIVED", "CANCELLED"]
    : ["RESERVED", "SHIPPED", "CANCELLED"];
  return (
    <>
      <Heading
        title={purchase ? "발주·입고" : "판매·출고"}
        description={
          purchase
            ? "구매 발주를 승인하고 품목별로 부분 입고합니다. 입고 확정 시 해당 창고 재고가 증가합니다."
            : "판매 주문은 가용 재고를 예약합니다. 출고 확정과 취소는 재고·이력에 함께 반영됩니다."
        }
      />
      <Stack
        direction="row"
        spacing={2}
        sx={{ mb: 2, justifyContent: "space-between" }}
      >
        <TextField
          select
          label="상태 필터"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          size="small"
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">전체</MenuItem>
          {states.map((s) => (
            <MenuItem key={s} value={s}>
              {
                {
                  DRAFT: "작성 중",
                  APPROVED: "승인",
                  PARTIAL: "부분 입고",
                  RECEIVED: "입고 완료",
                  RESERVED: "예약",
                  SHIPPED: "출고 완료",
                  CANCELLED: "취소",
                }[s]
              }
            </MenuItem>
          ))}
        </TextField>
        {creator && (
          <Button variant="contained" onClick={openCreate}>
            {purchase ? "발주서 생성" : "판매 주문 등록"}
          </Button>
        )}
      </Stack>
      <ErrorNotice error={task.error} />
      {task.message && (
        <Alert severity="success" role="status" sx={{ mb: 2 }}>
          {task.message}
        </Alert>
      )}
      <ServerTable<Document>
        key={status}
        path={"/" + type}
        params={"status=" + status}
        columns={columns}
      />
      <Dialog
        open={creating}
        onClose={() => !task.busy && setCreating(false)}
        fullWidth
        maxWidth="md"
      >
        <form
          onSubmit={form.handleSubmit(
            (values) =>
              void task.run(
                async () => {
                  if (!warehouse || !partner || !values.items.length)
                    throw new Error(
                      "창고·거래처와 한 개 이상의 품목을 선택해 주세요.",
                    );
                  const payload = {
                    warehouseId: warehouse.id,
                    [purchase ? "supplierId" : "customerId"]: partner.id,
                    items: values.items.map((i) => ({
                      productId: i.productId,
                      quantity: Number(i.quantity),
                      ...(purchase ? { unitPrice: Number(i.unitPrice) } : {}),
                    })),
                  };
                  const result = await api<{ id: number }>("/" + type, {
                    ...payload,
                    requestKey: createKey.key(payload),
                  });
                  setCreating(false);
                  setSelected(result.id);
                  createKey.reset();
                },
                purchase
                  ? "발주서를 생성했습니다."
                  : "재고를 예약하고 판매 주문을 등록했습니다.",
              ),
          )}
        >
          <DialogTitle>
            {purchase ? "새 구매 발주" : "새 판매 주문"}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <RemoteSelect
                  path="/warehouses"
                  label="대상 창고"
                  value={warehouse}
                  onChange={setWarehouse}
                />
                <RemoteSelect
                  path={purchase ? "/suppliers" : "/customers"}
                  label={purchase ? "공급업체 선택" : "고객사 선택"}
                  value={partner}
                  onChange={setPartner}
                />
              </Stack>
              <Divider />
              <Stack direction="row" spacing={1}>
                <RemoteSelect
                  path="/products"
                  label="추가할 상품 검색"
                  value={product}
                  onChange={setProduct}
                />
                <Button
                  disabled={!product || items.fields.length >= 100}
                  onClick={() => {
                    if (product) {
                      if (
                        !form
                          .getValues("items")
                          .some((i) => i.productId === product.id)
                      )
                        items.append({
                          productId: product.id,
                          name: product.name,
                          quantity: 1,
                          unitPrice: product.price || 0,
                        });
                      setProduct(null);
                    }
                  }}
                >
                  품목 추가
                </Button>
              </Stack>
              {items.fields.map((row, index) => (
                <Paper key={row.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={2}
                    alignItems="center"
                  >
                    <Typography sx={{ flex: 1 }}>{row.name}</Typography>
                    <TextField
                      label="수량"
                      type="number"
                      size="small"
                      {...form.register(`items.${index}.quantity`, {
                        required: true,
                        valueAsNumber: true,
                        min: 1,
                        max: 1000000,
                      })}
                      slotProps={{
                        htmlInput: {
                          min: 1,
                          max: 1000000,
                          step: 1,
                          "aria-label": row.name + " 수량",
                        },
                      }}
                      required
                      sx={{ width: 130 }}
                    />
                    {purchase && (
                      <TextField
                        label="매입 단가"
                        type="number"
                        size="small"
                        {...form.register(`items.${index}.unitPrice`, {
                          required: true,
                          valueAsNumber: true,
                          min: 0,
                          max: 1000000000,
                        })}
                        slotProps={{ htmlInput: { min: 0, max: 1000000000 } }}
                        required
                        sx={{ width: 150 }}
                      />
                    )}
                    <Button color="warning" onClick={() => items.remove(index)}>
                      제외
                    </Button>
                  </Stack>
                </Paper>
              ))}
              {!items.fields.length && (
                <Typography color="text.secondary" sx={{ p: 2 }}>
                  상품을 검색한 뒤 품목을 추가해 주세요.
                </Typography>
              )}
              <ErrorNotice error={task.error} />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={task.busy} onClick={() => setCreating(false)}>
              닫기
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={task.busy || !items.fields.length}
            >
              {purchase ? "발주 저장" : "주문 예약"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Dialog
        open={selected !== null && !creating}
        onClose={() => !task.busy && setSelected(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          {purchase ? "발주" : "판매 주문"} #{selected}
        </DialogTitle>
        <DialogContent>
          {detail.isPending ? (
            <Loading />
          ) : detail.error ? (
            <ErrorNotice error={detail.error} />
          ) : (
            detail.data && (
              <>
                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                  <Status value={detail.data.order.status} />
                  <Typography>
                    {detail.data.order.partnerName} ·{" "}
                    {detail.data.order.warehouseName}
                  </Typography>
                </Stack>
                {detail.data.items.map((i) => (
                  <Paper
                    variant="outlined"
                    key={i.productId}
                    sx={{ p: 2, mb: 1.5 }}
                  >
                    <Typography fontWeight={600}>{i.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {i.sku} · {money(i.unitPrice)} × {i.quantity}개
                      {purchase ? " · 입고 " + i.processed + "개" : ""}
                    </Typography>
                    {purchase &&
                      warehouseRole &&
                      ["APPROVED", "PARTIAL"].includes(
                        detail.data.order.status,
                      ) && (
                        <TextField
                          sx={{ mt: 2, width: 190 }}
                          size="small"
                          label="이번 입고 수량"
                          type="number"
                          value={receiveQty[i.productId] ?? 0}
                          onChange={(e) =>
                            setReceiveQty((v) => ({
                              ...v,
                              [i.productId]: Number(e.target.value),
                            }))
                          }
                          slotProps={{
                            htmlInput: {
                              min: 0,
                              max: i.quantity - i.processed,
                              step: 1,
                              "aria-label": i.name + " 입고 수량",
                            },
                          }}
                          helperText={
                            "미입고 " + (i.quantity - i.processed) + "개"
                          }
                        />
                      )}
                  </Paper>
                ))}
                <Typography sx={{ mt: 2, fontWeight: 600 }}>
                  합계{" "}
                  {money(
                    detail.data.items.reduce(
                      (n, i) => n + BigInt(i.unitPrice) * BigInt(i.quantity),
                      0n,
                    ),
                  )}
                </Typography>
                <ErrorNotice error={task.error} />
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ mt: 3, flexWrap: "wrap", gap: 1 }}
                >
                  {purchase ? (
                    <>
                      {creator && detail.data.order.status === "DRAFT" && (
                        <Button
                          disabled={task.busy}
                          variant="contained"
                          onClick={() =>
                            action(
                              "/purchases/" + selected + "/approve",
                              "발주 승인",
                            )
                          }
                        >
                          발주 승인
                        </Button>
                      )}
                      {creator &&
                        ["DRAFT", "APPROVED"].includes(
                          detail.data.order.status,
                        ) && (
                          <Button
                            disabled={task.busy}
                            color="warning"
                            onClick={() =>
                              action(
                                "/purchases/" + selected + "/cancel",
                                "발주 취소",
                              )
                            }
                          >
                            발주 취소
                          </Button>
                        )}
                      {warehouseRole &&
                        ["APPROVED", "PARTIAL"].includes(
                          detail.data.order.status,
                        ) && (
                          <Button
                            disabled={
                              task.busy ||
                              !Object.values(receiveQty).some((n) => n > 0) ||
                              Object.values(receiveQty).some(
                                (n) => !Number.isInteger(n) || n < 0,
                              )
                            }
                            variant="contained"
                            onClick={() =>
                              void task.run(async () => {
                                const payload = {
                                  items: Object.entries(receiveQty)
                                    .filter(([, qty]) => qty > 0)
                                    .map(([id, quantity]) => ({
                                      productId: Number(id),
                                      quantity,
                                    })),
                                };
                                await api(
                                  "/purchases/" + selected + "/receipts",
                                  {
                                    ...payload,
                                    requestKey: receiptKey.key(payload),
                                  },
                                );
                                setReceiveQty({});
                                receiptKey.reset();
                              }, "입고를 확정했습니다.")
                            }
                          >
                            입고 확정
                          </Button>
                        )}
                    </>
                  ) : (
                    <>
                      {creator && detail.data.order.status === "RESERVED" && (
                        <Button
                          disabled={task.busy}
                          color="warning"
                          onClick={() =>
                            action(
                              "/sales/" + selected + "/cancel",
                              "주문 취소",
                            )
                          }
                        >
                          주문 취소
                        </Button>
                      )}
                      {warehouseRole &&
                        detail.data.order.status === "RESERVED" && (
                          <Button
                            disabled={task.busy}
                            variant="contained"
                            onClick={() =>
                              action(
                                "/sales/" + selected + "/shipments",
                                "출고 확정",
                                true,
                              )
                            }
                          >
                            출고 확정
                          </Button>
                        )}
                      {warehouseRole &&
                        detail.data.order.status === "SHIPPED" && (
                          <Button
                            disabled={task.busy}
                            color="warning"
                            onClick={() =>
                              action(
                                "/sales/" + selected + "/shipment-cancellation",
                                "출고 취소",
                              )
                            }
                          >
                            출고 취소
                          </Button>
                        )}
                    </>
                  )}
                </Stack>
              </>
            )
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={task.busy} onClick={() => setSelected(null)}>
            닫기
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!confirm} onClose={() => !task.busy && setConfirm(null)}>
        <DialogTitle>{confirm?.name} 확인</DialogTitle>
        <DialogContent>
          이 작업은 상태와 재고에 반영되고 이력이 기록됩니다. 계속하시겠습니까?
          <ErrorNotice error={task.error} />
        </DialogContent>
        <DialogActions>
          <Button disabled={task.busy} onClick={() => setConfirm(null)}>
            닫기
          </Button>
          <Button
            disabled={task.busy}
            variant="contained"
            onClick={() =>
              void task.run(async () => {
                await api(
                  confirm!.path,
                  confirm!.keyed
                    ? { requestKey: shipKey.key(confirm!.path) }
                    : {},
                );
                shipKey.reset();
                setConfirm(null);
              }, confirm?.name + " 처리했습니다.")
            }
          >
            확정
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
