import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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
import Masters from "./Masters";
import Inventory from "./Inventory";
import Reports from "./Reports";
import Dashboard from "./Dashboard";
import Operations from "./Operations";
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: vi.fn(),
}));
const request = vi.mocked(api);
const admin: User = { username: "admin", roles: ["ADMIN"] };
let client: QueryClient;
let change: () => Promise<unknown>;
const product = {
  id: 1,
  sku: "SKU-1",
  name: "합성 상품",
  price: 1000,
  safetyStock: 5,
  active: true,
};
const master = { id: 1, code: "W-1", name: "본사 창고", active: true };
const stock = {
  warehouseId: 1,
  productId: 1,
  warehouseName: "본사 창고",
  sku: "SKU-1",
  name: "합성 상품",
  onHand: 10,
  reserved: 4,
  safetyStock: 8,
};
const sales = {
  periods: [
    { period: "2026-11-20", amount: "9007199254740993", shipments: 2 },
    { period: "2026-11-21", amount: "7", shipments: 1 },
  ],
  products: [
    {
      productId: 1,
      sku: "SKU-1",
      name: "합성 상품",
      quantity: 3,
      amount: "9007199254741000",
      rank: 1,
    },
  ],
  customers: [
    {
      customerId: 1,
      name: "합성 고객사",
      quantity: 3,
      amount: "9007199254741000",
    },
  ],
};
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  change = async () => ({ id: 2 });
  request.mockReset();
  request.mockImplementation(async (path, body, method) => {
    if (body !== undefined || method === "DELETE") return change();
    if (path === "/overview")
      return { products: 10000, lowStock: 2, reserved: 4 };
    if (path.startsWith("/reports/sales")) return sales;
    if (path.startsWith("/reports/flows"))
      return [
        {
          day: "2026-11-20",
          purchases: 2,
          orderedQuantity: 30,
          receipts: 1,
          receiptQuantity: 10,
          shipments: 1,
          shippedQuantity: 3,
        },
      ];
    if (path === "/users")
      return [
        {
          id: 1,
          username: "admin",
          roles: ["ADMIN"],
          status: "ACTIVE",
          lastLoginAt: null,
        },
        {
          id: 2,
          username: "member",
          roles: ["SALES"],
          status: "ACTIVE",
          lastLoginAt: "2026-11-20T00:00:00Z",
        },
      ];
    return {
      items: path.startsWith("/inventory")
        ? [stock]
        : path.startsWith("/products")
          ? [product]
          : [master],
      total: 1,
    };
  });
});
afterEach(() => client.clear());
function mount(ui: React.ReactNode) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("상품은 필수값이 없으면 저장하지 않고 정상 입력은 숫자 본문으로 등록한다", async () => {
  const user = mount(<Masters type="products" user={admin} />);
  await user.click(screen.getByRole("button", { name: "등록" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  expect(request.mock.calls.filter(([, b]) => b !== undefined)).toHaveLength(0);
  await user.type(within(dialog).getByLabelText(/^SKU/), "NEW_1");
  await user.type(within(dialog).getByLabelText(/^이름/), "새 상품");
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/products",
      { sku: "NEW_1", name: "새 상품", price: 1000, safetyStock: 5 },
      "POST",
    ),
  );
  expect(await screen.findByText("저장했습니다.")).toBeVisible();
});
it("기존 상품을 수정하면 PUT으로 보내고 사용 중지는 확인 후 DELETE로 보낸다", async () => {
  const user = mount(<Masters type="products" user={admin} />);
  await user.click(await screen.findByRole("button", { name: "수정" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByLabelText(/^SKU/)).toHaveValue("SKU-1");
  fireEvent.change(within(dialog).getByLabelText(/^판매가/), {
    target: { value: "2000" },
  });
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/products/1",
      expect.objectContaining({ price: 2000 }),
      "PUT",
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole("button", { name: "사용 중지" }));
  expect(request.mock.calls.filter(([, , m]) => m === "DELETE")).toHaveLength(
    0,
  );
  await user.click(
    within(screen.getByRole("dialog", { name: "사용 중지 확인" })).getByRole(
      "button",
      { name: "사용 중지" },
    ),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/products/1", undefined, "DELETE"),
  );
});
it("판매 담당자는 상품 등록 권한이 없고 검색은 제출한 조건만 요청한다", async () => {
  const user = mount(
    <Masters type="products" user={{ username: "sales", roles: ["SALES"] }} />,
  );
  await screen.findByText("합성 상품");
  expect(
    screen.queryByRole("button", { name: "등록" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "수정" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("코드 또는 이름 검색"), "A&B");
  expect(request.mock.calls.some(([p]) => p.includes("q=A%26B"))).toBe(false);
  await user.click(screen.getByRole("button", { name: "검색" }));
  await waitFor(() =>
    expect(request.mock.calls.some(([p]) => p.includes("q=A%26B"))).toBe(true),
  );
});
it("거래처 등록 실패는 입력을 유지하고 정상 재시도로 저장한다", async () => {
  change = async () => {
    throw new ApiError("코드 중복", 409, "CONFLICT");
  };
  const user = mount(<Masters type="customers" user={admin} />);
  await user.click(screen.getByRole("button", { name: "등록" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText(/^코드/), "NEW");
  await user.type(within(dialog).getByLabelText(/^이름/), "새 고객사");
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  expect(await within(dialog).findByText("코드 중복")).toBeVisible();
  expect(within(dialog).getByLabelText(/^이름/)).toHaveValue("새 고객사");
  change = async () => ({ id: 2 });
  await user.click(within(dialog).getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/customers",
      { code: "NEW", name: "새 고객사" },
      "POST",
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("재고 조정은 0을 차단하고 장애 재시도에 동일 요청 키를 유지한다", async () => {
  change = async () => {
    throw new ApiError("재고 조정 실패", 500, "FAILED");
  };
  const user = mount(<Inventory user={admin} />);
  await user.click(await screen.findByRole("button", { name: "조정" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText(/^조정 사유/), "실사 차이");
  fireEvent.change(within(dialog).getByLabelText(/^증감 수량/), {
    target: { value: "0" },
  });
  await user.click(within(dialog).getByRole("button", { name: "조정 확정" }));
  expect(request.mock.calls.filter(([, b]) => b !== undefined)).toHaveLength(0);
  fireEvent.change(within(dialog).getByLabelText(/^증감 수량/), {
    target: { value: "-2" },
  });
  await user.click(within(dialog).getByRole("button", { name: "조정 확정" }));
  expect(await within(dialog).findByText("재고 조정 실패")).toBeVisible();
  const first = request.mock.calls.find(([, b]) => b !== undefined)!;
  change = async () => ({});
  await user.click(within(dialog).getByRole("button", { name: "조정 확정" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const calls = request.mock.calls.filter(([, b]) => b !== undefined);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(first);
  expect(first).toEqual([
    "/inventory/adjustments",
    {
      warehouseId: 1,
      productId: 1,
      delta: -2,
      reason: "실사 차이",
      requestKey: expect.any(String),
    },
  ]);
});
it("재고 검색·부족 필터·창고 선택을 서버 조건으로 반영한다", async () => {
  const user = mount(
    <Inventory user={{ username: "sales", roles: ["SALES"] }} />,
  );
  await screen.findByText("합성 상품");
  expect(
    screen.queryByRole("button", { name: "조정" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("SKU·상품명 검색"), "SKU{Enter}");
  await user.click(screen.getByLabelText("안전재고 미만만"));
  await user.click(screen.getByRole("combobox", { name: "창고 필터" }));
  await user.click(
    await screen.findByRole("option", { name: "W-1 · 본사 창고" }),
  );
  await waitFor(() =>
    expect(
      request.mock.calls.some(([p]) =>
        p.includes("/inventory?q=SKU&warehouse=1&low=true"),
      ),
    ).toBe(true),
  );
});
it("매출은 큰 정수 합계를 보존하고 기간·월별 조건 변경을 조회한다", async () => {
  const user = mount(<Reports />);
  expect(
    (await screen.findAllByText("9,007,199,254,741,000원")).length,
  ).toBeGreaterThan(0);
  expect(screen.getAllByText("3건").length).toBeGreaterThan(0);
  expect(screen.getByText("합성 고객사")).toBeVisible();
  fireEvent.change(screen.getByLabelText("시작일"), {
    target: { value: "2026-11-01" },
  });
  fireEvent.change(screen.getByLabelText("종료일"), {
    target: { value: "2026-11-30" },
  });
  await user.click(screen.getByRole("combobox", { name: "집계 단위" }));
  await user.click(screen.getByRole("option", { name: "월별" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/reports/sales?from=2026-11-01&to=2026-11-30&unit=month",
    ),
  );
});
it("거래 없는 기간에는 빈 매출 안내를 표시한다", async () => {
  request.mockResolvedValue({ periods: [], products: [], customers: [] });
  mount(<Reports />);
  expect(
    await screen.findByText("선택한 기간의 출고 매출이 없습니다."),
  ).toBeVisible();
  expect(screen.getByText("0원")).toBeVisible();
});
it("대시보드는 조회 값을 표시하고 역할에 맞는 업무 링크만 제공한다", async () => {
  mount(<Dashboard user={{ username: "purchase", roles: ["PURCHASE"] }} />);
  expect(await screen.findByText("10,000")).toBeVisible();
  const links = screen.getAllByRole("link", { name: "열기" });
  expect(links.map((x) => x.getAttribute("href"))).toEqual([
    "/inventory",
    "/purchases",
  ]);
});
it("계정 목록은 자기 잠금을 막고 다른 계정은 확인 후 잠근다", async () => {
  const user = mount(<Operations type="users" user={admin} />);
  await screen.findByText("member");
  const own = screen
    .getByText("admin", { selector: "div" })
    .closest('[role="row"]')!;
  expect(
    within(own as HTMLElement).getByRole("button", { name: "계정 잠금" }),
  ).toBeDisabled();
  const row = screen.getByText("member").closest('[role="row"]')!;
  await user.click(
    within(row as HTMLElement).getByRole("button", { name: "계정 잠금" }),
  );
  await user.click(
    within(screen.getByRole("dialog", { name: "계정 상태 변경" })).getByRole(
      "button",
      { name: "확정" },
    ),
  );
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "/users/2/status",
      { status: "LOCKED" },
      "PATCH",
    ),
  );
});
it("새 계정의 아이디·비밀번호·역할을 서버에 전달한다", async () => {
  const user = mount(<Operations type="users" user={admin} />);
  await user.click(screen.getByRole("button", { name: "사용자 생성" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText(/^아이디/), "new_sales");
  await user.type(
    within(dialog).getByLabelText(/^초기 비밀번호/),
    "test-password-only",
  );
  await user.click(within(dialog).getByRole("button", { name: "생성" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("/users", {
      username: "new_sales",
      password: "test-password-only",
      role: "SALES",
    }),
  );
  expect(await screen.findByText("사용자를 생성했습니다.")).toBeVisible();
});
it("입출고 통계는 변경한 날짜 범위로 조회한다", async () => {
  mount(<Operations type="flows" user={admin} />);
  await screen.findByText("2026-11-20");
  fireEvent.change(screen.getByLabelText("시작일"), {
    target: { value: "2026-11-01" },
  });
  await waitFor(() =>
    expect(
      request.mock.calls.some(([p]) =>
        p.startsWith("/reports/flows?from=2026-11-01"),
      ),
    ).toBe(true),
  );
});
