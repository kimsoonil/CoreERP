import { useEffect, useState, lazy, Suspense } from "react";
import { Routes, Route, NavLink, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Box, Button, Typography, Alert } from "@mui/material";
import {
  Inventory2Outlined,
  WarehouseOutlined,
  ShoppingCartOutlined,
  LocalShippingOutlined,
  AssessmentOutlined,
  GroupsOutlined,
  ReceiptLongOutlined,
  DashboardOutlined,
} from "@mui/icons-material";
import { api, can, type User, type Role, today } from "./api";
import Login from "./features/Login";
import { Loading } from "./components/Common";

const Masters = lazy(() => import("./features/Masters"));
const Inventory = lazy(() => import("./features/Inventory"));
const Documents = lazy(() => import("./features/Documents"));
const Dashboard = lazy(() => import("./features/Dashboard"));
const Reports = lazy(() => import("./features/Reports"));
const DailyBatch = lazy(() => import("./features/DailyBatch"));
const Operations = lazy(() => import("./features/Operations"));
const menu = [
  { path: "/", name: "업무 현황", icon: DashboardOutlined, roles: [] },
  { path: "/products", name: "상품 관리", icon: Inventory2Outlined, roles: [] },
  { path: "/inventory", name: "창고 재고", icon: WarehouseOutlined, roles: [] },
  {
    path: "/suppliers",
    name: "공급업체",
    icon: GroupsOutlined,
    roles: ["PURCHASE", "WAREHOUSE"],
  },
  {
    path: "/customers",
    name: "고객사",
    icon: GroupsOutlined,
    roles: ["SALES", "WAREHOUSE"],
  },
  {
    path: "/warehouses",
    name: "창고 관리",
    icon: WarehouseOutlined,
    roles: [],
  },
  {
    path: "/purchases",
    name: "발주·입고",
    icon: ShoppingCartOutlined,
    roles: ["PURCHASE", "WAREHOUSE"],
  },
  {
    path: "/sales",
    name: "판매·출고",
    icon: LocalShippingOutlined,
    roles: ["SALES", "WAREHOUSE"],
  },
  {
    path: "/reports",
    name: "매출 분석",
    icon: AssessmentOutlined,
    roles: ["SALES"],
  },
  {
    path: "/flows",
    name: "발주·입출고 통계",
    icon: AssessmentOutlined,
    roles: ["PURCHASE", "WAREHOUSE"],
  },
  {
    path: "/movements",
    name: "재고 이력",
    icon: ReceiptLongOutlined,
    roles: ["WAREHOUSE"],
  },
  {
    path: "/audits",
    name: "감사 로그",
    icon: ReceiptLongOutlined,
    roles: ["ADMIN"],
  },
  { path: "/batches", name: "일별 집계 배치", icon: ReceiptLongOutlined, roles: ["ADMIN"] },
  {
    path: "/users",
    name: "사용자 관리",
    icon: GroupsOutlined,
    roles: ["ADMIN"],
  },
];
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [logoutError, setLogoutError] = useState(""),
    client = useQueryClient();
  useEffect(() => {
    api<User>("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setReady(true));
    const expire = () => {
      setUser(null);
      client.clear();
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, [client]);
  if (!ready) return <Loading />;
  if (!user)
    return (
      <Login
        done={(u) => {
          client.clear();
          setUser(u);
        }}
      />
    );
  const allowed = (path: string) => {
    const m = menu.find((m) => m.path === path);
    return !m?.roles.length || can(user, ...(m.roles as Role[]));
  };
  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          CoreERP<small>ERP · SCM 통합관리</small>
        </NavLink>
        <p className="menu-label">WORKSPACE</p>
        <nav aria-label="주 메뉴">
          {menu
            .filter((m) => !m.roles.length || can(user, ...(m.roles as Role[])))
            .map((m) => (
              <NavLink key={m.path} to={m.path} end>
                <m.icon fontSize="small" />
                {m.name}
              </NavLink>
            ))}
        </nav>
        <div className="account">
          <strong>{user.username}</strong>
          <small>{user.roles.join(" · ")}</small>
          <Button
            color="inherit"
            size="small"
            onClick={async () => {
              try {
                await api("/auth/logout", {});
                client.clear();
                setUser(null);
              } catch (e) {
                setLogoutError((e as Error).message);
              }
            }}
          >
            로그아웃
          </Button>
        </div>
      </aside>
      <main className="content">
        <header className="topbar">
          <span>통합 업무관리</span>
          <span>{today()} · KST</span>
        </header>
        {logoutError && <Alert severity="error">{logoutError}</Alert>}
        <Suspense fallback={<Loading />}>
          <Routes><Route path="/batches" element={allowed("/batches")?<DailyBatch/>:<Alert severity="error">접근 권한이 없습니다.</Alert>}/>
            <Route path="/" element={<Dashboard user={user} />} />
            {["products", "suppliers", "customers", "warehouses"].map(
              (type) => (
                <Route
                  key={type}
                  path={"/" + type}
                  element={
                    allowed("/" + type) ? (
                      <Masters
                        key={type}
                        type={
                          type as
                            | "products"
                            | "suppliers"
                            | "customers"
                            | "warehouses"
                        }
                        user={user}
                      />
                    ) : (
                      <Alert severity="error">접근 권한이 없습니다.</Alert>
                    )
                  }
                />
              ),
            )}
            <Route path="/inventory" element={<Inventory user={user} />} />
            {["purchases", "sales"].map((type) => (
              <Route
                key={type}
                path={"/" + type}
                element={
                  allowed("/" + type) ? (
                    <Documents
                      key={type}
                      type={type as "purchases" | "sales"}
                      user={user}
                    />
                  ) : (
                    <Alert severity="error">접근 권한이 없습니다.</Alert>
                  )
                }
              />
            ))}
            <Route
              path="/reports"
              element={
                allowed("/reports") ? (
                  <Reports />
                ) : (
                  <Alert severity="error">접근 권한이 없습니다.</Alert>
                )
              }
            />
            {["flows", "movements", "audits", "users"].map((type) => (
              <Route
                key={type}
                path={"/" + type}
                element={
                  allowed("/" + type) ? (
                    <Operations
                      key={type}
                      type={type as "flows" | "movements" | "audits" | "users"}
                      user={user}
                    />
                  ) : (
                    <Alert severity="error">접근 권한이 없습니다.</Alert>
                  )
                }
              />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <Box
          component="footer"
          sx={{ mt: 5, color: "text.secondary", fontSize: 12 }}
        >
          CoreERP · 개인 개발 프로젝트 · 업무 데이터는 합성 예시입니다.
        </Box>
      </main>
    </div>
  );
}
