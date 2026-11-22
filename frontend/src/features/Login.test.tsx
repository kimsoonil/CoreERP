import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi, beforeEach } from "vitest";
import { login, ApiError } from "../api";
import Login from "./Login";
vi.mock("../api", async (original) => ({
  ...(await original<typeof import("../api")>()),
  login: vi.fn(),
}));
const signIn = vi.mocked(login);
beforeEach(() => signIn.mockReset());
it("빈 로그인 입력은 인증 요청을 보내지 않는다", async () => {
  const done = vi.fn();
  render(<Login done={done} />);
  await userEvent.click(screen.getByRole("button", { name: "로그인" }));
  expect(signIn).not.toHaveBeenCalled();
  expect(done).not.toHaveBeenCalled();
});
it("인증 실패는 표시하고 수정한 입력으로 다시 로그인할 수 있다", async () => {
  const done = vi.fn();
  signIn
    .mockRejectedValueOnce(
      new ApiError("인증 정보가 잘못되었습니다.", 401, "UNAUTHORIZED"),
    )
    .mockResolvedValueOnce({ username: "sales", roles: ["SALES"] });
  render(<Login done={done} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/아이디/), "sales");
  await user.type(screen.getByLabelText(/^비밀번호/), "wrong");
  await user.click(screen.getByRole("button", { name: "로그인" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("인증 정보");
  expect(done).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText(/^비밀번호/));
  await user.type(screen.getByLabelText(/^비밀번호/), "correct");
  await user.click(screen.getByRole("button", { name: "로그인" }));
  await waitFor(() =>
    expect(done).toHaveBeenCalledWith({ username: "sales", roles: ["SALES"] }),
  );
  expect(signIn).toHaveBeenLastCalledWith("sales", "correct");
});
it("로그인 응답을 기다리는 동안 재전송 버튼을 잠근다", async () => {
  let resolve!: (u: { username: string; roles: ["ADMIN"] }) => void;
  signIn.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const done = vi.fn();
  render(<Login done={done} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/아이디/), "admin");
  await user.type(screen.getByLabelText(/^비밀번호/), "test-only");
  await user.click(screen.getByRole("button", { name: "로그인" }));
  expect(screen.getByRole("button", { name: "로그인 중…" })).toBeDisabled();
  resolve({ username: "admin", roles: ["ADMIN"] });
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
});
