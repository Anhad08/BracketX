/**
 * The document store — Studio's single source of truth for edits.
 *
 * ============================================================================
 * THERE IS NO SECOND UNDO IMPLEMENTATION
 * ============================================================================
 * Every operation in the engine carries enough prior state to invert itself,
 * and `invertTransaction` reverses the whole batch in the right order. So undo
 * here is a STACK and nothing else:
 *
 *   undo   apply invertTransaction(t)
 *   redo   apply t
 *
 * No snapshots, no diffing, no shadow document. An editor that kept its own
 * history would be a second definition of what an edit is, and the two would
 * disagree the first time the engine gained an operation Studio did not know
 * about — which is exactly the failure mode RFC-002 §6 exists to prevent.
 *
 * ============================================================================
 * WHY THE HOST IS THE ONE THAT APPLIES
 * ============================================================================
 * `SceneHost.apply` mutates the document AND projects it in the order
 * ENGINE_RECONCILIATION §1.5 fixes. Studio never applies a transaction to its
 * own copy and hands the result over — that would be two documents, and the
 * one on screen would be whichever won the race.
 */
import { invertTransaction, type SceneDocument, type Transaction } from "@bracketx/engine-scene";
import type { ProjectionReport, SceneHost } from "@bracketx/engine-host";

/** History depth. Bounded: an editor open all day must not grow without limit. */
export const HISTORY_LIMIT = 200;

export interface HistoryEntry {
  readonly transaction: Transaction;
  readonly label: string;
}

export type StoreListener = (store: DocumentStore) => void;

export class DocumentStore {
  readonly host: SceneHost;

  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #savedAt = 0;
  #revision = 0;
  /**
   * The projection an edit produced.
   *
   * `SceneHost.lastReport` is the last RENDER's, and a frame that projected
   * nothing leaves none behind — so it cannot answer "did that reorder recreate
   * anything", which is the question an editor most needs to ask.
   */
  #lastReport: ProjectionReport | null = null;
  #listeners = new Set<StoreListener>();

  constructor(host: SceneHost) {
    this.host = host;
  }

  get document(): SceneDocument {
    const document = this.host.document;
    if (document === null) throw new Error("no document is loaded");
    return document;
  }

  /**
   * Bumped on every change. What React re-renders on.
   *
   * A counter rather than the document object, because a transaction that
   * changes only runtime-visible state (a variable default reaching the
   * runtime) can leave the document reference intact while the picture moves.
   */
  get revision(): number {
    return this.#revision;
  }

  /**
   * Applies a transaction and pushes it onto the undo stack.
   *
   * A null transaction is a no-op and is NOT recorded — the editing functions
   * return null when an edit would change nothing, and a history full of
   * no-ops makes undo feel broken long before it is.
   */
  apply(transaction: Transaction | null): boolean {
    if (transaction === null || transaction.operations.length === 0) return false;

    this.#lastReport = this.host.apply(transaction);
    this.#undo.push({ transaction, label: transaction.label });
    if (this.#undo.length > HISTORY_LIMIT) {
      this.#undo.shift();
      // The saved marker moves with the window, or a trimmed history would
      // make a saved document report itself dirty forever.
      this.#savedAt = Math.max(0, this.#savedAt - 1);
    }
    // A new edit invalidates the redo branch. Standard, and worth stating:
    // keeping it would mean redo could apply a transaction whose prior state
    // no longer exists, and its inverse would then be wrong.
    this.#redo = [];
    this.#changed();
    return true;
  }

  /**
   * Applies without recording.
   *
   * Two uses, and they are the same idea. Loading a document is not an edit.
   * NEITHER IS MOVING THE CAMERA.
   *
   * Undo belongs to the WORK, not to the view. Pressing Ctrl+Z after nudging
   * a box must give back the box — if it gave back the camera angle instead,
   * a designer who orbited three times to check a logo would have to press
   * undo four times to reverse one mistake, and would watch the scene swing
   * about while doing it. That is not undo, it is time travel.
   *
   * The camera still changes the document, so it saves with the graphic and
   * goes to air with it. It simply does not occupy a step in the history.
   */
  applySilently(transaction: Transaction): void {
    this.#lastReport = this.host.apply(transaction);
    this.#changed();
  }

  /** What the most recent edit projected. Null before the first one. */
  get lastReport(): ProjectionReport | null {
    return this.#lastReport;
  }

  undo(): boolean {
    const entry = this.#undo.pop();
    if (entry === undefined) return false;
    this.host.apply(invertTransaction(entry.transaction));
    this.#redo.push(entry);
    this.#changed();
    return true;
  }

  redo(): boolean {
    const entry = this.#redo.pop();
    if (entry === undefined) return false;
    this.host.apply(entry.transaction);
    this.#undo.push(entry);
    this.#changed();
    return true;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  get undoLabel(): string | null {
    return this.#undo.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.#redo.at(-1)?.label ?? null;
  }

  get depth(): number {
    return this.#undo.length;
  }

  /**
   * True when the document differs from the last save.
   *
   * Measured by history POSITION, not by comparing documents. Undoing back to
   * where you saved must clear the dirty flag — a byte comparison would do that
   * too but would cost a full canonicalisation on every keystroke, and a
   * position comparison is exact for the same reason the undo stack is.
   */
  get dirty(): boolean {
    return this.#undo.length !== this.#savedAt;
  }

  markSaved(): void {
    this.#savedAt = this.#undo.length;
    this.#changed();
  }

  /** After a load: the new document has no history of its own. */
  reset(): void {
    this.#undo = [];
    this.#redo = [];
    this.#savedAt = 0;
    this.#changed();
  }

  /** The recent history, newest first. The palette and the status bar read it. */
  history(count = 20): readonly HistoryEntry[] {
    return [...this.#undo].reverse().slice(0, count);
  }

  subscribe(listener: StoreListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    this.#revision += 1;
    for (const listener of this.#listeners) listener(this);
  }
}
