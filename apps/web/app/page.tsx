import { Badge, Button } from "@bracketx/ui";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Logo } from "./components/brand";

const AUDIENCES = [
  {
    title: "Esports",
    body: "Brackets, lineups, player stats, and score bugs that keep up with the match.",
  },
  {
    title: "Sports",
    body: "Repeatable graphics packages for recurring fixtures and small crews.",
  },
  {
    title: "Podcasts",
    body: "Name keys, topic cards, and timers that stay on brand every episode.",
  },
  {
    title: "Live events",
    body: "Sessions, speakers, schedules, and sponsor loops driven from one place.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-line px-6">
        <Logo />
        <nav className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild variant="primary" size="sm">
            <Link href="/sign-up">Get started</Link>
          </Button>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-3xl px-6 py-24 text-center">
          <Badge tone="accent" className="mb-6">
            Sprint 1 · Foundation
          </Badge>

          <h1 className="text-balance text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
            Live broadcast graphics,
            <br />
            <span className="text-accent">in a browser tab.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-base text-fg-muted">
            Design it, bind it to your data, and put it on air — without a
            broadcast truck, a GPU workstation, or an engineer on retainer.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="primary" size="lg">
              <Link href="/sign-up">
                Create a workspace
                <ArrowRight />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/sign-in">I have an account</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 pb-24">
          <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
            {AUDIENCES.map((item) => (
              <div key={item.title} className="bg-surface p-6">
                <h2 className="text-sm font-semibold text-fg">{item.title}</h2>
                <p className="mt-2 text-sm text-fg-muted">{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-6 py-6">
        <p className="text-xs text-fg-subtle">
          BracketX — live production, browser-first.
        </p>
      </footer>
    </div>
  );
}
