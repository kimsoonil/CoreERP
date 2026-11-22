import { describe, it, expect } from "vitest";
import { can, money, label, previousDate } from "./api";
describe("권한과 금액 표현", () => {
  it("관리자는 모든 메뉴를 열고 구매 담당자는 판매 메뉴를 열지 않는다", () => {
    expect(can({ username: "admin", roles: ["ADMIN"] }, "SALES")).toBe(true);
    expect(can({ username: "purchase", roles: ["PURCHASE"] }, "SALES")).toBe(
      false,
    );
    expect(
      can({ username: "warehouse", roles: ["WAREHOUSE"] }, "WAREHOUSE"),
    ).toBe(true);
  });
  it("큰 정수 금액을 손실 없이 표시한다", () => {
    expect(money("9007199254740993")).toBe("9,007,199,254,740,993원");
  });
  it("업무 상태를 설명한다", () => {
    expect(label("PARTIAL")).toBe("부분 입고");
  });
});

it("집계 기준일의 월·연도·윤년 경계를 계산한다",()=>{expect(previousDate("2026-01-01")).toBe("2025-12-31");expect(previousDate("2024-03-01")).toBe("2024-02-29");});
