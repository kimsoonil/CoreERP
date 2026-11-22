import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { label } from "../api";
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? (
    <Alert severity="error" role="alert" sx={{ my: 2 }}>
      {error instanceof Error ? error.message : String(error)}
    </Alert>
  ) : null;
}
export function Loading() {
  return (
    <Stack alignItems="center" sx={{ p: 5 }}>
      <CircularProgress size={28} />
    </Stack>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <Chip
      size="small"
      label={label(value)}
      color={
        value === "SHIPPED" || value === "RECEIVED"
          ? "success"
          : value === "CANCELLED"
            ? "default"
            : "primary"
      }
      variant="outlined"
    />
  );
}
export function Heading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="overline" color="text.secondary">
        COREERP / WORKSPACE
      </Typography>
      <Typography variant="h4" sx={{ my: 1 }}>
        {title}
      </Typography>
      <Typography color="text.secondary">{description}</Typography>
    </Box>
  );
}
