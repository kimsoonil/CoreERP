import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Box, Paper, Typography, Button, Stack } from "@mui/material";
import { api, can, type User } from "../api";
import { Heading, ErrorNotice } from "../components/Common";
export default function Dashboard({ user }: { user: User }) {
  const q = useQuery({
    queryKey: ["overview"],
    queryFn: () =>
      api<{ products: number; lowStock: number; reserved: number }>(
        "/overview",
      ),
  });
  return (
    <>
      <Heading
        title="업무 현황"
        description="발주부터 입고·재고·출고까지 오늘의 운영 상태를 확인하세요."
      />
      <ErrorNotice error={q.error} />
      <Box className="metric-grid">
        {[
          ["사용 중인 상품", q.data?.products, "종"],
          ["안전재고 부족", q.data?.lowStock, "건"],
          ["출고 대기 예약", q.data?.reserved, "개"],
        ].map(([name, n, unit]) => (
          <Paper key={name} variant="outlined" sx={{ p: 3 }}>
            <Typography color="text.secondary">{name}</Typography>
            <Typography variant="h4" sx={{ mt: 2 }}>
              {n === undefined ? "—" : Number(n).toLocaleString()}
              <Typography component="span" sx={{ ml: 1 }}>
                {unit}
              </Typography>
            </Typography>
          </Paper>
        ))}
      </Box>
      <Paper variant="outlined" className="flow-panel" sx={{ my: 3, p: 4 }}>
        <Typography variant="overline">CONNECTED OPERATIONS</Typography>
        <Typography variant="h5" sx={{ fontWeight: 700, my: 2 }}>
          문서와 재고를 함께 확인합니다.
        </Typography>
        <Typography color="text.secondary">
          발주 승인 후 필요한 수량만 입고하고, 주문한 재고를 예약한 뒤
          출고합니다.
          <br />
          모든 재고 변경은 이력으로 남습니다.
        </Typography>
        <div className="flow-steps">
          <span>구매 발주</span>
          <span>승인·부분 입고</span>
          <span>주문·재고 예약</span>
          <span>출고 확정</span>
        </div>
      </Paper>
      <Box className="two-grid">
        {[
          {
            title: "창고별 재고",
            text: "현재고·예약·가용 재고와 안전재고 부족을 확인합니다.",
            path: "/inventory",
            visible: true,
          },
          {
            title: "발주·입고",
            text: "발주서를 확인하고 품목별로 입고 수량을 확정합니다.",
            path: "/purchases",
            visible: can(user, "PURCHASE", "WAREHOUSE"),
          },
          {
            title: "판매·출고",
            text: "주문을 등록하고 예약 재고를 출고합니다.",
            path: "/sales",
            visible: can(user, "SALES", "WAREHOUSE"),
          },
          {
            title: "매출 분석",
            text: "기간·상품·고객사별 출고 매출을 확인합니다.",
            path: "/reports",
            visible: can(user, "SALES"),
          },
        ]
          .filter((x) => x.visible)
          .map((x) => (
            <Paper key={x.path} variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6">{x.title}</Typography>
              <Typography color="text.secondary" sx={{ my: 2 }}>
                {x.text}
              </Typography>
              <Button component={Link} to={x.path} variant="outlined">
                열기
              </Button>
            </Paper>
          ))}
      </Box>
    </>
  );
}
