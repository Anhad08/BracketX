import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "../components/brand";

/**
 * Shared frame for sign-in and sign-up, so the two screens cannot drift apart
 * in width, spacing, or vertical rhythm.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <Link href="/" className="mb-8 rounded-md px-1 py-0.5">
        <Logo className="text-lg" />
      </Link>

      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
