import { useState } from "react";
import { useForm } from "react-hook-form";
import { Box, Button, Paper, TextField, Typography } from "@mui/material";
import { login, type User } from "../api";
import { ErrorNotice } from "../components/Common";
export default function Login({ done }: { done: (u: User) => void }) {
  const {
      register,
      handleSubmit,
      formState: { isSubmitting },
    } = useForm<{ username: string; password: string }>(),
    [error, setError] = useState<unknown>(null);
  return (
    <main className="login">
      <section>
        <Typography variant="overline">CoreERP · ERP & SCM</Typography>
        <Typography
          variant="h3"
          sx={{ fontWeight: 700, my: 3, lineHeight: 1.45 }}
        >
          구매부터 출고까지,
          <br />
          업무의 흐름을 잇습니다.
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 4 }}>
          발주·입고·재고·판매를 한 작업공간에서 관리합니다.
        </Typography>
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="h6">업무 계정 로그인</Typography>
          <Box
            component="form"
            onSubmit={handleSubmit(async (values) => {
              try {
                done(await login(values.username, values.password));
              } catch (e) {
                setError(e);
              }
            })}
            sx={{ display: "grid", gap: 2, mt: 3 }}
          >
            <TextField
              label="아이디"
              autoComplete="username"
              {...register("username", { required: true })}
              required
            />
            <TextField
              label="비밀번호"
              type="password"
              autoComplete="current-password"
              {...register("password", { required: true })}
              required
            />
            <ErrorNotice error={error} />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={isSubmitting}
            >
              {isSubmitting ? "로그인 중…" : "로그인"}
            </Button>
          </Box>
        </Paper>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
          계정별 업무 권한이 적용됩니다. 공개 회원가입은 제공하지 않습니다.
        </Typography>
      </section>
      <aside>
        <span>OPERATIONS, CONNECTED.</span>
        <h2>
          발주를 확인하고
          <br />
          재고를 지키며
          <br />
          정확하게 출고합니다.
        </h2>
        <div className="process">
          <span>구매 발주</span>
          <span>부분 입고</span>
          <span>재고 예약</span>
          <span>출고 확정</span>
        </div>
      </aside>
    </main>
  );
}
