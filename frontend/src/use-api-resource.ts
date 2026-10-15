import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useApiResource<T>(path: string | null) {
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ path, data: null, error: "", loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    if (!path) {
      setState({ path, data: null, error: "", loading: false });
      return;
    }
    setState({ path, data: null, error: "", loading: true });
    api<T>(path, "GET", undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ path, data, error: "", loading: false });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            path,
            data: null,
            error: error instanceof Error ? error.message : "读取失败，请重试",
            loading: false,
          });
      });
    return () => controller.abort();
  }, [path, revision]);
  return {
    ...(state.path === path ? state : { data: null, error: "", loading: true }),
    reload,
  };
}
