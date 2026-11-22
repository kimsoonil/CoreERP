export type Role = "ADMIN" | "PURCHASE" | "WAREHOUSE" | "SALES";
export type User = { username: string; roles: Role[] };
export type Product = {
  id: number;
  sku: string;
  name: string;
  price: number;
  safetyStock: number;
  active: boolean;
};
export type Master = {
  id: number;
  code: string;
  name: string;
  active: boolean;
};
export type Inventory = {
  warehouseId: number;
  productId: number;
  warehouseName: string;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  safetyStock: number;
};
export type Document = {
  id: number;
  partnerId: number;
  partnerName: string;
  warehouseId: number;
  warehouseName: string;
  status: string;
  actor: string;
  createdAt: string;
};
export type Item = {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  processed: number;
  unitPrice: number;
};
export type Detail = {
  order: Document;
  items: Item[];
  shipmentId: number | null;
};
export type Page<T> = { items: T[]; total: number };
export type SalesDay = { period: string; amount: string; shipments: number };
export type ProductSales = {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  amount: string;
  rank: number;
};
export type CustomerSales = {
  customerId: number;
  name: string;
  quantity: number;
  amount: string;
};
export type SalesReport = {
  periods: SalesDay[];
  products: ProductSales[];
  customers: CustomerSales[];
};
let csrf: { token: string; header: string } | undefined;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}
export async function token() {
  const r = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  if (!r.ok) throw new Error("보안 토큰을 가져오지 못했습니다.");
  csrf = await r.json();
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  if (method !== "GET" && !csrf) await token();
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers[csrf!.header] = csrf!.token;
    headers["Content-Type"] = "application/json";
  }
  const r = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    if (r.status === 401) {
      csrf = undefined;
      window.dispatchEvent(new Event("session-expired"));
    }
    let e;
    try {
      e = await r.json();
    } catch {}
    throw new ApiError(
      e?.message || "요청을 처리하지 못했습니다.",
      r.status,
      e?.code || "HTTP_ERROR",
      e?.fieldErrors,
    );
  }
  if (r.status === 204 || r.headers.get("content-length") === "0")
    return undefined as T;
  const text = await r.text();
  return text ? JSON.parse(text) : (undefined as T);
}
export async function login(username: string, password: string) {
  await token();
  const r = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      [csrf!.header]: csrf!.token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ username, password }),
  });
  if (!r.ok) {
    const e = await r.json();
    throw new ApiError(e.message || "로그인 실패", r.status, e.code);
  }
  await token();
  return api<User>("/auth/me");
}
export const can = (user: User, ...roles: Role[]) =>
  user.roles.includes("ADMIN") || roles.some((r) => user.roles.includes(r));
export const money = (n: bigint | string | number) =>
  new Intl.NumberFormat("ko-KR").format(BigInt(n)) + "원";
export const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
export const kst = (s: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(s));
export const label = (s: string) =>
  ({
    DRAFT: "작성 중",
    APPROVED: "승인",
    PARTIAL: "부분 입고",
    RECEIVED: "입고 완료",
    RESERVED: "재고 예약",
    SHIPPED: "출고 완료",
    CANCELLED: "취소",
    CONFIRMED: "확정",
  })[s] || s;
