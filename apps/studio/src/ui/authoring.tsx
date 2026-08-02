import { useState } from "react";
import type { SceneDocument, Transaction } from "@bracketx/engine-scene";

import type { StudioSession } from "../studio/session";
import type { Selection } from "../studio/selection";
import type { IdFactory } from "../studio/ids";
import { PRESETS, applyPreset, type AnimationPreset } from "../studio/presets";
import { align, distribute, group, reorder, ungroup, type AlignEdge } from "../studio/arrange";
import { nodeBounds } from "../studio/viewport";
import {
  STARTER_TOKENS,
  colourTokens,
  demoteTemplate,
  describeDocument,
  instantiate,
  isTemplate,
  promoteToTemplate,
  removeFromLibrary,
  removeToken,
  saveToLibrary,
  searchLibrary,
  setToken,
  setTokens,
  templateDrift,
  type LibraryEntry,
} from "../studio/library";
import { timelinesOf } from "../studio/keyframes";

/**
 * Authoring panels — presets, arrangement, the library.
 *
 * Each one turns a gesture into a `Transaction` and applies nothing. None holds
 * document state. The pattern is the same one the Phase 1 panels established,
 * and it is what keeps every claim in the verification suite a claim about a
 * transaction rather than about a rendered panel.
 */

// ===========================================================================
// Animation presets
// ===========================================================================

export interface PresetPanelProps {
  readonly session: StudioSession;
  readonly selection: Selection;
  readonly ids: IdFactory;
  readonly onEdit: (transaction: Transaction | null) => void;
}

export function PresetPanel({ session, selection, ids, onEdit }: PresetPanelProps) {
  const document_ = session.document;
  const [duration, setDuration] = useState<number | null>(null);
  const [delay, setDelay] = useState(0);
  const [target, setTarget] = useState<string>("");

  const timelines = timelinesOf(document_);
  const disabled = selection.ids.length === 0;

  const apply = (preset: AnimationPreset) => {
    onEdit(
      applyPreset(document_, selection.ids, preset, ids, {
        ...(duration === null ? {} : { duration }),
        ...(delay === 0 ? {} : { delay }),
        ...(target === "" ? {} : { timelineId: target }),
      }),
    );
  };

  const sections: readonly { kind: AnimationPreset["kind"]; title: string }[] = [
    { kind: "entrance", title: "Entrance" },
    { kind: "exit", title: "Exit" },
    { kind: "emphasis", title: "Emphasis" },
  ];

  return (
    <section className="panel presets" aria-label="Animation presets" data-testid="presets">
      <div className="panel-head">
        <h2>Motion</h2>
        <label className="prop inline">
          <span>dur</span>
          <input
            className="field number tiny"
            type="number"
            step={0.05}
            min={0.05}
            placeholder="auto"
            value={duration ?? ""}
            onChange={(event) =>
              setDuration(event.target.value === "" ? null : Number(event.target.value))
            }
            aria-label="Preset duration"
          />
        </label>
        <label className="prop inline">
          <span>delay</span>
          <input
            className="field number tiny"
            type="number"
            step={0.05}
            min={0}
            value={delay}
            onChange={(event) => setDelay(Number(event.target.value))}
            aria-label="Preset delay"
          />
        </label>
        <select
          className="field"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          aria-label="Target timeline"
        >
          <option value="">new timeline</option>
          {timelines.map((timeline) => (
            <option key={timeline.id} value={timeline.id}>
              add to {timeline.name}
            </option>
          ))}
        </select>
      </div>

      {sections.map((section) => (
        <div className="preset-group" key={section.kind}>
          <h3>{section.title}</h3>
          <div className="tool-grid">
            {PRESETS.filter((preset) => preset.kind === section.kind).map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="tool"
                disabled={disabled}
                onClick={() => apply(preset)}
                title={preset.hint}
                data-testid={`preset-${preset.id}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Said on screen, because the absence is a decision rather than a gap.
          A designer who cannot find "Glow" should know why. */}
      <p className="note">
        A preset compiles to ordinary keyframes and then stops existing — edit
        them in the timeline like any others. There is no Blur, Glow or Dissolve
        because the engine has no blur, bloom or dissolve; a preset whose name
        described something the graphic does not do would be a lie.
      </p>
    </section>
  );
}

// ===========================================================================
// Arrange
// ===========================================================================

export interface ArrangeBarProps {
  readonly session: StudioSession;
  readonly selection: Selection;
  readonly ids: IdFactory;
  readonly onEdit: (transaction: Transaction | null) => void;
  readonly onSelect: (nodeIds: readonly string[]) => void;
}

const ALIGNMENTS: readonly { edge: AlignEdge; label: string; title: string }[] = [
  { edge: "left", label: "⇤", title: "Align left" },
  { edge: "centerX", label: "↔", title: "Align centres horizontally" },
  { edge: "right", label: "⇥", title: "Align right" },
  { edge: "top", label: "⤒", title: "Align top" },
  { edge: "middle", label: "↕", title: "Align middles vertically" },
  { edge: "bottom", label: "⤓", title: "Align bottom" },
];

export function ArrangeBar({ session, selection, ids, onEdit, onSelect }: ArrangeBarProps) {
  const document_ = session.document;
  const selected = selection.ids;
  // World bounds from the MIRROR, so a node placed by layout or driven by
  // animation aligns where it actually is rather than where its transform says.
  const bounds = nodeBounds(document_, (id) => session.worldMatrixOf(id));

  const single = selected.length === 1 ? selected[0]! : null;

  return (
    <div className="arrange-bar" data-testid="arrange-bar">
      <span className="dim">Arrange</span>
      {ALIGNMENTS.map((entry) => (
        <button
          key={entry.edge}
          type="button"
          className="chip"
          disabled={selected.length < 2}
          title={`${entry.title} — to the selection, not to the frame`}
          aria-label={entry.title}
          onClick={() => onEdit(align(document_, selected, bounds, entry.edge))}
        >
          {entry.label}
        </button>
      ))}

      <span className="sep" />
      <button
        type="button"
        className="chip"
        disabled={selected.length < 3}
        title="Space evenly. The outermost two do not move."
        onClick={() => onEdit(distribute(document_, selected, bounds, "horizontal"))}
      >
        ⇹
      </button>
      <button
        type="button"
        className="chip"
        disabled={selected.length < 3}
        title="Space evenly, vertically"
        onClick={() => onEdit(distribute(document_, selected, bounds, "vertical"))}
      >
        ⇳
      </button>

      <span className="sep" />
      <button
        type="button"
        className="chip"
        disabled={selected.length === 0}
        title="Wrap in a group, in place. Nothing moves."
        onClick={() => {
          const result = group(document_, selected, ids);
          if (result !== null) {
            onEdit(result.transaction);
            onSelect([result.groupId]);
          }
        }}
      >
        Group
      </button>
      <button
        type="button"
        className="chip"
        disabled={single === null}
        title="Move the children up and remove the group"
        onClick={() => single !== null && onEdit(ungroup(document_, single))}
      >
        Ungroup
      </button>

      <span className="sep" />
      {(
        [
          ["front", "⤒", "Bring to front"],
          ["forward", "↑", "Bring forward"],
          ["backward", "↓", "Send backward"],
          ["back", "⤓", "Send to back"],
        ] as const
      ).map(([move, label, title]) => (
        <button
          key={move}
          type="button"
          className="chip"
          disabled={single === null}
          title={`${title} — draw order IS sibling order`}
          aria-label={title}
          onClick={() => single !== null && onEdit(reorder(document_, single, move))}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ===========================================================================
// Library — templates, tokens, saved scenes
// ===========================================================================

export interface LibraryPanelProps {
  readonly session: StudioSession;
  readonly ids: IdFactory;
  readonly library: readonly LibraryEntry[];
  readonly onLibrary: (next: readonly LibraryEntry[]) => void;
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  readonly onEdit: (transaction: Transaction | null) => void;
  readonly onOpen: (document_: SceneDocument) => void;
  readonly now: () => string;
}

export function LibraryPanel({
  session,
  ids,
  library,
  onLibrary,
  storage,
  onEdit,
  onOpen,
  now,
}: LibraryPanelProps) {
  const document_ = session.document;
  const [query, setQuery] = useState("");
  const [tokenName, setTokenName] = useState("");
  const drift = templateDrift(document_);
  const swatches = colourTokens(document_);

  return (
    <section className="panel library" aria-label="Library" data-testid="library">
      <div className="panel-head">
        <h2>Library</h2>
        <input
          className="field"
          placeholder="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search library"
        />
        <button
          type="button"
          className="chip"
          onClick={() => onLibrary(saveToLibrary(library, describeDocument(document_, now()), storage))}
          title="Saves the SCENE_FORMAT document. There is no Studio file format."
        >
          Save here
        </button>
      </div>

      <div className="library-grid">
        {searchLibrary(library, query).length === 0 ? (
          <p className="note pad">
            Nothing saved yet. What is stored is a SCENE_FORMAT document and a card
            read out of it — never a Studio-specific wrapper, because a template
            the engine cannot load is not a template.
          </p>
        ) : null}
        {searchLibrary(library, query).map((entry) => (
          <article className="card" key={entry.id}>
            <strong>{entry.name}</strong>
            <span className="dim">
              {entry.isTemplate ? "template" : "scene"} · {entry.savedAt.slice(0, 10)}
            </span>
            {entry.tags.length > 0 ? (
              <span className="tags">
                {entry.tags.map((tag) => (
                  <span key={tag} className="badge">
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
            <div className="card-actions">
              <button
                type="button"
                className="link"
                onClick={() => onOpen(instantiate(entry, ids, now()))}
                title="Opens a copy with a fresh document id, keeping the template's"
              >
                open a copy
              </button>
              <button
                type="button"
                className="link danger"
                onClick={() => onLibrary(removeFromLibrary(library, entry.id, storage))}
              >
                remove
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="prop-group">
        <h3>This document</h3>
        {isTemplate(document_) ? (
          <>
            <p className="note">
              A template: <span className="mono">{document_.template!.name}</span> with{" "}
              {document_.template!.parameters.length} parameters, one per variable.
            </p>
            {drift.length > 0 ? (
              <ul className="problems" data-testid="template-drift">
                {drift.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              className="chip"
              onClick={() => onEdit(promoteToTemplate(document_, document_.template!.name, ids))}
            >
              Re-sync parameters
            </button>
            <button
              type="button"
              className="chip danger"
              onClick={() => onEdit(demoteTemplate(document_))}
            >
              Stop being a template
            </button>
          </>
        ) : (
          <>
            <p className="note">
              Declaring this a template writes <span className="mono">template</span> into
              the document, with a parameter per variable. Nothing else changes —
              a template is a scene that says what it exposes.
            </p>
            <button
              type="button"
              className="chip"
              disabled={document_.variables.length === 0}
              title={
                document_.variables.length === 0
                  ? "Declare a variable first — a template with no parameters is a scene"
                  : "Declare this document a template"
              }
              onClick={() => onEdit(promoteToTemplate(document_, document_.meta.name, ids))}
            >
              Save as template
            </button>
          </>
        )}
      </div>

      <div className="prop-group">
        <h3>Design tokens</h3>
        <div className="swatches">
          {swatches.map((token) => (
            <label key={token.name} className="swatch" title={token.description ?? token.name}>
              <input
                type="color"
                value={String(token.value)}
                onChange={(event) =>
                  onEdit(setToken(document_, { ...token, value: event.target.value }))
                }
                aria-label={token.name}
              />
              <span className="mono">{token.name}</span>
              <button
                type="button"
                className="link danger"
                onClick={() => onEdit(removeToken(document_, token.name))}
                aria-label={`Remove ${token.name}`}
              >
                ×
              </button>
            </label>
          ))}
        </div>
        <div className="panel-head">
          <input
            className="field"
            placeholder="color.accent"
            value={tokenName}
            onChange={(event) => setTokenName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || tokenName.trim().length === 0) return;
              onEdit(setToken(document_, { name: tokenName.trim(), value: "#ffffff" }));
              setTokenName("");
            }}
            aria-label="New token name"
          />
          {(document_.tokens ?? []).length === 0 ? (
            <button
              type="button"
              className="chip"
              onClick={() =>
                onEdit(setTokens(document_, STARTER_TOKENS, "Add starter palette"))
              }
              title="Neutral on purpose — your first act should be to replace them"
            >
              Starter palette
            </button>
          ) : null}
        </div>
        <p className="note">
          Tokens live in the document, because a brand colour is part of the
          graphic. They resolve beneath variables (§11.2), so a variable of the
          same name wins — one chain, nothing to reconcile.
        </p>
      </div>
    </section>
  );
}
