/**
 * Where a scene lives.
 *
 * ============================================================================
 * ONE SEAM, SEVERAL PLACES
 * ============================================================================
 * A scene is a SCENE_FORMAT document and nothing else — `project.ts` is
 * emphatic about that, and it is what makes this possible at all: anywhere
 * that can hold a text file can hold a Streamatrix scene. Drive, Dropbox, a
 * disk, an object store. None of them needs to understand the format.
 *
 * So storage is one narrow interface with several implementations, rather than
 * a Drive button and a Dropbox button and a save routine that grew two extra
 * branches. Adding a place is adding a provider, and nothing above this line
 * learns a new word.
 *
 * ============================================================================
 * WHAT IS HONEST TO SHIP
 * ============================================================================
 * `disk` works today, everywhere, with no account and no configuration — and
 * because Drive and Dropbox both mount a folder on the machine, saving into
 * that folder IS saving to the cloud, with their own sync doing the part they
 * are good at.
 *
 * `drive` and `dropbox` talk to the real APIs and need an OAuth client id,
 * which is an app registration the OWNER of the product has to make; it cannot
 * be invented here. Until one is configured they report themselves
 * unavailable and say why, rather than offering a button that fails after the
 * click. A control that lies is worse than a control that is absent.
 */

export type ProviderId = "disk" | "browser" | "drive" | "dropbox";

export interface StoredScene {
  /** Stable within a provider. Opaque everywhere else. */
  readonly id: string;
  readonly name: string;
  /** ISO 8601, when the provider reports one. */
  readonly savedAt?: string;
}

export interface ProviderStatus {
  readonly id: ProviderId;
  readonly label: string;
  /** One line, shown under the name. Says what it is, not how it works. */
  readonly hint: string;
  /** False when this machine or this build cannot use it at all. */
  readonly supported: boolean;
  /** True once the user has connected an account, where one is needed. */
  readonly connected: boolean;
  /** Present when it is unavailable, and says what would make it available. */
  readonly blocker?: string;
}

export interface StorageProvider {
  readonly status: ProviderStatus;
  /** Asks for whatever access it needs. Returns the new status. */
  connect?(): Promise<ProviderStatus>;
  /** Scenes this provider can offer. Empty is a legitimate answer. */
  list?(): Promise<readonly StoredScene[]>;
  /** The document's JSON. */
  read(scene: StoredScene): Promise<string>;
  /**
   * Writes, and reports where it went.
   *
   * `scene` is absent for "save as", present for "save" — the difference
   * between choosing a place and returning to one.
   */
  write(name: string, json: string, scene?: StoredScene): Promise<StoredScene>;
}

// ---------------------------------------------------------------------------
// The disk
// ---------------------------------------------------------------------------

interface FilePickerWindow {
  showOpenFilePicker?: (options: unknown) => Promise<readonly FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
}

const SCENE_PICKER = {
  types: [
    {
      description: "Streamatrix scene",
      accept: { "application/json": [".json", ".scene.json"] },
    },
  ],
  excludeAcceptAllOption: false,
};

/**
 * The user's own file system, through the File System Access API.
 *
 * ==========================================================================
 * WHY THIS IS THE CLOUD PROVIDER THAT SHIPS FIRST
 * ==========================================================================
 * It needs no account, no client id, no consent screen and no network, and it
 * covers the case most people actually mean: Drive and Dropbox both mount a
 * folder, so saving into it is saving to the cloud and their sync does the
 * hard half.
 *
 * It also gives something the download-a-file approach never could — a HANDLE.
 * Save once, choose the place, and every save after it goes back to the same
 * file. Downloading a fresh copy on every save is how a folder ends up holding
 * `lower-third (7).json`.
 */
class DiskProvider implements StorageProvider {
  readonly #handles = new Map<string, FileSystemFileHandle>();
  #next = 1;

  get status(): ProviderStatus {
    const api = globalThis as unknown as FilePickerWindow;
    const supported = typeof api.showSaveFilePicker === "function";
    return {
      id: "disk",
      label: "This computer",
      hint: "Save into any folder — including a synced Drive or Dropbox one.",
      supported,
      connected: supported,
      ...(supported
        ? {}
        : {
            blocker:
              "This browser cannot open a file picker. Firefox and Safari have not shipped it; Chrome and Edge have.",
          }),
    };
  }

  async read(scene: StoredScene): Promise<string> {
    const handle = this.#handles.get(scene.id);
    if (handle === undefined) throw new Error("That file is no longer open.");
    const file = await handle.getFile();
    return file.text();
  }

  async write(name: string, json: string, scene?: StoredScene): Promise<StoredScene> {
    const api = globalThis as unknown as FilePickerWindow;
    // A known handle means "save"; no handle means "save as". The two are
    // different acts and the difference is exactly whether a picker opens.
    let handle = scene === undefined ? undefined : this.#handles.get(scene.id);
    if (handle === undefined) {
      if (api.showSaveFilePicker === undefined) throw new Error("No file picker here.");
      handle = await api.showSaveFilePicker({ ...SCENE_PICKER, suggestedName: name });
    }
    const writable = await (handle as unknown as {
      createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
    }).createWritable();
    await writable.write(json);
    await writable.close();

    const id = scene?.id ?? `disk_${this.#next++}`;
    this.#handles.set(id, handle);
    return { id, name: handle.name, savedAt: new Date().toISOString() };
  }

  /** Opens a picker and remembers the handle, so later saves return to it. */
  async pick(): Promise<{ scene: StoredScene; json: string } | null> {
    const api = globalThis as unknown as FilePickerWindow;
    if (api.showOpenFilePicker === undefined) return null;
    const [handle] = await api.showOpenFilePicker({ ...SCENE_PICKER, multiple: false });
    if (handle === undefined) return null;
    const id = `disk_${this.#next++}`;
    this.#handles.set(id, handle);
    const file = await handle.getFile();
    return {
      scene: { id, name: handle.name, savedAt: new Date(file.lastModified).toISOString() },
      json: await file.text(),
    };
  }
}

// ---------------------------------------------------------------------------
// The accounts
// ---------------------------------------------------------------------------

export interface CloudCredentials {
  /** OAuth client id, from the app registration. */
  readonly clientId: string;
}

/**
 * Google Drive, over its REST API.
 *
 * ==========================================================================
 * WHY IT REPORTS ITSELF UNAVAILABLE UNTIL CONFIGURED
 * ==========================================================================
 * Drive needs an OAuth client id, and a client id comes from registering the
 * application with Google — a thing only the product's owner can do, and which
 * cannot be invented in a source file.
 *
 * So this is written against the real API and refuses to pretend. Given a
 * client id it works; without one it says exactly what is missing. The
 * alternative — a Connect button that opens a consent screen for an
 * application that does not exist — is a control that lies, which is the one
 * thing this product does not ship.
 *
 * `drive.file` scope, deliberately: it grants access ONLY to files this
 * application created or the user explicitly opened. A broadcast tool asking
 * to read somebody's entire Drive would be refused by any organisation with a
 * security review, and rightly.
 */
class DriveProvider implements StorageProvider {
  #token: string | null = null;
  readonly #credentials: CloudCredentials | null;

  constructor(credentials: CloudCredentials | null) {
    this.#credentials = credentials;
  }

  get status(): ProviderStatus {
    const configured = (this.#credentials?.clientId ?? "").length > 0;
    return {
      id: "drive",
      label: "Google Drive",
      hint: "Scenes in a Drive folder, shared with whoever you already share with.",
      supported: true,
      connected: this.#token !== null,
      ...(configured
        ? {}
        : {
            blocker:
              "Add a Google OAuth client id in Settings. Registering the application is a one-off, and only the account that owns Streamatrix can do it.",
          }),
    };
  }

  async connect(): Promise<ProviderStatus> {
    const clientId = this.#credentials?.clientId ?? "";
    if (clientId.length === 0) return this.status;
    this.#token = await implicitGrant({
      endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
    });
    return this.status;
  }

  async list(): Promise<readonly StoredScene[]> {
    if (this.#token === null) return [];
    const response = await fetch(
      "https://www.googleapis.com/drive/v3/files?q=" +
        encodeURIComponent("mimeType='application/json' and trashed=false") +
        "&fields=files(id,name,modifiedTime)&pageSize=50",
      { headers: { Authorization: `Bearer ${this.#token}` } },
    );
    if (!response.ok) throw new Error("Drive refused the request.");
    const body = (await response.json()) as {
      files?: readonly { id: string; name: string; modifiedTime?: string }[];
    };
    return (body.files ?? []).map((file) => ({
      id: file.id,
      name: file.name,
      ...(file.modifiedTime === undefined ? {} : { savedAt: file.modifiedTime }),
    }));
  }

  async read(scene: StoredScene): Promise<string> {
    if (this.#token === null) throw new Error("Not connected to Drive.");
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(scene.id)}?alt=media`,
      { headers: { Authorization: `Bearer ${this.#token}` } },
    );
    if (!response.ok) throw new Error("Drive could not return that scene.");
    return response.text();
  }

  async write(name: string, json: string, scene?: StoredScene): Promise<StoredScene> {
    if (this.#token === null) throw new Error("Not connected to Drive.");
    // Multipart, because a Drive file is metadata plus content and creating it
    // in two requests leaves an untitled file behind when the second fails.
    const boundary = "streamatrix";
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name, mimeType: "application/json" })}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;

    const url =
      scene === undefined
        ? "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
        : `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(scene.id)}?uploadType=multipart`;

    const response = await fetch(url, {
      method: scene === undefined ? "POST" : "PATCH",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!response.ok) throw new Error("Drive refused the save.");
    const saved = (await response.json()) as { id: string; name: string };
    return { id: saved.id, name: saved.name, savedAt: new Date().toISOString() };
  }
}

/**
 * Dropbox, over its REST API.
 *
 * Same bargain as Drive: real endpoints, and honest about needing an app key.
 * Dropbox's API is simpler — a path is the identity, so there is no separate
 * create and update.
 */
class DropboxProvider implements StorageProvider {
  #token: string | null = null;
  readonly #credentials: CloudCredentials | null;

  constructor(credentials: CloudCredentials | null) {
    this.#credentials = credentials;
  }

  get status(): ProviderStatus {
    const configured = (this.#credentials?.clientId ?? "").length > 0;
    return {
      id: "dropbox",
      label: "Dropbox",
      hint: "Scenes in a Dropbox folder, versioned by Dropbox's own history.",
      supported: true,
      connected: this.#token !== null,
      ...(configured
        ? {}
        : { blocker: "Add a Dropbox app key in Settings. It is a one-off registration." }),
    };
  }

  async connect(): Promise<ProviderStatus> {
    const clientId = this.#credentials?.clientId ?? "";
    if (clientId.length === 0) return this.status;
    this.#token = await implicitGrant({
      endpoint: "https://www.dropbox.com/oauth2/authorize",
      clientId,
      scope: "files.content.write files.content.read",
    });
    return this.status;
  }

  async list(): Promise<readonly StoredScene[]> {
    if (this.#token === null) return [];
    const response = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "", recursive: false }),
    });
    if (!response.ok) throw new Error("Dropbox refused the request.");
    const body = (await response.json()) as {
      entries?: readonly { ".tag": string; name: string; path_lower: string; server_modified?: string }[];
    };
    return (body.entries ?? [])
      .filter((entry) => entry[".tag"] === "file" && entry.name.endsWith(".json"))
      .map((entry) => ({
        id: entry.path_lower,
        name: entry.name,
        ...(entry.server_modified === undefined ? {} : { savedAt: entry.server_modified }),
      }));
  }

  async read(scene: StoredScene): Promise<string> {
    if (this.#token === null) throw new Error("Not connected to Dropbox.");
    const response = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        "Dropbox-API-Arg": JSON.stringify({ path: scene.id }),
      },
    });
    if (!response.ok) throw new Error("Dropbox could not return that scene.");
    return response.text();
  }

  async write(name: string, json: string, scene?: StoredScene): Promise<StoredScene> {
    if (this.#token === null) throw new Error("Not connected to Dropbox.");
    const path = scene?.id ?? `/${name}`;
    const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", mute: true }),
      },
      body: json,
    });
    if (!response.ok) throw new Error("Dropbox refused the save.");
    const saved = (await response.json()) as { name: string; path_lower: string };
    return { id: saved.path_lower, name: saved.name, savedAt: new Date().toISOString() };
  }
}

/**
 * An OAuth implicit grant, in a popup.
 *
 * Implicit rather than the authorisation-code flow, because the code flow
 * needs a CLIENT SECRET and a server to hold it — and a secret shipped to a
 * browser is not a secret. A broadcast tool that runs entirely in the page has
 * to use the flow designed for that, and accept its shorter-lived tokens.
 *
 * The token is never persisted. Somebody who closes the tab is disconnected,
 * which is the correct default for a credential on a shared gallery machine.
 */
async function implicitGrant(options: {
  readonly endpoint: string;
  readonly clientId: string;
  readonly scope: string;
}): Promise<string> {
  const redirect = `${globalThis.location.origin}/oauth`;
  const url =
    `${options.endpoint}?client_id=${encodeURIComponent(options.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}` +
    `&response_type=token&scope=${encodeURIComponent(options.scope)}`;

  const popup = globalThis.open(url, "streamatrix-auth", "width=520,height=640");
  if (popup === null) throw new Error("The sign-in window was blocked.");

  return new Promise<string>((resolve, reject) => {
    const timer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(timer);
          reject(new Error("Sign-in was cancelled."));
          return;
        }
        // Same-origin only once the provider has redirected back; before that
        // reading `location` throws, which is the browser doing its job.
        const hash = popup.location.hash;
        if (hash.length === 0) return;
        const token = new URLSearchParams(hash.slice(1)).get("access_token");
        clearInterval(timer);
        popup.close();
        if (token === null) reject(new Error("No token came back."));
        else resolve(token);
      } catch {
        // Still on the provider's origin. Keep waiting.
      }
    }, 400);
  });
}

// ---------------------------------------------------------------------------

export interface StorageOptions {
  readonly drive?: CloudCredentials | null;
  readonly dropbox?: CloudCredentials | null;
}

/** Every place a scene can live, in the order they are offered. */
export function createStorage(options: StorageOptions = {}): {
  readonly disk: DiskProvider;
  readonly providers: readonly StorageProvider[];
} {
  const disk = new DiskProvider();
  return {
    disk,
    providers: [
      disk,
      new DriveProvider(options.drive ?? null),
      new DropboxProvider(options.dropbox ?? null),
    ],
  };
}
