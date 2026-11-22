import { test, expect } from "@playwright/test";
function yesterday() {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
test("일별 집계 실행·원본 대조·중복 실행 건너뛰기", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "아이디", exact: true })
    .fill("admin");
  await page.getByLabel(/^비밀번호/).fill(process.env.APP_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.getByRole("link", { name: "일별 집계 배치", exact: true }).click();
  const date = yesterday();
  await page.getByLabel(/집계 기준일/).fill(date);
  await page.getByRole("button", { name: "집계 실행", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /집계 완료|변경 없음/ }),
  ).toBeVisible();
  const detailResponse = await page.request.get(
    "/api/batches/daily/summaries/" + date,
  );
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await detailResponse.json();
  const rawResponse = await page.request.get(
    "/api/reports/sales?from=" + date + "&to=" + date + "&unit=day",
  );
  expect(rawResponse.ok()).toBeTruthy();
  const raw = await rawResponse.json();
  expect(detail.summary.salesAmount).toBe(raw.periods[0]?.amount || "0");
  expect(detail.summary.stale).toBe(false);
  await page.getByRole("button", { name: "집계 실행", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "변경 없음" }),
  ).toBeVisible();
  const same = await (
    await page.request.get("/api/batches/daily/summaries/" + date)
  ).json();
  expect(same.summary.runId).toBe(detail.summary.runId);
  await page
    .getByRole("button", { name: date + " 집계 상세", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: date + " 집계 상세", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByText("조회 시점 최신", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.screenshot({
    path: "test-results/coreerp-daily-batch.png",
    fullPage: true,
  });
});
