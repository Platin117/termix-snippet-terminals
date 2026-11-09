import { invokeAction } from "@termix-ssh/plugin-sdk/frontend";
import type { PluginHostRecord } from "@termix-ssh/plugin-sdk/frontend";
import { createPorts } from "./ports";
import { runInTerminals, type RunRow, type RunnerHost } from "./runner";
import { extractSecretNames, resolveCommand } from "./variables";
import { hostsFor, loadStore, runOptions } from "./store";

export interface Snippet {
  id: number | string;
  name: string;
  content: string;
  isNote?: boolean;
}

export type RunOutcome =
  | { kind: "ran"; rows: RunRow[] }
  | { kind: "noHosts" }
  | { kind: "secrets"; names: string[] };

/** Every snippet the user owns, or an empty list when Snippets is not installed. */
export async function listSnippets(): Promise<Snippet[]> {
  const list = await invokeAction("snippets.list").catch(() => undefined);
  return Array.isArray(list) ? (list as Snippet[]) : [];
}

export function toRunnerHost(host: PluginHostRecord): RunnerHost {
  return {
    id: host.id,
    name: host.name,
    ip: host.ip,
    username: host.username,
    port: host.port,
    enableSsh: host.enableSsh,
    record: host,
  };
}

/**
 * Runs one snippet on the hosts it is remembered for: a terminal tab per
 * host, the command typed in once that tab is connected.
 *
 * `hosts` is the shell's host list, so the caller decides how fresh it is --
 * the panel passes what it already has, the palette fetches it.
 */
export async function runSnippet(options: {
  snippet: Snippet;
  hosts: PluginHostRecord[];
  hostIds?: string[];
  inputValues?: Record<string, string>;
  onUpdate?: (rows: RunRow[]) => void;
  /** Polled between hosts; true leaves the remaining hosts untouched. */
  cancelled?: () => boolean;
}): Promise<RunOutcome> {
  await loadStore();
  const secrets = extractSecretNames(options.snippet.content);
  if (secrets.length > 0) return { kind: "secrets", names: secrets };

  const wanted = options.hostIds ?? hostsFor(options.snippet.id);
  // Keep the saved order, and drop ids whose host is gone.
  const byId = new Map(options.hosts.map((host) => [host.id, host]));
  const targets = wanted
    .map((id) => byId.get(id))
    .filter((host): host is PluginHostRecord => Boolean(host))
    .map(toRunnerHost);
  if (targets.length === 0) return { kind: "noHosts" };

  const { pasteOnly, staggerMs } = runOptions();
  const rows = await runInTerminals(targets, createPorts(), {
    command: (host) =>
      resolveCommand(
        options.snippet.content,
        {
          ip: host.ip,
          username: host.username,
          port: host.port,
          name: host.name,
        },
        options.inputValues ?? {},
      ),
    run: !pasteOnly && !options.snippet.isNote,
    // Host first: the tab bar is narrow and cuts names off at the end, so
    // the machine stays readable when the snippet's name does not.
    label: (host) => `${host.name} \u00b7 ${options.snippet.name}`,
    staggerMs,
    cancelled: options.cancelled,
    onUpdate: options.onUpdate,
  });
  return { kind: "ran", rows };
}

export function countSent(rows: RunRow[]): number {
  return rows.filter((row) => row.status === "sent").length;
}
