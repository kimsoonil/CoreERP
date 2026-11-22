import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, name = "admin") {
  await page.goto("/");
  await page.getByRole("textbox", { name: "아이디", exact: true }).fill(name);
  await page
    .getByLabel(/^비밀번호/)
    .fill(
      name === "admin"
        ? process.env.APP_ADMIN_PASSWORD!
        : process.env.APP_DEMO_PASSWORD!,
    );
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "업무 현황", exact: true }),
  ).toBeVisible();
}
async function choose(
  page: Page,
  label: string,
  text: string,
  search?: string,
) {
  const field = page.getByRole("combobox", { name: label, exact: true });
  await field.click();
  if (search) await field.fill(search);
  await page.getByRole("option", { name: text, exact: true }).click();
}
test("상품 등록 → 발주 승인 → 두 차례 부분 입고 → 판매 예약 → 출고 → 출고 취소", async ({
  page,
}) => {
  const sku = "E2E-" + Date.now(),
    name = "브라우저 검증 부품";
  await login(page);
  await page.getByRole("link", { name: "상품 관리", exact: true }).click();
  await page.getByRole("button", { name: "등록", exact: true }).click();
  await page.getByRole("textbox", { name: "SKU", exact: true }).fill(sku);
  await page.getByRole("textbox", { name: "이름", exact: true }).fill(name);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "발주·입고", exact: true }).click();
  await page.getByRole("button", { name: "발주서 생성", exact: true }).click();
  await choose(page, "대상 창고", "WH-1 · 합성 창고 1");
  await choose(page, "공급업체 선택", "SUP-001 · 합성 공급사 1");
  await choose(page, "추가할 상품 검색", sku + " · " + name, sku);
  await page.getByRole("button", { name: "품목 추가", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: name + " 수량", exact: true })
    .fill("10");
  await page.getByRole("button", { name: "발주 저장", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("작성 중", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "발주 승인", exact: true }).click();
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: name + " 입고 수량", exact: true })
    .fill("4");
  await page.getByRole("button", { name: "입고 확정", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("부분 입고", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: name + " 입고 수량", exact: true })
    .fill("6");
  await page.getByRole("button", { name: "입고 확정", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("입고 완료", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("link", { name: "판매·출고", exact: true }).click();
  await page
    .getByRole("button", { name: "판매 주문 등록", exact: true })
    .click();
  await choose(page, "대상 창고", "WH-1 · 합성 창고 1");
  await choose(page, "고객사 선택", "CUS-001 · 합성 고객사 1");
  await choose(page, "추가할 상품 검색", sku + " · " + name, sku);
  await page.getByRole("button", { name: "품목 추가", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: name + " 수량", exact: true })
    .fill("3");
  await page.getByRole("button", { name: "주문 예약", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("재고 예약", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "출고 확정", exact: true }).click();
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("출고 완료", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/coreerp-shipment.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "출고 취소", exact: true }).click();
  await page.getByRole("button", { name: "확정", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByText("취소", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("link", { name: "창고 재고", exact: true }).click();
  await page.getByLabel("SKU·상품명 검색", { exact: true }).fill(sku);
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: sku })
      .getByRole("gridcell", { name: "10", exact: true }),
  ).toHaveCount(2);
  await page.getByRole("link", { name: "매출 분석", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "기간별 매출", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/coreerp-sales.png",
    fullPage: true,
  });
  await page.getByRole("link", {name:"발주·입출고 통계",exact:true}).click();
  await expect(page.getByRole("columnheader", {name:"발주 건수",exact:true})).toBeVisible();
  const period=new Date().toISOString().slice(0,10);
  expect((await page.request.get("/api/reports/flows?from="+period+"&to="+period)).status()).toBe(200);
});
test("창고 담당자의 메뉴와 API 권한·모바일 레이아웃", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "warehouse");
  await expect(
    page.getByRole("link", { name: "사용자 관리", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "발주·입고", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "발주서 생성", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/users")).status()).toBe(403);
  await page.screenshot({
    path: "test-results/coreerp-mobile.png",
    fullPage: true,
  });
});
test("상품 1만 건을 서버 페이지로 탐색하고 검색한다", async ({ page }) => {
  await login(page);
  await page.getByRole("link", { name: "상품 관리", exact: true }).click();
  await expect(
    page.getByRole("gridcell", { name: "SKU-00001", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Go to next page" }).click();
  await expect(
    page.getByRole("gridcell", { name: "SKU-00026", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("코드 또는 이름 검색", { exact: true })
    .fill("SKU-09999");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(
    page.getByRole("gridcell", { name: "SKU-09999", exact: true }),
  ).toBeVisible();
});
