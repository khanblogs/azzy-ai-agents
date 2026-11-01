"use client";

import { useState } from "react";
import { Button } from "./Button";
import { IconCheck, IconCopy } from "./Icons";

export function CopyButton({ text, label = "Copy", className, testId }: { text: string; label?: string; className?: string; testId?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      // clipboard blocked: select-all fallback is left to the user
    }
  };
  return (
    <Button size="sm" variant="outline" className={className} data-testid={testId} onClick={copy} aria-label={`${label} to clipboard`} icon={done ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}>
      {done ? "Copied" : label}
    </Button>
  );
}
