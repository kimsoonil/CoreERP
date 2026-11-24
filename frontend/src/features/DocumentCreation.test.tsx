import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { api, ApiError } from "../api";
import Documents from "./Documents";
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: vi.fn(),
}));
const request = vi.mocked(api);
let client: QueryClient;
let mutate: () => Promise<unknown>;
let kind: "sales" | "purchases";
const products = [
  { id: 1, sku: "A", name: "상품 A", price: 1000, active: true },
  { id: 2, sku: "B", name: "상품 B", price: 2000, active: true },
];
beforeEach(() => {
  kind = "purchases";
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  mutate = async () => ({ id: 9 });
  request.mockReset();
  request.mockImplementation(async (path, body) => {
    if (body !== undefined) return mutate();
    if (path.startsWith("/products?")) return { items: products, total: 2 };
    if (path.startsWith("/warehouses?"))
      return {
        items: [{ id: 3, code: "W", name: "본사", active: true }],
        total: 1,
      };
    if (path.startsWith("/suppliers?") || path.startsWith("/customers?"))
      return {
        items: [{ id: 4, code: "PARTNER", name: "거래처", active: true }],
        total: 1,
      };
    if (path.includes("?")) return { items: [], total: 0 };
    return {
      order: {
        id: 9,
        partnerId: 4,
        partnerName: "거래처",
        warehouseId: 3,
        warehouseName: "본사",
        status: kind === "purchases" ? "DRAFT" : "RESERVED",
        actor: "test",
        createdAt: "2026-11-20T00:00:00Z",
      },
      items: [],
      shipmentId: null,
    };
  });
});
afterEach(() => client.clear());
async function mount(type: "purchases" | "sales" = "purchases") {
  kind = type;
  render(
    <QueryClientProvider client={client}>
      <Documents type={type} user={{ username: "admin", roles: ["ADMIN"] }} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", {
      name: type === "purchases" ? "발주서 생성" : "판매 주문 등록",
    }),
  );
  return user;
}
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  name: string,
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name }));
}
async function add(
  user: ReturnType<typeof userEvent.setup>,
  name = "A · 상품 A",
) {
  await choose(user, "추가할 상품 검색", name);
  await user.click(screen.getByRole("button", { name: "품목 추가" }));
}
async function partners(user: ReturnType<typeof userEvent.setup>) {
  await choose(user, "대상 창고", "W · 본사");
  await choose(
    user,
    kind === "purchases" ? "공급업체 선택" : "고객사 선택",
    "PARTNER · 거래처",
  );
}
it("빈 품목은 저장을 막고 창고·거래처를 선택하지 않으면 요청하지 않는다", async () => {
  const user = await mount();
  expect(screen.getByRole("button", { name: "발주 저장" })).toBeDisabled();
  await add(user);
  await user.click(screen.getByRole("button", { name: "발주 저장" }));
  expect(
    await within(screen.getByRole("dialog")).findByText(
      "창고·거래처와 한 개 이상의 품목을 선택해 주세요.",
    ),
  ).toBeVisible();
  expect(request.mock.calls.filter(([, b]) => b !== undefined)).toHaveLength(0);
});
it("다품목 발주는 중복 추가를 막고 숫자 수량·매입 단가를 전송한 뒤 상세를 연다", async () => {
  const user = await mount();
  await partners(user);
  await add(user);
  await add(user);
  expect(
    screen.getAllByRole("spinbutton", { name: /상품 A 수량/ }),
  ).toHaveLength(1);
  await add(user, "B · 상품 B");
  fireEvent.change(screen.getByRole("spinbutton", { name: "상품 A 수량" }), {
    target: { value: "3" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "상품 B 수량" }), {
    target: { value: "2" },
  });
  const prices = screen.getAllByLabelText(/^매입 단가/);
  fireEvent.change(prices[0], { target: { value: "700" } });
  fireEvent.change(prices[1], { target: { value: "1500" } });
  await user.click(screen.getByRole("button", { name: "발주 저장" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/purchases", {
      warehouseId: 3,
      supplierId: 4,
      items: [
        { productId: 1, quantity: 3, unitPrice: 700 },
        { productId: 2, quantity: 2, unitPrice: 1500 },
      ],
      requestKey: expect.any(String),
    }),
  );
  expect(await screen.findByRole("heading", { name: "발주 #9" })).toBeVisible();
});
it("품목 제외와 잘못된 수량을 처리하고 판매 주문에는 매입 단가를 보내지 않는다", async () => {
  const user = await mount("sales");
  await partners(user);
  await add(user);
  await add(user, "B · 상품 B");
  await user.click(screen.getAllByRole("button", { name: "제외" })[1]);
  expect(
    screen.queryByRole("spinbutton", { name: "상품 B 수량" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/^매입 단가/)).not.toBeInTheDocument();
  const qty = screen.getByRole("spinbutton", { name: "상품 A 수량" });
  fireEvent.change(qty, { target: { value: "0" } });
  await user.click(screen.getByRole("button", { name: "주문 예약" }));
  expect(request.mock.calls.filter(([, b]) => b !== undefined)).toHaveLength(0);
  fireEvent.change(qty, { target: { value: "2" } });
  await user.click(screen.getByRole("button", { name: "주문 예약" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/sales", {
      warehouseId: 3,
      customerId: 4,
      items: [{ productId: 1, quantity: 2 }],
      requestKey: expect.any(String),
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "판매 주문 #9" }),
  ).toBeVisible();
});
it("실패 재시도는 같은 요청 키를 쓰고 품목 수량 변경 후에는 새 키를 만든다", async () => {
  mutate = async () => {
    throw new ApiError("일시 처리 실패", 500, "FAILED");
  };
  const user = await mount();
  await partners(user);
  await add(user);
  const button = screen.getByRole("button", { name: "발주 저장" });
  await user.click(button);
  expect(
    await within(screen.getByRole("dialog")).findByText("일시 처리 실패"),
  ).toBeVisible();
  const first = request.mock.calls.find(([, b]) => b !== undefined)!;
  await user.click(button);
  await waitFor(() =>
    expect(request.mock.calls.filter(([, b]) => b !== undefined)).toHaveLength(
      2,
    ),
  );
  expect(request.mock.calls.filter(([, b]) => b !== undefined)[1]).toEqual(
    first,
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "상품 A 수량" }), {
    target: { value: "4" },
  });
  mutate = async () => ({ id: 9 });
  await user.click(button);
  await waitFor(() =>
    expect(request.mock.calls.filter(([, b]) => b !== undefined)).toHaveLength(
      3,
    ),
  );
  const calls = request.mock.calls.filter(([, b]) => b !== undefined);
  expect(calls[2][1]).toEqual(
    expect.objectContaining({
      items: [{ productId: 1, quantity: 4, unitPrice: 1000 }],
    }),
  );
  expect((calls[2][1] as { requestKey: string }).requestKey).not.toBe(
    (first[1] as { requestKey: string }).requestKey,
  );
});
