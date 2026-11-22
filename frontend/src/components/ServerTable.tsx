import {
  DataGrid,
  type GridColDef,
  type GridValidRowModel,
} from "@mui/x-data-grid";
import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api, type Page } from "../api";
import { ErrorNotice } from "./Common";
export default function ServerTable<T extends GridValidRowModel>({
  path,
  columns,
  params = "",
  rowId,
}: {
  path: string;
  columns: GridColDef<T>[];
  params?: string;
  rowId?: (row: T) => string | number;
}) {
  const [page, setPage] = useState({ page: 0, pageSize: 25 });
  const q = useQuery({
    queryKey: ["table", path, params, page],
    placeholderData: keepPreviousData,
    queryFn: () =>
      api<Page<T>>(
        path + "?" + params + "&page=" + page.page + "&size=" + page.pageSize,
      ),
  });
  return (
    <>
      <ErrorNotice error={q.error} />
      <DataGrid
        rows={q.data?.items || []}
        columns={columns}
        loading={q.isFetching}
        rowCount={q.data?.total ?? 0}
        paginationMode="server"
        paginationModel={page}
        onPaginationModelChange={setPage}
        pageSizeOptions={[25, 50, 100]}
        disableRowSelectionOnClick
        getRowId={rowId}
        sx={{ height: 570 }}
      />
    </>
  );
}
