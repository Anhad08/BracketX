import { useRef, useState } from "react";
import type { ProviderStatus } from "../studio/storage";
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
import { RENDERERS, rendererSpec, type RendererChoice } from "../studio/renderer";
import type { DeviceInput } from "../studio/device";
import { VOICE_NAMES, VOICES, type VoiceName } from "../studio/sound";
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

  /**
   * How many packs the QUERY alone finds, ignoring the kind filter.
   *
   * This is what makes the empty state actionable rather than a dead end: when a
   * search inside "Themes" finds nothing, the useful fact is that four packs
   * match everywhere else — and the fix is one press, not a retyped query.
   */
  const acrossEverything = PACKS.filter((pack) =>
    needle.length === 0
      ? true
      : [pack.name, pack.description, ...pack.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle),
  ).length;

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

      {/* THE EMPTY STATE IS SPECIFIED, AND IT WAS MISSING.
          Volume One §States writes this one out in full — "Nothing matches
          'esports' · 4 packages match in Marketplace instead", with a way on and
          a way back. Filtering the Marketplace to nothing previously showed an
          EMPTY GRID: no words, no count, no action. Law 7 asks "what now?" and a
          blank area answers nothing.

          The second line is adapted, deliberately and not silently: the
          specified copy offers the Marketplace as the place to look instead,
          which is nonsense when you are already standing in it. The STRUCTURE is
          what the Design OS specifies — the miss, a count of what would match,
          and one press to get there — so the count here is what the query finds
          once the kind filter is dropped. */}
      {shown.length === 0 ? (
        <div className="empty-filtered" data-testid="marketplace-empty">
          <p className="empty-title">Nothing matches “{query.trim()}”</p>
          <p className="note">
            {kind !== "all" && acrossEverything > 0
              ? `${acrossEverything} ${acrossEverything === 1 ? "pack" : "packs"} match outside ${KIND_LABEL[kind]}.`
              : "No pack in the Marketplace carries that word."}
          </p>
          <div className="empty-actions">
            {kind !== "all" && acrossEverything > 0 ? (
              <button
                type="button"
                className="chip primary"
                data-testid="empty-search-everything"
                onClick={() => setKind("all")}
              >
                Search Marketplace
              </button>
            ) : null}
            <button
              type="button"
              className="chip"
              data-testid="empty-clear-filter"
              onClick={() => {
                setQuery("");
                setKind("all");
              }}
            >
              Clear filter
            </button>
          </div>
        </div>
      ) : null}

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
  /** Every place a scene can live. */
  readonly places: readonly ProviderStatus[];
  readonly driveClientId: string;
  readonly dropboxAppKey: string;
  readonly onCloudKeys: (keys: { driveClientId?: string; dropboxAppKey?: string }) => void;
  /** Asks a provider for access. */
  readonly onConnect: (id: string) => void;
  readonly theme: "dark" | "light";
  readonly onTheme: (theme: "dark" | "light") => void;
  readonly developerMode: boolean;
  readonly onDeveloperMode: (on: boolean) => void;
  readonly onResetWorkspace: () => void;
  readonly quality: QualityChoice;
  readonly onQuality: (choice: QualityChoice) => void;
  /** The renderer this session STARTED on, which may differ from the choice. */
  readonly renderer: RendererChoice;
  readonly activeRenderer: RendererChoice;
  readonly onRenderer: (choice: RendererChoice) => void;
  readonly device: DeviceInput;
  /** What the last few seconds actually measured. Null before any frame. */
  readonly frames: FrameReport | null;
  readonly sound: boolean;
  readonly onSound: (on: boolean) => void;
  /** Auditions a voice. Does nothing while sound is off, by design. */
  readonly onAudition: (voice: VoiceName) => void;
  /** True while the desk is live, when the interface is ducked. */
  readonly onAir: boolean;
}

export function Settings({
  places,
  driveClientId,
  dropboxAppKey,
  onCloudKeys,
  onConnect,
  theme,
  onTheme,
  developerMode,
  onDeveloperMode,
  onResetWorkspace,
  quality,
  onQuality,
  renderer,
  activeRenderer,
  onRenderer,
  device,
  frames,
  sound,
  onSound,
  onAudition,
  onAir,
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

      {/* RENDERER. The founder's decision: a second selectable backend, with
          three as the default.

          This is the only control in the product that names a rendering
          library, and it is in Settings rather than anywhere near the Stage
          for that reason — a designer making a lower third should never have
          to have an opinion about it.

          The choice takes effect on the next start, and the panel SAYS SO. A
          backend binds to its canvas for the session's lifetime (MirrorBackend
          C2), so applying it live would rebuild every GPU resource while a
          graphic might be on air. A setting that appears to do nothing is
          worse than one that says when it lands. */}
      <section className="home-block">
        <div className="block-head">
          <h2>Renderer</h2>
          <span className="dim" data-testid="renderer-active">
            {renderer === activeRenderer
              ? `Running on ${rendererSpec(activeRenderer).label}`
              : `Running on ${rendererSpec(activeRenderer).label} — reload to use ${rendererSpec(renderer).label}`}
          </span>
        </div>

        <div className="quality-grid">
          {RENDERERS.map((spec) => (
            <button
              key={spec.id}
              type="button"
              className={`quality-card ${renderer === spec.id ? "on" : ""}`}
              data-testid={`renderer-${spec.id}`}
              aria-pressed={renderer === spec.id}
              onClick={() => onRenderer(spec.id)}
            >
              <strong>{spec.label}</strong>
              <span className="dim tiny">{spec.hint}</span>
            </button>
          ))}
        </div>

        {renderer === activeRenderer ? null : (
          <p className="note" data-testid="renderer-pending">
            Reload Streamatrix to draw with {rendererSpec(renderer).label}.
          </p>
        )}
      </section>

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

      {/* SOUND. Off by default and remembered — a gallery has its own audio
          discipline, and an unexpected noise on a live desk is a fault. */}
      <section className="home-block">
        <div className="block-head">
          <h2>Sound</h2>
          <span className="dim">Nine voices · synthesised, no files</span>
        </div>

        <label className="sound-switch">
          <input
            type="checkbox"
            checked={sound}
            onChange={(event) => onSound(event.target.checked)}
            data-testid="sound-toggle"
          />
          <span>
            <strong>Interface sound</strong>
            <span className="dim tiny">
              Short, dry, mechanical. A sound only ever confirms something you
              can already see.
            </span>
          </span>
        </label>

        <div className="voice-grid" data-testid="voices">
          {VOICE_NAMES.map((name) => (
            <button
              key={name}
              type="button"
              className="voice"
              data-testid={`voice-${name}`}
              disabled={!sound}
              onClick={() => onAudition(name)}
              title={sound ? `Play ${VOICES[name].label}` : "Turn sound on to audition"}
            >
              <strong>{VOICES[name].label}</strong>
              <span className="dim tiny">{VOICES[name].when}</span>
            </button>
          ))}
        </div>

        {onAir ? (
          <p className="note" data-testid="ducked">
            Ducked. While you are on air the interface is silent — except
            Attention, which has to survive or it is not an alert.
          </p>
        ) : null}
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

      {/* ==================================================================
          WHERE SCENES LIVE
          ==================================================================
          A scene is a SCENE_FORMAT document and nothing else, so anywhere
          that holds a text file can hold one. This lists the places, and it
          is honest about the ones that are not ready: a provider that needs
          an app registration SAYS so rather than offering a button that
          fails after the click. */}
      <section className="home-block" aria-label="Storage">
        <div className="block-head">
          <h2>Storage</h2>
        </div>
        {places.map((place) => (
          <div className="setting-row" key={place.id} data-testid={`place-${place.id}`}>
            <span>
              <strong>{place.label}</strong>
              <span className="dim">
                {place.blocker ?? place.hint}
              </span>
            </span>
            {place.blocker !== undefined ? (
              <span className="dim tiny" data-testid={`place-blocked-${place.id}`}>
                needs setting up
              </span>
            ) : place.connected ? (
              <span className="ok tiny" data-testid={`place-ready-${place.id}`}>
                ready
              </span>
            ) : (
              <button
                type="button"
                className="chip"
                data-testid={`place-connect-${place.id}`}
                onClick={() => onConnect(place.id)}
              >
                Connect
              </button>
            )}
          </div>
        ))}

        {/* The keys, in the open. Registering the application is the owner's
            act — a client id cannot be invented in a source file — so the
            product asks for it plainly rather than shipping a dead button. */}
        <label className="setting-row">
          <span>
            <strong>Google client id</strong>
            <span className="dim">From the Google Cloud console, for Drive.</span>
          </span>
          <input
            className="field"
            defaultValue={driveClientId}
            data-testid="drive-client-id"
            placeholder="…apps.googleusercontent.com"
            onBlur={(event) => onCloudKeys({ driveClientId: event.target.value.trim() })}
          />
        </label>
        <label className="setting-row">
          <span>
            <strong>Dropbox app key</strong>
            <span className="dim">From the Dropbox app console.</span>
          </span>
          <input
            className="field"
            defaultValue={dropboxAppKey}
            data-testid="dropbox-app-key"
            onBlur={(event) => onCloudKeys({ dropboxAppKey: event.target.value.trim() })}
          />
        </label>
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
