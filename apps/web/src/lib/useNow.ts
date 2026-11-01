"use client";

import { useEffect, useState } from "react";

/** Ticking clock for relative times and countdowns; starts at 0 on the server so SSR markup is stable. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now || Date.now();
}
