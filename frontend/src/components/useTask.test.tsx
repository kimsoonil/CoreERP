import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { useTask, useRequestKey } from "./useTask";
it("동일 입력 재시도에는 키를 유지하고 입력 변경·성공 후 초기화에는 새 키를 만든다", () => {
  const { result } = renderHook(() => useRequestKey());
  const first = result.current.key({ quantity: 2 });
  expect(result.current.key({ quantity: 2 })).toBe(first);
  const changed = result.current.key({ quantity: 3 });
  expect(changed).not.toBe(first);
  result.current.reset();
  expect(result.current.key({ quantity: 3 })).not.toBe(changed);
});
it("업무 실패 시 성공 표시를 하지 않고 재시도 성공 후 조회 캐시를 갱신한다", async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result, unmount } = renderHook(() => useTask(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  try {
    await act(() =>
      result.current.run(async () => {
        throw new Error("실패");
      }),
    );
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toEqual(new Error("실패"));
    expect(result.current.message).toBe("");
    expect(invalidate).not.toHaveBeenCalled();
    await act(() => result.current.run(async () => {}, "입고 완료"));
    await waitFor(() => expect(result.current.message).toBe("입고 완료"));
    expect(result.current.error).toBeNull();
    expect(invalidate).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    client.clear();
  }
});
