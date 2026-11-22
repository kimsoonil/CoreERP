import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
export function useTask() {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [message, setMessage] = useState("");
  async function run(task: () => Promise<unknown>, message = "처리했습니다.") {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await task();
      await client.invalidateQueries();
      setMessage(message);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, message, run, setError };
}
export function useRequestKey() {
  const ref = useRef<{ payload: string; key: string } | null>(null);
  return {
    key: (payload: unknown) => {
      const p = JSON.stringify(payload);
      if (ref.current?.payload !== p)
        ref.current = { payload: p, key: crypto.randomUUID() };
      return ref.current.key;
    },
    reset: () => {
      ref.current = null;
    },
  };
}
