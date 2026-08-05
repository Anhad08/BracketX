/**
 * The pre-air check.
 *
 * ============================================================================
 * EVERY FINDING HERE IS ENGINE STATE, NOT A HEURISTIC
 * ============================================================================
 * The prototype guessed at overflow by comparing a character count against a
 * box width. That guess was wrong in both directions — it does not know the
 * font, the shaping, the fallback chain or the fit mode — and it was a second
 * implementation of something the engine already does properly.
 *
 * So nothing is measured here. `Projector.textFacts()` reports what the shaper
 * actually produced, per node, and this module does one thing the engine
 * cannot: it joins those facts to the document so a person reads
 * "Amara Okonkwo overflows" rather than "a draw overflowed".
 *
 * ============================================================================
 * WHY IT READS THE PROJECTION RATHER THAN THE DOCUMENT
 * ============================================================================
 * A document says a text node has size 32 and a box 0.5 units wide. Whether
 * that fits is a function of the loaded fonts, and only the projection knows —
 * which is also why this check cannot be run without a live session. A
 * pre-flight that worked on a document alone would be checking arithmetic, not
 * the show.
 */
import { findNode, type SceneDocument } from "@bracketx/engine-scene";
import type { SceneHost } from "@bracketx/engine-host";

import { surfaceOf, unsatisfied, type SurfaceField } from "./surface";

/** Why an item is being reported. Ordered by how much it affects air. */
export type IssueKind =
  /** The shaper could not fit the content in the box. */
  | "overflow"
  /** Content was cut to fit. Visible, and usually wrong. */
  | "truncated"
  /** A line broke with no legal opportunity — see IF-004. */
  | "unbreakable"
  /** A required content field is empty. */
  | "missing";

export interface PreflightIssue {
  readonly kind: IssueKind;
  /** The node, when the issue belongs to one. Absent for content issues. */
  readonly nodeId?: string;
  /** What a person should be told this is about. */
  readonly label: string;
  readonly detail: string;
}

export interface PreflightReport {
  readonly issues: readonly PreflightIssue[];
  /** True when nothing was found. The verdict a status bar shows. */
  readonly clear: boolean;
  /**
   * What this check could NOT verify.
   *
   * Volume Four C34: a report that is silently green about something it never
   * looked at is worse than no report. Populated when a session has no text
   * provider, which makes every text finding unknowable rather than absent.
   */
  readonly unchecked: readonly string[];
}

/** A node's author-facing name, falling back to its id. */
function nameOf(document: SceneDocument, nodeId: string): string {
  return findNode(document.root, nodeId)?.name ?? nodeId;
}

const SEVERITY: Record<IssueKind, number> = {
  overflow: 0,
  truncated: 1,
  missing: 2,
  unbreakable: 3,
};

/**
 * Runs the pre-air check against a live session.
 *
 * Takes the host rather than a session so it can be called from a test with a
 * bare `SceneHost` — the check has no Studio dependencies beyond the surface,
 * and pretending otherwise would make it untestable without a UI.
 */
export function preflight(host: SceneHost): PreflightReport {
  const document = host.document;
  if (document === null) {
    return { issues: [], clear: false, unchecked: ["No document is loaded."] };
  }

  const issues: PreflightIssue[] = [];
  const unchecked: string[] = [];

  // -- Text, from the shaper ------------------------------------------------
  if (host.text === null) {
    unchecked.push(
      "Text fit was not checked: this session has no text provider, so no " +
        "shaping happened. Findings about overflow are unknown, not absent.",
    );
  } else {
    for (const [nodeId, facts] of host.reconciler.projector.textFacts()) {
      const label = nameOf(document, nodeId);
      if (facts.overflowed) {
        issues.push({
          kind: "overflow",
          nodeId,
          label,
          detail:
            `Does not fit its box at ${facts.resolvedSize.toFixed(0)} px. ` +
            `The shaper reported overflow.`,
        });
      }
      if (facts.truncated) {
        issues.push({
          kind: "truncated",
          nodeId,
          label,
          detail: "Content was cut to fit. Part of it will not be on air.",
        });
      }
      if (facts.brokeWithoutOpportunity) {
        issues.push({
          kind: "unbreakable",
          nodeId,
          label,
          detail:
            "A line broke with no legal break opportunity. Common in Thai, " +
            "Khmer, Lao and Burmese; the break position may be wrong.",
        });
      }
    }
  }

  // -- Content, from the surface -------------------------------------------
  for (const field of unsatisfied(document)) {
    issues.push({
      kind: "missing",
      label: field.label,
      detail: "Required, and empty. This graphic would air blank here.",
    });
  }

  issues.sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind] || a.label.localeCompare(b.label));
  return { issues, clear: issues.length === 0 && unchecked.length === 0, unchecked };
}

/**
 * The content surface for the currently loaded document.
 *
 * A convenience so a panel does not have to reach through the host to the
 * document to ask what a beginner may edit. Empty when nothing is loaded.
 */
export function contentSurface(host: SceneHost): readonly SurfaceField[] {
  const document = host.document;
  return document === null ? [] : surfaceOf(document);
}
