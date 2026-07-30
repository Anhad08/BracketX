import { Button } from "@bracketx/ui";
import Link from "next/link";

import { Logo } from "./components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo className="text-lg" />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-fg">Not found</h1>
        <p className="max-w-sm text-sm text-fg-muted">
          This page does not exist, or you do not have access to it.
        </p>
      </div>
      <Button asChild variant="secondary">
        <Link href="/workspaces">Back to workspaces</Link>
      </Button>
    </div>
  );
}
