import {
  getPluginUserSettings,
  updatePluginUserSettings,
} from "@termix-ssh/plugin-sdk/ui";

/**
 * Which hosts a snippet runs on, per snippet.
 *
 * The Snippets plugin keeps its own list of target hosts per snippet, but it
 * never hands it out: neither `snippets.list` nor the `snippets.access`
 * service carries it, and another plugin's host settings are stripped from
 * every host record a plugin sees. So this plugin remembers the choice
 * itself, once per snippet, in its own user settings -- which live on the
 * server, so the choice follows the account to the phone and the other
 * desktop rather than sitting in one browser.
 *
 * One module-level store rather than state per component: the panel and the
 * command palette both read it, and a run started from the palette must see
 * what the panel saved a second ago.
 */

const PLUGIN_ID = "snippet-terminals";
const KEY = "hostsBySnippet";
const OPTIONS_KEY = "runOptions";

export interface RunOptionsValue {
  pasteOnly: boolean;
  /**
   * The gap between opening one terminal tab and the next, in milliseconds.
   * How long a tab needs in front before it is mounted and connecting is a
   * property of the machine, not of this plugin, so it is a dial rather than
   * a constant.
   */
  staggerMs: number;
}

const DEFAULT_OPTIONS: RunOptionsValue = { pasteOnly: false, staggerMs: 800 };

export const STAGGER_CHOICES = [300, 500, 800, 1200] as const;

interface Store {
  hosts: Record<string, string[]>;
  options: RunOptionsValue;
  loaded: boolean;
}

let store: Store = { hosts: {}, options: DEFAULT_OPTIONS, loaded: false };
let reading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Store): void {
  store = next;
  for (const listener of [...listeners]) listener();
}

/** A stored value that was never written, or written by an older version. */
function readHosts(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(ids)) {
      out[key] = ids.filter((id): id is string => typeof id === "string");
    }
  }
  return out;
}

function readOptions(value: unknown): RunOptionsValue {
  if (!value || typeof value !== "object") return DEFAULT_OPTIONS;
  const raw = value as Record<string, unknown>;
  return {
    pasteOnly:
      typeof raw.pasteOnly === "boolean"
        ? raw.pasteOnly
        : DEFAULT_OPTIONS.pasteOnly,
    staggerMs:
      typeof raw.staggerMs === "number" &&
      raw.staggerMs >= 0 &&
      raw.staggerMs <= 5000
        ? raw.staggerMs
        : DEFAULT_OPTIONS.staggerMs,
  };
}

/** Reads once and keeps the result; later calls get the same promise. */
export function loadStore(): Promise<void> {
  if (store.loaded) return Promise.resolve();
  if (reading) return reading;
  reading = getPluginUserSettings(PLUGIN_ID)
    .then((values) =>
      publish({
        hosts: readHosts(values[KEY]),
        options: readOptions(values[OPTIONS_KEY]),
        loaded: true,
      }),
    )
    .catch(() => publish({ ...store, loaded: true }))
    .finally(() => {
      reading = null;
    });
  return reading;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot(): Store {
  return store;
}

export function hostsFor(snippetId: string | number): string[] {
  return store.hosts[String(snippetId)] ?? [];
}

export function runOptions(): RunOptionsValue {
  return store.options;
}

/** Saves the hosts for one snippet. Shows the change at once, puts it back if the server refuses. */
export function setHostsFor(
  snippetId: string | number,
  hostIds: string[],
): Promise<void> {
  const before = store;
  const hosts = { ...store.hosts, [String(snippetId)]: hostIds };
  publish({ ...store, hosts, loaded: true });
  return updatePluginUserSettings(PLUGIN_ID, { [KEY]: hosts })
    .then(() => undefined)
    .catch((error: unknown) => {
      publish(before);
      throw error;
    });
}

export function setRunOptions(options: RunOptionsValue): Promise<void> {
  const before = store;
  publish({ ...store, options, loaded: true });
  return updatePluginUserSettings(PLUGIN_ID, { [OPTIONS_KEY]: options })
    .then(() => undefined)
    .catch((error: unknown) => {
      publish(before);
      throw error;
    });
}

/** Drops hosts that no longer exist from every snippet that remembered them. */
export function forgetUnknownHosts(existingHostIds: string[]): void {
  const keep = new Set(existingHostIds);
  let changed = false;
  const hosts: Record<string, string[]> = {};
  for (const [snippetId, ids] of Object.entries(store.hosts)) {
    const kept = ids.filter((id) => keep.has(id));
    if (kept.length !== ids.length) changed = true;
    hosts[snippetId] = kept;
  }
  if (!changed) return;
  publish({ ...store, hosts });
  void updatePluginUserSettings(PLUGIN_ID, { [KEY]: hosts }).catch(() => {});
}

/** Drops what was remembered for snippets that no longer exist. */
export function forgetMissing(existingIds: Array<string | number>): void {
  const keep = new Set(existingIds.map(String));
  const hosts = Object.fromEntries(
    Object.entries(store.hosts).filter(([id]) => keep.has(id)),
  );
  if (Object.keys(hosts).length === Object.keys(store.hosts).length) return;
  publish({ ...store, hosts });
  void updatePluginUserSettings(PLUGIN_ID, { [KEY]: hosts }).catch(() => {});
}
