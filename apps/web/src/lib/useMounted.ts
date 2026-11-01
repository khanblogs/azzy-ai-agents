"use client";

import { useEffect, useState } from "react";

/** True after first paint — used for page-enter transitions and client-only values. */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setM(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return m;
}
