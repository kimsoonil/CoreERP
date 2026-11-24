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
import { api, ApiError, type User } from "../api";
import Documents from "./Documents";
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: vi.fn(),
}));
const request = vi.mocked(api);
let client: QueryClient;
let status: string;
let mutate: () => Promise<unknown>;
const item = {
  productId: 1,
  sku: "T-1",
  name: "검증 상품",
  quantity: 10,
  processed: 4,
  unitPrice: 1000,
};
const order = () => ({
  id: 1,
  partnerId: 1,
  partnerName: "합성 거래처",
  warehouseId: 1,
  warehouseName: "본사",
  status,
  actor: "test",
  createdAt: "2026-11-20T00:00:00Z",
});
beforeEach(() => {
  status = "RESERVED";
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  mutate = async () => ({ id: 1 });
  request.mockReset();
  request.mockImplementation(async (path, body) => {
    if (body !== undefined) return mutate();
    if (path.includes("?")) return { items: [order()], total: 1 };
    return {
      order: order(),
      items: [item],
      shipmentId: status === "SHIPPED" ? 1 : null,
    };
  });
});
afterEach(() => client.clear());
async function mount(
  type: "sales" | "purchases" = "sales",
  roles: User["roles"] = ["ADMIN"],
) {
  render(
    <QueryClientProvider client={client}>
      <Documents type={type} user={{ username: "test", roles }} />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", {
      name: (type === "sales" ? "주문" : "발주") + " 1 상세",
    }),
  );
  await screen.findByText("검증 상품");
  return user;
}
it("판매 담당자는 예약 주문을 취소할 수 있지만 출고 작업은 표시되지 않는다", async () => {
  await mount("sales", ["SALES"]);
  expect(screen.getByRole("button", { name: "주문 취소" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "출고 확정" }),
  ).not.toBeInTheDocument();
});
it("출고는 확인 전 요청하지 않고 실패 후 동일 요청 키로 재시도한다", async () => {
  mutate = async () => {
    throw new ApiError("재고가 부족합니다.", 409, "BUSINESS_CONFLICT");
  };
  const user = await mount();
  await user.click(screen.getByRole("button", { name: "출고 확정" }));
  expect(request.mock.calls.filter(([, b]) => b !== undefined)).toHaveLength(0);
  const dialog = screen.getByRole("dialog", { name: "출고 확정 확인" });
  await user.click(within(dialog).getByRole("button", { name: "확정" }));
  expect(await within(dialog).findByText("재고가 부족합니다.")).toBeVisible();
  const first = request.mock.calls.find(([, b]) => b !== undefined)!;
  mutate = async () => ({ id: 1 });
  await user.click(within(dialog).getByRole("button", { name: "확정" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "출고 확정 확인" }),
    ).not.toBeInTheDocument(),
  );
  const calls = request.mock.calls.filter(([, b]) => b !== undefined);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(first);
  expect(first[0]).toBe("/sales/1/shipments");
  expect(first[1]).toEqual({ requestKey: expect.any(String) });
});
it("출고 완료 상태에서는 출고 취소만 제공하고 확인한 뒤 취소 API를 호출한다", async () => {
  status = "SHIPPED";
  const user = await mount();
  expect(
    screen.queryByRole("button", { name: "출고 확정" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "출고 취소" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "출고 취소 확인" })).getByRole(
      "button",
      { name: "확정" },
    ),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/sales/1/shipment-cancellation", {}),
  );
});
it("부분 입고에서 0·음수·소수는 확정하지 않고 양수 품목만 전송한다", async () => {
  status = "PARTIAL";
  const user = await mount("purchases", ["WAREHOUSE"]);
  const input = screen.getByRole("spinbutton", { name: "검증 상품 입고 수량" });
  const button = screen.getByRole("button", { name: "입고 확정" });
  expect(button).toBeDisabled();
  for (const value of ["-1", "1.5"]) {
    fireEvent.change(input, { target: { value } });
    expect(button).toBeDisabled();
  }
  fireEvent.change(input, { target: { value: "2" } });
  await user.click(button);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/purchases/1/receipts", {
      items: [{ productId: 1, quantity: 2 }],
      requestKey: expect.any(String),
    }),
  );
  await waitFor(() => expect(input).toHaveValue(0));
  expect(
    screen.queryByRole("button", { name: "발주 취소" }),
  ).not.toBeInTheDocument();
});
it("작성 중 발주에만 승인·취소를 제공하고 승인 확인을 취소하면 변경하지 않는다", async () => {
  status = "DRAFT";
  const user = await mount("purchases", ["PURCHASE"]);
  await user.click(screen.getByRole("button", { name: "발주 승인" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "발주 승인 확인" })).getByRole(
      "button",
      { name: "닫기" },
    ),
  );
  expect(request.mock.calls.filter(([, b]) => b !== undefined)).toHaveLength(0);
  expect(
    screen.queryByRole("button", { name: "입고 확정" }),
  ).not.toBeInTheDocument();
});

it.each(["sales", "purchases"] as const)(
  "%s 취소 확인을 닫으면 요청하지 않고 확정 시에만 취소하며 필터를 갱신한다",
  async (type) => {
    status = type === "purchases" ? "DRAFT" : "RESERVED";
    const user = await mount(type);
    const name = type === "purchases" ? "발주 취소" : "주문 취소";
    await user.click(await screen.findByRole("button", { name }));
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: name + " 확인" }),
      ).not.toBeInTheDocument(),
    );
    expect(request.mock.calls.filter(([, b]) => b !== undefined)).toHaveLength(
      0,
    );
    await user.click(await screen.findByRole("button", { name }));
    await user.click(
      within(screen.getByRole("dialog", { name: name + " 확인" })).getByRole(
        "button",
        { name: "확정" },
      ),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/" + type + "/1/cancel", {}),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: name + " 확인" }),
      ).not.toBeInTheDocument(),
    );
    const detailDialog = await screen.findByRole("dialog", {
      name: (type === "purchases" ? "발주" : "판매 주문") + " #1",
    });
    const close = within(detailDialog).getByRole("button", { name: "닫기" });
    await waitFor(() => expect(close).toBeEnabled());
    await user.click(close);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(
      await screen.findByRole("combobox", { name: "상태 필터" }),
    );
    await user.click(screen.getByRole("option", { name: "취소" }));
    await waitFor(() =>
      expect(
        request.mock.calls.some(([p]) =>
          p.startsWith("/" + type + "?status=CANCELLED"),
        ),
      ).toBe(true),
    );
  },
);
