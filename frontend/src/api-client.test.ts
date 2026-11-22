import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
describe("HTTP 세션·CSRF 계약", () => {
  it("읽기 요청은 CSRF 발급 없이 같은 출처 세션을 사용한다", async () => {
    fetchMock.mockResolvedValueOnce(json({ items: [], total: 0 }));
    const { api } = await import("./api");
    expect(await api("/products")).toEqual({ items: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        body: undefined,
      }),
    );
  });
  it("변경 요청에는 발급받은 CSRF와 JSON 본문을 보내고 다음 요청에서 재사용한다", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ token: "test-token", header: "X-CSRF-TOKEN" }),
      )
      .mockResolvedValueOnce(json({ id: 1 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { api } = await import("./api");
    await api("/products", { sku: "S-1" });
    expect(await api("/products/1", undefined, "DELETE")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/products",
      expect.objectContaining({
        method: "POST",
        headers: {
          "X-CSRF-TOKEN": "test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sku: "S-1" }),
      }),
    ]);
    expect(fetchMock.mock.calls[2][1].headers["X-CSRF-TOKEN"]).toBe(
      "test-token",
    );
  });
  it("401은 세션 만료를 알리고 다음 변경 요청에 새 토큰을 발급한다", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ token: "old", header: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(
        json({ message: "만료", code: "UNAUTHORIZED" }, 401),
      )
      .mockResolvedValueOnce(json({ token: "new", header: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(json({ id: 2 }));
    const listener = vi.fn();
    window.addEventListener("session-expired", listener);
    try {
      const { api } = await import("./api");
      await expect(api("/products", {})).rejects.toMatchObject({
        status: 401,
        code: "UNAUTHORIZED",
      });
      expect(listener).toHaveBeenCalledTimes(1);
      await api("/products", {});
      expect(fetchMock.mock.calls[3][1].headers["X-CSRF-TOKEN"]).toBe("new");
    } finally {
      window.removeEventListener("session-expired", listener);
    }
  });
  it("업무 오류의 코드와 필드 오류를 보존한다", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          message: "수량 초과",
          code: "BUSINESS_CONFLICT",
          fieldErrors: { quantity: "재고 부족" },
        },
        409,
      ),
    );
    const { api } = await import("./api");
    await expect(api("/orders")).rejects.toMatchObject({
      message: "수량 초과",
      status: 409,
      code: "BUSINESS_CONFLICT",
      fieldErrors: { quantity: "재고 부족" },
    });
  });
  it("JSON이 아닌 서버 오류도 사용자용 오류로 변환한다", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>upstream error</html>", { status: 502 }),
    );
    const { api } = await import("./api");
    await expect(api("/orders")).rejects.toMatchObject({
      message: "요청을 처리하지 못했습니다.",
      status: 502,
      code: "HTTP_ERROR",
    });
  });
  it("CSRF 발급 실패 시 변경 API를 호출하지 않는다", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503));
    const { api } = await import("./api");
    await expect(api("/orders", {})).rejects.toThrow("보안 토큰");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("로그인 후 토큰을 갱신하고 서버 사용자 정보를 반환한다", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ token: "before", header: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ token: "after", header: "X-CSRF-TOKEN" }))
      .mockResolvedValueOnce(json({ username: "admin", roles: ["ADMIN"] }));
    const { login } = await import("./api");
    expect(await login("admin", "test only & +")).toEqual({
      username: "admin",
      roles: ["ADMIN"],
    });
    const loginRequest = fetchMock.mock.calls[1][1];
    expect(loginRequest.headers["X-CSRF-TOKEN"]).toBe("before");
    expect(new URLSearchParams(loginRequest.body).get("password")).toBe(
      "test only & +",
    );
    expect(fetchMock.mock.calls[2][0]).toBe("/api/auth/csrf");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/auth/me");
  });
});
