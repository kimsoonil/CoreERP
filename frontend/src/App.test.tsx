import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { api, login, ApiError, type User } from "./api";
import App from "./App";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
  login: vi.fn(),
}));
const request = vi.mocked(api),
  signIn = vi.mocked(login);
let client: QueryClient;
let current: User;
let session: () => Promise<User>;
let logout: () => Promise<unknown>;
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  current = { username: "admin", roles: ["ADMIN"] };
  session = async () => current;
  logout = async () => undefined;
  signIn.mockReset();
  request.mockReset();
  request.mockImplementation(async (path) => {
    if (path === "/auth/me") return session();
    if (path === "/auth/logout") return logout();
    if (path === "/overview") return { products: 10, lowStock: 1, reserved: 2 };
    if (
      path === "/users" ||
      path.startsWith("/batches/daily/summaries?") ||
      path.startsWith("/reports/flows?")
    )
      return [];
    if (path.startsWith("/reports/sales?"))
      return { periods: [], products: [], customers: [] };
    return { items: [], total: 0 };
  });
});
afterEach(() => client.clear());
function mount(path = "/") {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("세션 조회가 끝날 때까지 로그인·업무 화면을 노출하지 않는다", async () => {
  let reject!: (e: Error) => void;
  session = () =>
    new Promise((_, r) => {
      reject = r;
    });
  mount();
  expect(screen.getByRole("progressbar")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "로그인" }),
  ).not.toBeInTheDocument();
  await act(async () => reject(new ApiError("만료", 401, "UNAUTHORIZED")));
  expect(await screen.findByRole("button", { name: "로그인" })).toBeVisible();
});
it("로그인 성공 시 이전 계정 캐시를 비우고 업무 화면으로 전환한다", async () => {
  session = async () => {
    throw new ApiError("세션 없음", 401, "UNAUTHORIZED");
  };
  signIn.mockResolvedValue({ username: "sales", roles: ["SALES"] });
  client.setQueryData(["private-old"], { secret: "test fixture" });
  mount();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText(/아이디/), "sales");
  await user.type(screen.getByLabelText(/^비밀번호/), "test-password");
  await user.click(screen.getByRole("button", { name: "로그인" }));
  expect(
    await screen.findByRole("navigation", { name: "주 메뉴" }),
  ).toBeVisible();
  expect(client.getQueryData(["private-old"])).toBeUndefined();
  expect(screen.getByText("sales", { selector: "strong" })).toBeVisible();
});
it.each(["/users", "/purchases", "/batches", "/suppliers"])(
  "판매 역할의 직접 URL %s 접근을 막고 메뉴에서도 숨긴다",
  async (path) => {
    current = { username: "sales", roles: ["SALES"] };
    mount(path);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "접근 권한이 없습니다.",
    );
    const menu = screen.getByRole("navigation", { name: "주 메뉴" });
    expect(menu.querySelector(`a[href="${path}"]`)).toBeNull();
    expect(request.mock.calls.some(([p]) => p.startsWith(path + "?"))).toBe(
      false,
    );
  },
);
it("관리자는 직접 발주 URL에서 진입하고 메뉴로 사용자·배치 화면을 이동한다", async () => {
  mount("/purchases");
  expect(
    await screen.findByRole("button", { name: "발주서 생성" }),
  ).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getByRole("link", { name: "사용자 관리" }));
  expect(
    await screen.findByRole("button", { name: "사용자 생성" }),
  ).toBeVisible();
  await user.click(screen.getByRole("link", { name: "일별 집계 배치" }));
  expect(
    await screen.findByRole("button", { name: "집계 실행" }),
  ).toBeVisible();
});
it("세션 만료 이벤트는 개인 캐시와 업무 화면을 제거하며 해제 시 리스너도 정리한다", async () => {
  const removed = vi.spyOn(window, "removeEventListener");
  const { unmount } = mount();
  await screen.findByRole("navigation", { name: "주 메뉴" });
  client.setQueryData(["private-session"], 123);
  act(() => window.dispatchEvent(new Event("session-expired")));
  expect(await screen.findByRole("button", { name: "로그인" })).toBeVisible();
  expect(client.getQueryData(["private-session"])).toBeUndefined();
  expect(
    screen.queryByRole("navigation", { name: "주 메뉴" }),
  ).not.toBeInTheDocument();
  unmount();
  expect(removed).toHaveBeenCalledWith("session-expired", expect.any(Function));
  removed.mockRestore();
});
it("로그아웃 실패 시 세션을 유지하고 성공 재시도 후 캐시와 세션을 비운다", async () => {
  logout = async () => {
    throw new Error("로그아웃 실패");
  };
  mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "로그아웃" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("로그아웃 실패");
  expect(screen.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  client.setQueryData(["private-logout"], 123);
  logout = async () => undefined;
  await user.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(await screen.findByRole("button", { name: "로그인" })).toBeVisible();
  expect(client.getQueryData(["private-logout"])).toBeUndefined();
  expect(request).toHaveBeenCalledWith("/auth/logout", {});
});
it("알 수 없는 경로는 업무 현황으로 이동하고 상품·재고·보고서·이력 메뉴를 연다", async () => {
  mount("/unknown-route");
  expect(
    await screen.findByText("문서와 재고를 함께 확인합니다."),
  ).toBeVisible();
  const user = userEvent.setup();
  for (const [menu, heading] of [
    ["상품 관리", "상품 관리"],
    ["창고 재고", "창고 재고"],
    ["매출 분석", "매출 분석"],
    ["재고 이력", "재고 이력"],
  ]) {
    await user.click(screen.getByRole("link", { name: menu }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: heading })).toBeVisible(),
    );
  }
});
