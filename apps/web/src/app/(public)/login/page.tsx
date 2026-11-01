import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/Brand";
import { PRODUCT_NAME, PRODUCT_VERSION } from "@azzy/events";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100svh-8rem)] w-full max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8 flex items-center gap-3">
        <Logo size={56} priority />
        <div>
          <h1 className="text-xl font-bold tracking-[0.1em] text-white">{PRODUCT_NAME}</h1>
          <p className="text-xs text-slate-400">{PRODUCT_VERSION} · Portal sign-in</p>
        </div>
      </div>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
