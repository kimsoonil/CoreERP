import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";
import App from "./App";
import "./style.css";
const theme = createTheme({
  palette: {
    primary: { main: "#174e67" },
    secondary: { main: "#247958" },
    background: { default: "#f3f5f8" },
  },
  typography: {
    fontFamily: '"Noto Sans KR",system-ui,sans-serif',
    h4: { fontWeight: 700, letterSpacing: "-.04em" },
    h6: { fontWeight: 700 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: "none" } },
    },
    MuiDataGrid: {
      styleOverrides: {
        root: {
          background: "#fff",
          border: "1px solid #e0e6ec",
          fontSize: "0.875rem",
        },
        columnHeader: { background: "#f5f7fa" },
      },
    },
  },
} as Parameters<typeof createTheme>[0]);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
