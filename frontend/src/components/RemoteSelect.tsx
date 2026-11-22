import { useState } from "react";
import { Autocomplete, TextField } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { api, type Page } from "../api";
type Option = {
  id: number;
  name: string;
  code?: string;
  sku?: string;
  active: boolean;
  price?: number;
};
export default function RemoteSelect({
  path,
  label,
  value,
  onChange,
  disabled = false,
}: {
  path: string;
  label: string;
  value: Option | null;
  onChange: (value: Option | null) => void;
  disabled?: boolean;
}) {
  const [input, setInput] = useState("");
  const q = useQuery({
    queryKey: ["select", path, input],
    queryFn: () =>
      api<Page<Option>>(path + "?size=50&q=" + encodeURIComponent(input)),
  });
  return (
    <Autocomplete
      fullWidth
      disabled={disabled}
      value={value}
      onChange={(_, v) => onChange(v)}
      inputValue={input}
      onInputChange={(_, v, reason) => {
        if (reason === "input") setInput(v);
        if (reason === "clear") setInput("");
      }}
      options={q.data?.items.filter((x) => x.active) || []}
      loading={q.isFetching}
      filterOptions={(x) => x}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      getOptionLabel={(o) => (o.sku || o.code) + " · " + o.name}
      renderInput={(p) => (
        <TextField
          {...p}
          label={label}
          error={!!q.error}
          helperText={
            q.error ? "조회 실패: 잠시 후 다시 입력해 주세요." : undefined
          }
        />
      )}
    />
  );
}
