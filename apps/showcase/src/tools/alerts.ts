/**
 * Actionable diagnostics.
 *
 * ============================================================================
 * THE DIFFERENCE THIS FILE EXISTS TO MAKE
 * ============================================================================
 * V2 displayed:
 *
 *     Runtime      4.612 ms
 *     Dirty nodes  42
 *
 * Both correct, both useless. Is 4.6ms bad? Compared to what? Where did 42
 * dirty nodes come from? An engineer answers those by opening three more panels
 * and doing arithmetic in their head, which is the friction this whole phase is
 * about removing.
 *
 * So the rules below turn numbers into statements with a subject and a cause:
 *
 *     Runtime is 18% above the captured baseline (4.61ms p95 vs 3.91ms).
 *     42 dirty nodes from collection.patch on `entries`, sent by feed.
 *     Output `preview` has missed 12 frames — no camera resolved.
 *
 * Every rule states its EVIDENCE, and every rule is a pure function of a
 * snapshot so it can be tested without a browser or a clock. A diagnostic that
 * cannot be tested will eventually be wrong, and a wrong diagnostic is worse
 * than none because it is believed.
 *
 * Deliberately NOT here: anything that guesses. There is no anomaly model, no
 * learned threshold, no "unusual activity detected". Every alert below can be
 * derived by hand from the numbers it prints, which is what makes it possible
 * to disagree with one.
 */
import type { LiveCommandRecord } from "@bracketx/engine-host";

import type { Diagnostics } from "../engine/session";
import {
  FRAME_BUDGET_MS,
  type Baseline,
  type Distribution,
  type SampleField,
  type Spike,
  compareToBaseline,
} from "../engine/history";
import type { DirtyOrigin } from "./model";

export type Severity = "error" | "warn" | "info";

export interface Alert {
  /** Stable across samples, so the UI does not flicker as rules re-run. */
  readonly id: string;
  readonly severity: Severity;
  /** The finding, in one line. Always names the subject. */
  readonly title: string;
  /** The numbers the finding rests on. Always enough to disagree with. */
  readonly detail: string;
  /** Where to go next. The seconds this saves are the point. */
  readonly action?: {
    readonly kind: "select-node" | "open-tool" | "watch-variable";
    readonly target: string;
    readonly label: string;
  };
}

export interface AlertInput {
  readonly diagnostics: Diagnostics;
  readonly stats: Readonly<Record<SampleField, Distribution>>;
  readonly baseline: Baseline | null;
  readonly spikes: readonly Spike[];
  readonly origins: readonly DirtyOrigin[];
  readonly records: readonly LiveCommandRecord[];
  /** Node counts at the start and end of the window, for growth detection. */
  readonly nodeCountWindow?: { readonly first: number; readonly last: number; readonly seconds: number };
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

function ms(value: number): string {
  return value < 0.01 ? value.toFixed(4) : value.toFixed(3);
}

function percent(fraction: number): string {
  return `${fraction >= 0 ? "+" : ""}${(fraction * 100).toFixed(0)}%`;
}

/**
 * Every rule, run against one snapshot. Ordered by severity, then by rule.
 *
 * Rules never mutate and never read the clock. Same input, same alerts — which
 * is what lets the whole set be asserted in a headless test.
 */
export function alerts(input: AlertInput): readonly Alert[] {
  const out: Alert[] = [];

  // --- Budget ------------------------------------------------------------
  const total = input.stats.total;
  if (total.count > 0 && total.p95 > FRAME_BUDGET_MS) {
    const worst = dominantPhase(input.stats);
    out.push({
      id: "budget.over",
      severity: "error",
      title: `1 frame in 20 misses the 60fps budget — ${worst.field} dominates`,
      detail:
        `p95 ${ms(total.p95)}ms against a ${FRAME_BUDGET_MS.toFixed(2)}ms budget, ` +
        `worst ${ms(total.max)}ms over ${total.count} frames. ` +
        `${worst.field} is ${ms(worst.value)}ms of it (${(worst.share * 100).toFixed(0)}%).`,
      action: { kind: "open-tool", target: "performance", label: "Open performance" },
    });
  } else if (total.count > 0 && total.p95 > FRAME_BUDGET_MS * 0.5) {
    out.push({
      id: "budget.near",
      severity: "warn",
      title: `Frame time is over half the budget`,
      detail: `p95 ${ms(total.p95)}ms of ${FRAME_BUDGET_MS.toFixed(2)}ms. Headroom for one more output or a heavier scene is thin.`,
      action: { kind: "open-tool", target: "performance", label: "Open performance" },
    });
  }

  // --- Regression against a captured baseline ----------------------------
  if (input.baseline !== null) {
    for (const regression of compareToBaseline(input.baseline, input.stats)) {
      if (regression.verdict === "unchanged") continue;
      const worse = regression.verdict === "slower";
      out.push({
        id: `regression.${regression.field}`,
        severity: worse ? "warn" : "info",
        title: `${regression.field} is ${percent(regression.delta)} vs baseline "${input.baseline.label}"`,
        detail:
          `p95 ${ms(regression.current)} now, ${ms(regression.baseline)} at capture ` +
          `(frame ${input.baseline.capturedAtFrame}, ${input.baseline.sampleCount} samples).`,
        action: { kind: "open-tool", target: "performance", label: "Compare" },
      });
    }
  }

  // --- Spikes ------------------------------------------------------------
  if (input.spikes.length > 0) {
    const worst = input.spikes.reduce((a, b) => (b.value > a.value ? b : a));
    out.push({
      id: "spike",
      severity: input.spikes.length > 3 ? "warn" : "info",
      title: `${input.spikes.length} frame spike${input.spikes.length === 1 ? "" : "s"} — worst at frame ${worst.frame}`,
      detail:
        `${ms(worst.value)}ms, ${worst.ratio.toFixed(1)}× the median, mostly ${worst.dominant}. ` +
        `Detected by median absolute deviation, so a run of spikes does not hide them.`,
      action: { kind: "open-tool", target: "performance", label: "Show history" },
    });
  }

  // --- Rejected commands -------------------------------------------------
  if (input.diagnostics.commandsRejected > 0) {
    const rejected = input.records.filter((record) => !record.accepted);
    const last = rejected.at(-1);
    out.push({
      id: "commands.rejected",
      severity: "error",
      title: `${input.diagnostics.commandsRejected} command${input.diagnostics.commandsRejected === 1 ? "" : "s"} rejected`,
      detail:
        last === undefined
          ? "Rejections happened before the visible log window."
          : `Latest: ${last.command.type} from ${last.source} at frame ${last.frame} — ${last.reason ?? "no reason recorded"}.`,
      action: { kind: "open-tool", target: "console", label: "Open console" },
    });
  }

  // --- Outputs -----------------------------------------------------------
  for (const output of input.diagnostics.outputs) {
    if (output.missed === 0) continue;
    out.push({
      id: `output.missed.${output.id}`,
      severity: "error",
      title: `Output "${output.id}" missed ${output.missed} frames`,
      detail:
        `No camera resolved. ${output.width}×${output.height}, cadence 1/${output.cadence}, ` +
        `${output.rendered} rendered. A missed frame is black on air, not a dropped frame.`,
      action: { kind: "open-tool", target: "outputs", label: "Open outputs" },
    });
  }
  if (input.diagnostics.outputs.length === 0) {
    out.push({
      id: "output.none",
      severity: "warn",
      title: "No outputs bound",
      detail: "The engine is stepping but nothing is being drawn anywhere.",
      action: { kind: "open-tool", target: "outputs", label: "Open outputs" },
    });
  }

  // --- Where the churn comes from ----------------------------------------
  const dominant = input.origins[0];
  if (dominant !== undefined && dominant.dirtyNodes > 0) {
    const totalDirty = input.origins.reduce((sum, origin) => sum + origin.dirtyNodes, 0);
    const share = dominant.dirtyNodes / totalDirty;
    out.push({
      id: "dirty.origin",
      severity: "info",
      title: `Scene churn originates from ${dominant.commandType} (${dominant.source})`,
      detail:
        `${dominant.dirtyNodes} of ${totalDirty} dirty nodes (${(share * 100).toFixed(0)}%) ` +
        `across ${dominant.commands} command${dominant.commands === 1 ? "" : "s"}, ` +
        `${dominant.backendWrites} backend writes.`,
      action: { kind: "open-tool", target: "console", label: "Open console" },
    });
  }

  // --- Write amplification ------------------------------------------------
  const writes = input.stats.backendWrites;
  const dirty = input.stats.dirtyNodes;
  if (dirty.mean > 1 && writes.mean > dirty.mean * 3) {
    out.push({
      id: "writes.amplified",
      severity: "warn",
      title: "Backend writes far exceed dirty nodes",
      detail:
        `${writes.mean.toFixed(1)} writes per frame for ${dirty.mean.toFixed(1)} dirty nodes ` +
        `(${(writes.mean / dirty.mean).toFixed(1)}×). Projection is touching more than it marked.`,
      action: { kind: "open-tool", target: "performance", label: "Open performance" },
    });
  }

  // --- Mirror growth (the leak detector) ---------------------------------
  const window = input.nodeCountWindow;
  if (window !== undefined && window.seconds >= 5) {
    const growth = window.last - window.first;
    if (growth > 0 && growth / window.first > 0.2) {
      out.push({
        id: "mirror.growth",
        severity: "warn",
        title: `Mirror grew ${growth} nodes in ${window.seconds.toFixed(0)}s`,
        detail:
          `${window.first} → ${window.last} with no scene change. ` +
          `A mirror that only grows is a lifetime bug; MirrorBackend contract C2 puts that on the reconciler.`,
        action: { kind: "open-tool", target: "inspector", label: "Open inspector" },
      });
    }
  }

  // --- Animation ----------------------------------------------------------
  if (input.diagnostics.heldClips.length > 0) {
    out.push({
      id: "clips.held",
      severity: "info",
      title: `${input.diagnostics.heldClips.length} clip${input.diagnostics.heldClips.length === 1 ? "" : "s"} holding their final frame`,
      detail:
        `${input.diagnostics.heldClips.join(", ")}. A completed clip HOLDS rather than reverting; ` +
        `only clip.stop returns those nodes to their authored values.`,
      action: { kind: "open-tool", target: "timeline", label: "Open timeline" },
    });
  }

  return out.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
}

function dominantPhase(
  stats: Readonly<Record<SampleField, Distribution>>,
): { field: SampleField; value: number; share: number } {
  const phases: readonly SampleField[] = ["runtime", "animation", "render"];
  let best: SampleField = "runtime";
  let bestValue = -Infinity;
  for (const field of phases) {
    if (stats[field].p95 > bestValue) {
      bestValue = stats[field].p95;
      best = field;
    }
  }
  const total = stats.total.p95;
  return { field: best, value: bestValue, share: total > 0 ? bestValue / total : 0 };
}

/** The most severe level present, for a badge. Null when everything is fine. */
export function worstSeverity(list: readonly Alert[]): Severity | null {
  if (list.length === 0) return null;
  return list.reduce<Severity>(
    (worst, alert) => (SEVERITY_ORDER[alert.severity] < SEVERITY_ORDER[worst] ? alert.severity : worst),
    "info",
  );
}
