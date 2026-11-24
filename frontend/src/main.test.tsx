import { act, screen, waitFor } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, expect, vi } from "vitest";
import { api, ApiError } from "./api";
vi.mock("react-dom/client", async (original) => {
  const actual = await original<typeof import("react-dom/client")>();
  return { ...actual, createRoot: vi.fn(actual.createRoot) };
});
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
}));
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  window.history.replaceState(null, "", "/");
});
it("실제 root에 StrictMode·Router·QueryClient·MUI 테마를 연결하고 세션 실패를 로그인으로 표시한다", async () => {
  vi.mocked(api).mockRejectedValue(
    new ApiError("세션 없음", 401, "UNAUTHORIZED"),
  );
  container = document.createElement("div");
  container.id = "root";
  document.body.appendChild(container);
  window.history.replaceState(null, "", "/inventory");
  try {
    await act(async () => {
      await import("./main");
    });
    root = vi.mocked(createRoot).mock.results[0].value as Root;
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(container);
    expect(await screen.findByRole("button", { name: "로그인" })).toBeVisible();
    expect(api).toHaveBeenCalledWith("/auth/me");
    await waitFor(() =>
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument(),
    );
    expect(
      window.getComputedStyle(screen.getByRole("button", { name: "로그인" }))
        .textTransform,
    ).toBe("none");
  } finally {
    root = vi.mocked(createRoot).mock.results[0]?.value as Root | undefined;
  }
});
