import { useRef, useState } from "react";
import type { SceneDocument, Transaction } from "@bracketx/engine-scene";
import type { AssetRecord } from "@bracketx/engine-assets";

import type { StudioSession } from "../studio/session";
import type { IdFactory } from "../studio/ids";
import { SCENE_DRAG } from "../studio/place";
import {
  PRESETS as QUALITY_PRESETS,
  resolveTier,
  TIERS,
  type FrameReport,
  type QualityChoice,
} from "../studio/quality";
import type { DeviceInput } from "../studio/device";
import { PACKS, installTheme, type Pack, type PackTemplate } from "../studio/packs";
import { STUDIO_FONTS } from "../studio/fonts";
import { PRESETS, presetById } from "../studio/presets";
import { colourTokens, removeFromLibrary, type LibraryEntry } from "../studio/library";
import { friendlyDate } from "./home";

/**
 * The non-editor sections: Marketplace, Templates, Assets, Outputs, Settings.
 *
 * ============================================================================
 * EVERY CATEGORY HERE IS REAL
 * ============================================================================
 * The brief lists eleven asset categories and twelve Marketplace categories.
 * Most of them need images, SVG or video, and the engine cannot draw any of
 * those — IF-005.
 *
 * So they are not here. Not stubbed, not greyed out, not "coming soon" tiles: a
 * category that is permanently empty teaches a user to distrust the panel it is
 * in, which is exactly the rule the toolbox settled in Phase 3A. What ships is
 * what works — fonts, colours, motion and templates — plus one honest line
 * saying what is coming.
 */

// ===========================================================================
// Marketplace
// ===========================================================================

export interface MarketplaceProps {
  readonly installed: ReadonlySet<string>;
  readonly onInstall: (pack: Pack) => void;
  readonly onUninstall: (pack: Pack) => void;
  readonly onApplyTheme: (pack: Pack) => void;
  readonly onUseTemplate: (template: PackTemplate) => void;
  readonly canApply: boolean;
}

const KIND_LABEL: Record<Pack["kind"], string> = {
  theme: "Theme",
  motion: "Motion",
  graphics: "Graphics",
};

export function Marketplace({
  installed,
  onInstall,
  onUninstall,
  onApplyTheme,
  onUseTemplate,
  canApply,
}: MarketplaceProps) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Pack["kind"] | "all">("all");

  const needle = query.trim().toLowerCase();
  const shown = PACKS.filter((pack) => {
    if (kind !== "all" && pack.kind !== kind) return false;
    if (needle.length === 0) return true;
    return [pack.name, pack.description, ...pack.tags]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <div className="section-page" data-testid="marketplace">
      <header className="section-head">
        <div>
          <h1>Marketplace</h1>
          <p className="lede">Themes, motion and graphics. Everything installs instantly.</p>
        </div>
        <input
          className="field search"
          placeholder="Search packs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search packs"
        />
      </header>

      <nav className="chips" aria-label="Filter by kind">
        {(["all", "theme", "motion", "graphics"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            className={`chip ${kind === entry ? "on" : ""}`}
            onClick={() => setKind(entry)}
          >
            {entry === "all" ? "Everything" : KIND_LABEL[entry]}
          </button>
        ))}
      </nav>

      <div className="pack-grid">
        {shown.map((pack) => {
          const owned = installed.has(pack.id);
          return (
            <article className="pack-card" key={pack.id} data-testid={`pack-${pack.id}`}>
              <span
                className="pack-art"
                aria-hidden
                style={{
                  background: `linear-gradient(135deg, ${pack.swatch[0]} 0%, ${pack.swatch[0]} 55%, ${pack.swatch[1]} 55%, ${pack.swatch[1]} 100%)`,
                }}
              />
              <div className="pack-body">
                <div className="pack-title">
                  <strong>{pack.name}</strong>
                  <span className="badge">{KIND_LABEL[pack.kind]}</span>
                </div>
                <span className="dim">{pack.description}</span>
                <span className="dim tiny">{pack.author} · Free</span>

                <div className="pack-actions">
                  {owned ? (
                    <>
                      {pack.kind === "theme" ? (
                        <button
                          type="button"
                          className="chip primary"
                          disabled={!canApply}
                          onClick={() => onApplyTheme(pack)}
                          title={canApply ? "Restyle the open graphic" : "Open a graphic first"}
                        >
                          Apply
                        </button>
                      ) : null}
                      {/* A motion pack has nothing to press here — its moves
                          are applied while designing. Saying so turns a card
                          that looked broken into one that has told you where
                          its contents went. */}
                      {pack.kind === "motion" ? (
                        <span className="dim tiny">
                          {(pack.presets ?? []).length} moves, in the Animation
                          list while you design.
                        </span>
                      ) : null}
                      {(pack.templates ?? []).map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          className="chip primary"
                          onClick={() => onUseTemplate(template)}
                        >
                          {template.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="link"
                        onClick={() => onUninstall(pack)}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="chip primary"
                      onClick={() => onInstall(pack)}
                      data-testid={`install-${pack.id}`}
                    >
                      Install
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* One line, once. Honest about what is not here yet, without a grid of
          tiles that cannot be clicked. */}
      <p className="note pad">
        Icons, stingers and brand packs arrive with image support.
      </p>
    </div>
  );
}

// ===========================================================================
// Templates — what the user has saved
// ===========================================================================

export interface TemplatesProps {
  readonly library: readonly LibraryEntry[];
  readonly onOpen: (entry: LibraryEntry) => void;
  readonly onLibrary: (next: readonly LibraryEntry[]) => void;
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

export function Templates({ library, onOpen, onLibrary, storage }: TemplatesProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = library.filter((entry) =>
    needle.length === 0
      ? true
      : [entry.name, entry.description ?? "", ...entry.tags].join(" ").toLowerCase().includes(needle),
  );

  return (
    <div className="section-page" data-testid="templates-section">
      <header className="section-head">
        <div>
          <h1>Templates</h1>
          <p className="lede">Graphics you have saved, ready to reuse.</p>
        </div>
        <input
          className="field search"
          placeholder="Search your templates"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search templates"
        />
      </header>

      {shown.length === 0 ? (
        <p className="note pad">
          Nothing saved yet. Build a graphic and choose <em>Save as template</em>
          {" "}to reuse it — the fields you expose become the fields a producer fills in.
        </p>
      ) : (
        <div className="pack-grid">
          {shown.map((entry) => (
            <article className="pack-card" key={entry.id}>
              <span className="pack-art plain" aria-hidden />
              <div className="pack-body">
                <div className="pack-title">
                  <strong>{entry.name}</strong>
                  {entry.isTemplate ? <span className="badge">Template</span> : null}
                </div>
                <span className="dim">{friendlyDate(entry.savedAt)}</span>
                <div className="pack-actions">
                  <button type="button" className="chip primary" onClick={() => onOpen(entry)}>
                    Open a copy
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => onLibrary(removeFromLibrary(library, entry.id, storage))}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Assets
// ===========================================================================

export interface AssetsProps {
  readonly session: StudioSession | null;
  readonly installed: ReadonlySet<string>;
  readonly assets: readonly AssetRecord[];
  /** Returns a message on failure, or null when the import succeeded. */
  readonly onImport: (file: File) => Promise<string | null>;
  readonly usersOf: (assetId: string) => readonly string[];
  readonly thumbnails: ReadonlyMap<string, string>;
  readonly onRename: (assetId: string, name: string) => void;
  readonly onFavourite: (assetId: string, favorite: boolean) => void;
  readonly onTags: (assetId: string, tags: readonly string[]) => void;
  readonly onDuplicate: (assetId: string) => void;
  readonly onDelete: (assetId: string) => void;
  readonly onReplace: (assetId: string, file: File) => Promise<string | null>;
  /** Adds an installed scene to the open stage, at its designed position. */
  readonly onPlaceScene: (templateId: string) => void;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Assets({
  session,
  installed,
  assets,
  onImport,
  usersOf,
  thumbnails,
  onRename,
  onFavourite,
  onTags,
  onDuplicate,
  onDelete,
  onReplace,
  onPlaceScene,
}: AssetsProps) {
  const [importing, setImporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const replacer = useRef<HTMLInputElement | null>(null);

  const needle = query.trim().toLowerCase();
  const images = assets
    .filter((asset) => asset.kind === "image")
    .filter(
      (asset) =>
        needle === "" ||
        asset.name.toLowerCase().includes(needle) ||
        asset.tags.some((tag) => tag.toLowerCase().includes(needle)),
    );

  // Selection survives a rename but not a delete, so the inspector is read from
  // the live list rather than held as a copy.
  const selected = assets.find((asset) => asset.id === picked) ?? null;

  const take = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    setImporting(true);
    setProblem(null);
    // Sequential, not parallel: a failure must name the file that caused it,
    // and a designer dropping twenty logos would otherwise get one message for
    // an unknown one of them.
    for (const file of Array.from(files)) {
      const failure = await onImport(file);
      if (failure !== null) {
        setProblem(`${file.name}: ${failure}`);
        break;
      }
    }
    setImporting(false);
  };
  const swatches = session === null ? [] : colourTokens(session.document);
  const motion = PACKS.filter((pack) => pack.kind === "motion" && installed.has(pack.id));
  const scenes = PACKS.filter((pack) => installed.has(pack.id)).flatMap((pack) =>
    (pack.templates ?? []).map((template) => ({ pack, template })),
  );

  return (
    <div className="section-page" data-testid="assets">
      <header className="section-head">
        <div>
          <h1>Assets</h1>
          <p className="lede">Everything you can reuse across graphics.</p>
        </div>
      </header>

      <section
        className="home-block"
        data-testid="asset-images"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void take(event.dataTransfer.files);
        }}
      >
        <div className="block-head">
          <h2>Images</h2>
          <span className="dim">
            Logos, marks and backgrounds. Drop a file anywhere here
          </span>
          <input
            className="field"
            placeholder="Search assets"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search assets"
            data-testid="asset-search"
          />
          <button
            type="button"
            className="ghost"
            data-testid="import-asset"
            onClick={() => picker.current?.click()}
            disabled={importing}
          >
            {importing ? "Importing…" : "Import"}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/png"
            multiple
            hidden
            data-testid="asset-file"
            onChange={(event) => {
              void take(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        {problem !== null ? (
          <p className="note pad warn" data-testid="import-problem">
            {problem}
          </p>
        ) : null}

        {images.length === 0 ? (
          <p className="note pad">
            {needle === ""
              ? "Nothing yet. Import a PNG and it becomes available to every graphic."
              : `Nothing matches "${query}".`}
          </p>
        ) : (
          <div className="asset-grid" data-testid="asset-grid">
            {images.map((asset) => {
              const used = usersOf(asset.id);
              const preview = thumbnails.get(asset.id);
              return (
                <button
                  type="button"
                  className={`asset-tile${picked === asset.id ? " on" : ""}`}
                  key={asset.id}
                  data-testid={`asset-${asset.id}`}
                  onClick={() => setPicked(asset.id === picked ? null : asset.id)}
                >
                  <span className="asset-thumb">
                    {preview === undefined ? (
                      <span className="dim tiny">no preview</span>
                    ) : (
                      <img src={preview} alt="" />
                    )}
                    {asset.favorite ? <em className="pin">★</em> : null}
                  </span>
                  <strong>{asset.name}</strong>
                  <span className="dim tiny">
                    {asset.metadata.width ?? "?"} x {asset.metadata.height ?? "?"}
                    {" · "}
                    {fileSize(asset.bytes)}
                  </span>
                  <span className="dim tiny">
                    {asset.origin === "shipped" ? "Included" : "Yours"}
                    {used.length > 0 ? ` · used by ${used.length}` : " · unused"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {selected === null ? null : (
          <div className="asset-inspector" data-testid="asset-inspector">
            <div className="row">
              <input
                className="field grow"
                key={`${selected.id}:${selected.name}`}
                defaultValue={selected.name}
                aria-label="Asset name"
                data-testid="asset-name"
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next !== "" && next !== selected.name) {
                    onRename(selected.id, next);
                  }
                }}
              />
              <button
                type="button"
                className="ghost"
                data-testid="asset-favourite"
                aria-pressed={selected.favorite}
                onClick={() => onFavourite(selected.id, !selected.favorite)}
              >
                {selected.favorite ? "★ Favourite" : "☆ Favourite"}
              </button>
            </div>

            <dl className="asset-facts">
              <div>
                <dt>Size</dt>
                <dd>
                  {selected.metadata.width ?? "?"} x{" "}
                  {selected.metadata.height ?? "?"} px
                </dd>
              </div>
              <div>
                <dt>Stored</dt>
                <dd>{fileSize(selected.bytes)}</dd>
              </div>
              <div>
                <dt>Used by</dt>
                <dd data-testid="asset-usage">
                  {usersOf(selected.id).length} graphic
                  {usersOf(selected.id).length === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt>Versions</dt>
                {/* The current bytes plus everything it can roll back to. */}
                <dd>{selected.history.length + 1}</dd>
              </div>
            </dl>

            <input
              className="field"
              key={`${selected.id}:tags`}
              defaultValue={selected.tags.join(", ")}
              placeholder="Tags, comma separated"
              aria-label="Tags"
              data-testid="asset-tags"
              onBlur={(event) =>
                onTags(
                  selected.id,
                  event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0),
                )
              }
            />

            <div className="row">
              <button
                type="button"
                className="ghost"
                data-testid="asset-replace"
                onClick={() => replacer.current?.click()}
              >
                Replace…
              </button>
              <input
                ref={replacer}
                type="file"
                accept="image/png"
                hidden
                data-testid="asset-replace-file"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file === undefined) return;
                  const failure = await onReplace(selected.id, file);
                  setProblem(failure === null ? null : `${file.name}: ${failure}`);
                }}
              />
              <button
                type="button"
                className="ghost"
                data-testid="asset-duplicate"
                onClick={() => onDuplicate(selected.id)}
              >
                Duplicate
              </button>
              <button
                type="button"
                className="ghost danger"
                data-testid="asset-delete"
                // Included assets return on the next launch, so offering to
                // delete one would be a button that does not do what it says.
                disabled={selected.origin === "shipped"}
                title={
                  selected.origin === "shipped"
                    ? "Included assets cannot be removed"
                    : undefined
                }
                onClick={() => {
                  onDelete(selected.id);
                  setPicked(null);
                }}
              >
                Delete
              </button>
            </div>

            <p className="note">
              Replacing keeps this asset's identity, so every graphic using it
              updates without being re-opened.
            </p>
          </div>
        )}

        <p className="note pad">
          PNG today. Vector, video and audio are coming — they are named here
          rather than shown as empty shelves.
        </p>
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Colours</h2>
          <span className="dim">Used by every graphic that references them</span>
        </div>
        {swatches.length === 0 ? (
          <p className="note pad">
            Open a graphic to see its colours. Applying a theme from the
            Marketplace fills this in.
          </p>
        ) : (
          <div className="swatch-grid">
            {swatches.map((token) => (
              <span className="swatch-tile" key={token.name}>
                <span className="tile" style={{ background: String(token.value) }} />
                <strong>{token.name.replace("color.", "")}</strong>
                <span className="dim tiny">{String(token.value)}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Typefaces</h2>
          <span className="dim">Loaded and ready</span>
        </div>
        <div className="font-grid">
          {STUDIO_FONTS.map((font) => (
            <span className="font-tile" key={font.assetId}>
              <strong>{font.label}</strong>
              <span className="dim tiny">{font.scripts.join(" · ")}</span>
            </span>
          ))}
        </div>
      </section>

      {/* SCENES — the journey's missing link. A scene installed from the
          Marketplace lives here, and is DRAGGED onto the Stage. Nothing about
          it is recreated by hand; `placeScene` inserts its real nodes. */}
      <section className="home-block">
        <div className="block-head">
          <h2>Scenes</h2>
          <span className="dim">Drag one onto your stage</span>
        </div>
        {scenes.length === 0 ? (
          <p className="empty">
            Install a graphics pack from the Marketplace and its scenes appear
            here, ready to drop onto the stage.
          </p>
        ) : (
          <div className="scene-grid">
            {scenes.map(({ pack, template }) => (
              <button
                type="button"
                className="scene-tile"
                key={template.id}
                draggable
                data-testid={`scene-${template.id}`}
                onDragStart={(event) => {
                  event.dataTransfer.setData(SCENE_DRAG, template.id);
                  event.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onPlaceScene(template.id)}
                title={`Add ${template.name} to your stage`}
              >
                <span
                  className="scene-art"
                  aria-hidden
                  style={{
                    background: `linear-gradient(135deg, ${pack.swatch[0]}, ${pack.swatch[1]})`,
                  }}
                />
                <strong>{template.name}</strong>
                <span className="dim tiny">{template.description}</span>
              </button>
            ))}
          </div>
        )}
        <p className="note">
          Dragging a scene adds it to what you already have. Nothing is replaced.
        </p>
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Motion</h2>
          <span className="dim">From your installed packs</span>
        </div>
        <div className="font-grid">
          {motion.flatMap((pack) =>
            (pack.presets ?? []).map((id) => {
              const preset = presetById(id);
              return preset === undefined ? null : (
                <span className="font-tile" key={`${pack.id}:${id}`}>
                  <strong>{preset.label}</strong>
                  <span className="dim tiny">{pack.name}</span>
                </span>
              );
            }),
          )}
        </div>
        <p className="note">
          {PRESETS.length} moves available. Apply one from the Motion panel while
          designing.
        </p>
      </section>

      <p className="note pad">
        Images, logos, video and audio arrive with image support.
      </p>
    </div>
  );
}

// ===========================================================================
// Outputs
// ===========================================================================

export function Outputs({ session }: { session: StudioSession | null }) {
  const outputs = session?.host.outputs ?? [];
  const document_ = session?.document;

  return (
    <div className="section-page" data-testid="outputs">
      <header className="section-head">
        <div>
          <h1>Outputs</h1>
          <p className="lede">Where your graphics are sent.</p>
        </div>
      </header>

      <section className="home-block">
        <div className="block-head">
          <h2>Frame</h2>
        </div>
        {document_ === undefined ? (
          <p className="note pad">Open a graphic to see its frame.</p>
        ) : (
          <dl className="facts">
            <div>
              <dt>Resolution</dt>
              <dd>
                {document_.world.output.width} × {document_.world.output.height}
              </dd>
            </div>
            <div>
              <dt>Frame rate</dt>
              <dd>{document_.world.output.fps} fps</dd>
            </div>
            <div>
              <dt>Background</dt>
              <dd>Transparent — composites over video</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Destinations</h2>
          <span className="dim">{outputs.length} connected</span>
        </div>
        <ul className="row-list quiet">
          {outputs.map((output) => (
            <li key={output.id}>
              <span className="learn">
                <strong>{output.id === "default" ? "Editor preview" : output.id}</strong>
                <span className="dim">
                  {output.width} × {output.height}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="note">
          A production feed is added when you connect Streamatrix to your
          switcher.
        </p>
      </section>
    </div>
  );
}

// ===========================================================================
// Settings
// ===========================================================================

export interface SettingsProps {
  readonly theme: "dark" | "light";
  readonly onTheme: (theme: "dark" | "light") => void;
  readonly developerMode: boolean;
  readonly onDeveloperMode: (on: boolean) => void;
  readonly onResetWorkspace: () => void;
  readonly quality: QualityChoice;
  readonly onQuality: (choice: QualityChoice) => void;
  readonly device: DeviceInput;
  /** What the last few seconds actually measured. Null before any frame. */
  readonly frames: FrameReport | null;
}

export function Settings({
  theme,
  onTheme,
  developerMode,
  onDeveloperMode,
  onResetWorkspace,
  quality,
  onQuality,
  device,
  frames,
}: SettingsProps) {
  const resolved = resolveTier(quality, device);
  const active = QUALITY_PRESETS[resolved];
  return (
    <div className="section-page" data-testid="settings">
      <header className="section-head">
        <div>
          <h1>Settings</h1>
          <p className="lede">Appearance and behaviour.</p>
        </div>
      </header>

      {/* QUALITY. Named for what it costs, not for what it switches off — a
          user picking a preset is answering "how much machine do I have?",
          not "would you like antialiasing?". */}
      <section className="home-block">
        <div className="block-head">
          <h2>Quality</h2>
          <span className="dim">
            {quality === "auto" ? `Automatic — ${active.label} on this device` : "Chosen by you"}
          </span>
        </div>

        <div className="quality-grid">
          <button
            type="button"
            className={`quality-card ${quality === "auto" ? "on" : ""}`}
            data-testid="quality-auto"
            onClick={() => onQuality("auto")}
          >
            <strong>Automatic</strong>
            <span className="dim tiny">
              Picks a level from this device. Currently {active.label}.
            </span>
          </button>
          {TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              className={`quality-card ${quality === tier ? "on" : ""}`}
              data-testid={`quality-${tier}`}
              onClick={() => onQuality(tier)}
            >
              <strong>{QUALITY_PRESETS[tier].label}</strong>
              <span className="dim tiny">{QUALITY_PRESETS[tier].hint}</span>
            </button>
          ))}
        </div>

        {/* Measured, never claimed. The 95th percentile is beside the average
            because a viewport that runs at 60 and hitches once a second reads
            as broken while averaging perfectly well. */}
        <dl className="facts mono">
          <div>
            <dt>Frame rate</dt>
            {/* "Idle" rather than a number, because the editor DRAWS ONLY
                WHEN SOMETHING CHANGES. Reporting the display's refresh rate
                for a stationary scene would be a number that says nothing
                about whether this machine can cope. */}
            <dd data-testid="fps">
              {frames === null || frames.sampled === 0
                ? "Idle"
                : `${Math.round(frames.fps)} fps`}
            </dd>
          </div>
          <div>
            <dt>Worst frame</dt>
            <dd>
              {frames === null || frames.sampled === 0
                ? "Idle"
                : `${frames.worstMs.toFixed(1)} ms`}
            </dd>
          </div>
          <div>
            <dt>Target</dt>
            <dd>{active.targetFps} fps</dd>
          </div>
        </dl>
        {frames?.strained === true ? (
          <p className="note" data-testid="strained">
            This device is not keeping up at {active.label}. A lower level will
            be smoother.
          </p>
        ) : null}
        <p className="note">
          Measured while the stage is drawing — playing an animation or moving
          something. A still scene draws nothing, and has nothing to measure.
        </p>
        <p className="note">
          Quality changes the editor preview only. What you send to air is
          never scaled or softened.
        </p>
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Appearance</h2>
        </div>
        <div className="setting-row">
          <span>
            <strong>Theme</strong>
            <span className="dim">Dark suits a gallery; light suits an office.</span>
          </span>
          <div className="chips">
            {(["dark", "light"] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                className={`chip ${theme === entry ? "on" : ""}`}
                onClick={() => onTheme(entry)}
              >
                {entry === "dark" ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="home-block">
        <div className="block-head">
          <h2>Advanced</h2>
        </div>
        <div className="setting-row">
          <span>
            <strong>Developer mode</strong>
            <span className="dim">
              Shows engine internals and performance tools. Off by default —
              you never need it to make a graphic.
            </span>
          </span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={developerMode}
              onChange={(event) => onDeveloperMode(event.target.checked)}
              aria-label="Developer mode"
            />
            {developerMode ? "On" : "Off"}
          </label>
        </div>
        <div className="setting-row">
          <span>
            <strong>Reset layout</strong>
            <span className="dim">Puts every panel back where it started.</span>
          </span>
          <button type="button" className="chip" onClick={onResetWorkspace}>
            Reset
          </button>
        </div>
      </section>
    </div>
  );
}

/** Installing a theme is an ordinary document edit. Exported for the shell. */
export function applyThemePack(
  document: SceneDocument,
  pack: Pack,
): Transaction | null {
  return installTheme(document, pack);
}

export type { IdFactory };
