import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { api, ApiError, previousDate } from "../api";
import DailyBatch from "./DailyBatch";
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  api: vi.fn(),
}));
const request = vi.mocked(api);
let client: QueryClient;
let execute: () => Promise<unknown>;
let summaries: unknown[];
let detail: () => Promise<unknown>;
const date = previousDate();
function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  summaries = [];
  execute = async () => ({
    runId: "test-run",
    businessDate: date,
    status: "SUCCEEDED",
    sourceVersion: 1,
  });
  detail = async () => ({});
  request.mockReset();
  request.mockImplementation(async (path, body) => {
    if (body !== undefined) return execute();
    if (path.includes("/runs?")) return { items: [], total: 0 };
    if (path.includes("/summaries?")) return summaries;
    return detail();
  });
});
afterEach(() => client.clear());
function mount() {
  render(
    <QueryClientProvider client={client}>
      <DailyBatch />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("빈 결과 안내와 한국 시간 기준 어제의 실행 날짜를 표시한다", async () => {
  mount();
  expect(await screen.findByText(/아직 집계하지 않은 날짜/)).toBeVisible();
  expect(screen.getByLabelText(/집계 기준일/)).toHaveValue(date);
});
it("실행 대기 중 버튼을 잠가 연속 클릭으로 같은 작업을 보내지 않는다", async () => {
  const deferred = pending<unknown>();
  execute = () => deferred.promise;
  const user = mount();
  const button = screen.getByRole("button", { name: "집계 실행" });
  await user.click(button);
  expect(screen.getByRole("button", { name: "집계 중…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "집계 중…" }));
  expect(
    request.mock.calls.filter(([, body]) => body !== undefined),
  ).toHaveLength(1);
  deferred.resolve({
    runId: "test-run",
    businessDate: date,
    status: "SUCCEEDED",
    sourceVersion: 1,
  });
  expect(await screen.findByRole("status")).toHaveTextContent("집계 완료");
  expect(screen.getByRole("button", { name: "집계 실행" })).toBeEnabled();
  expect(request).toHaveBeenCalledWith("/batches/daily", {
    businessDate: date,
  });
});
it("SKIPPED 응답은 새 집계 완료로 표시하지 않는다", async () => {
  execute = async () => ({
    runId: "skip-run",
    businessDate: date,
    status: "SKIPPED",
    sourceVersion: 1,
  });
  const user = mount();
  await user.click(screen.getByRole("button", { name: "집계 실행" }));
  expect(await screen.findByRole("status")).toHaveTextContent("변경 없음");
  expect(screen.getByRole("status")).not.toHaveTextContent("집계 완료");
});
it("실패 메시지를 보존하고 이력을 새로 조회한 뒤 같은 날짜를 재시도한다", async () => {
  execute = async () => {
    throw new ApiError("이전 결과를 유지합니다.", 500, "BATCH_FAILED");
  };
  const user = mount();
  await screen.findByText(/아직 집계하지 않은 날짜/);
  const before = request.mock.calls.filter(([p]) =>
    p.includes("/runs?"),
  ).length;
  await user.click(screen.getByRole("button", { name: "집계 실행" }));
  expect(await screen.findByText("이전 결과를 유지합니다.")).toBeVisible();
  await waitFor(() =>
    expect(
      request.mock.calls.filter(([p]) => p.includes("/runs?")).length,
    ).toBeGreaterThan(before),
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  execute = async () => ({
    runId: "retried",
    businessDate: date,
    status: "SUCCEEDED",
    sourceVersion: 2,
  });
  await user.click(screen.getByRole("button", { name: "집계 실행" }));
  expect(await screen.findByRole("status")).toHaveTextContent("retried");
  expect(screen.queryByText("이전 결과를 유지합니다.")).not.toBeInTheDocument();
});
it("집계 조회 오류를 빈 결과나 성공으로 오인하지 않도록 표시한다", async () => {
  request.mockImplementation(async (path) => {
    if (path.includes("/summaries?"))
      throw new ApiError("조회 권한이 없습니다.", 403, "FORBIDDEN");
    return { items: [], total: 0 };
  });
  mount();
  expect(await screen.findByText("조회 권한이 없습니다.")).toBeVisible();
  expect(screen.queryByText(/아직 집계하지 않은 날짜/)).not.toBeInTheDocument();
});
it("재집계가 필요한 상세에 상품·고객사 금액을 표시하고 닫는다", async () => {
  const summary = {
    businessDate: date,
    sourceVersion: 1,
    currentSourceVersion: 2,
    runId: "old",
    calculatedAt: "2026-11-20T00:00:00Z",
    salesAmount: "9000",
    salesShipments: 1,
    shippedQuantity: 3,
    purchases: 1,
    orderedQuantity: 5,
    receipts: 1,
    receiptQuantity: 5,
    stale: true,
  };
  summaries = [summary];
  detail = async () => ({
    summary,
    products: [
      {
        productId: 1,
        sku: "TEST",
        name: "테스트 상품",
        quantity: 3,
        amount: "9000",
        rank: 1,
      },
    ],
    customers: [
      { customerId: 1, name: "테스트 고객사", quantity: 3, amount: "9000" },
    ],
  });
  const user = mount();
  await user.click(
    await screen.findByRole("button", { name: date + " 집계 상세" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("테스트 상품")).toBeVisible();
  expect(within(dialog).getByText("테스트 고객사")).toBeVisible();
  expect(within(dialog).getByText("재집계 필요")).toBeVisible();
  expect(within(dialog).getAllByText("9,000원")).toHaveLength(2);
  await user.click(within(dialog).getByRole("button", { name: "닫기" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
