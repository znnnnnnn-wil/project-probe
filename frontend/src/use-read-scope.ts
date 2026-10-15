import { useCallback, useEffect, useRef } from "react";

export function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** Coordinates manual refresh and polling without cancelling server mutations. */
export function useReadScope() {
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const version = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++version.current;
      controller.current?.abort();
    };
  }, []);
  return useCallback(() => {
    controller.current?.abort();
    const read = new AbortController();
    controller.current = read;
    const request = ++version.current;
    if (!mounted.current) read.abort();
    return {
      signal: read.signal,
      current: () =>
        mounted.current && request === version.current && !read.signal.aborted,
    };
  }, []);
}
