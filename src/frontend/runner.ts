/**
 * Opens a terminal tab per host and types the command into each one as soon
 * as it is connected.
 *
 * Everything the run touches goes through `RunnerPorts`, so the whole flow is
 * testable without a shell: the real ports call the SSH Terminal plugin's
 * actions (terminal.open, terminal.listSessions, terminal.sendToSession),
 * which is the only sanctioned way into a live session from another plugin.
 *
 * Tabs are opened one at a time with a gap between them, and that gap is the
 * whole trick. A terminal tab registers its session when it mounts, and
 * Termix mounts a tab when it becomes the active one -- opening eight tabs in
 * the same instant leaves seven that were never shown, hold no session, and
 * can never be typed into. Giving each tab a moment in front is enough: once
 * mounted it stays mounted, keeps its SSH connection in the background, and
 * finishes connecting while the next tabs are being opened. So the handshakes
 * overlap, and a host that is offline costs the run nothing but its own tab.
 */

/** A live terminal session as the SSH Terminal plugin reports it. */
export interface TerminalSessionInfo {
  id: string;
  /** The saved host, or null for a local or quick-connect terminal. */
  hostId: number | null;
  hostName?: string;
  label?: string;
  connected?: boolean;
  visible?: boolean;
}

/** Just enough of a host for a run; the panel passes the shell's record. */
export interface RunnerHost {
  id: string;
  name: string;
  ip?: string;
  username?: string;
  port?: number;
  enableSsh?: boolean;
  /**
   * The shell's own host record, handed back to the terminal unchanged. The
   * terminal needs every field of it (credentials, jump hosts, SSH options),
   * so a run must never rebuild a host from the fields above.
   */
  record?: unknown;
}

export type RunStatus =
  | "pending"
  | "opening"
  | "waiting"
  | "sent"
  | "noSsh"
  | "timeout"
  | "unreachable"
  | "failed"
  | "stopped";

export interface RunRow {
  hostId: string;
  hostName: string;
  status: RunStatus;
  sessionId?: string;
  /** Already translated, for the row's detail line. */
  detail?: string;
}

export interface RunnerPorts {
  /** Opens a new terminal tab on the host. Never reuses an existing one. */
  openTerminal(host: RunnerHost, label?: string): Promise<unknown>;
  listSessions(): Promise<TerminalSessionInfo[]>;
  /** True when the text reached the session. `run` appends the Enter key. */
  send(sessionId: string, text: string, run: boolean): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface RunOptions {
  /** The command for one host, with its variables already filled in. */
  command: (host: RunnerHost) => string;
  /** False pastes the command and leaves the Enter key to the user. */
  run: boolean;
  /** The terminal tab's name. Defaults to the host's own name. */
  label?: (host: RunnerHost) => string;
  /**
   * The gap between opening one tab and the next. Long enough for the tab to
   * mount while it is the active one, short enough that the run feels like
   * one action rather than a queue.
   */
  staggerMs?: number;
  /** How long a tab has to register its session at all. */
  timeoutMs?: number;
  /**
   * How long that session then has to report itself connected. An SSH
   * attempt that fails -- an offline host, a refused port -- leaves the tab
   * sitting there unconnected forever, and the only way to tell that apart
   * from a slow handshake is to stop waiting. These deadlines run next to
   * each other, so one dead host never holds up the rest.
   */
  connectTimeoutMs?: number;
  pollMs?: number;
  /**
   * Waited after a session says it is connected, before the command goes in.
   * The socket is up a moment before the shell has drawn its prompt, and
   * anything typed in between is swallowed by the terminal. It is counted
   * from when the session came up, so a host that connected while later tabs
   * were still opening waits no further.
   */
  settleMs?: number;
  /** Polled while the run works; true ends it and leaves the rest untouched. */
  cancelled?: () => boolean;
  /** Called after every status change, with a fresh array. */
  onUpdate?: (rows: RunRow[]) => void;
}

const DEFAULT_STAGGER_MS = 800;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 12_000;
const DEFAULT_POLL_MS = 200;
const DEFAULT_SETTLE_MS = 900;

/**
 * Only an explicit `false` means "still connecting". A terminal that does not
 * report the flag at all is taken at its word, so a Termix that stops setting
 * it leaves the run working rather than silently empty.
 */
function isUp(session: TerminalSessionInfo): boolean {
  return session.connected !== false;
}

/** What the watcher tracks per host while the run is in flight. */
interface Watch {
  /** When the tab was asked for; the session must appear after this. */
  openedAt: number;
  /** The session this host's tab registered, once it has one. */
  sessionId?: string;
  /** When that session was first seen, for the connect deadline. */
  foundAt?: number;
  /** When it first reported itself up, for the settle delay. */
  upAt?: number;
}

/**
 * Runs `command` on every host, each in its own terminal tab. Resolves with
 * the final rows; a host that fails never stops the others, since the point
 * of the run is that every tab stays open to be read.
 */
export async function runInTerminals(
  hosts: RunnerHost[],
  ports: RunnerPorts,
  options: RunOptions,
): Promise<RunRow[]> {
  const staggerMs = options.staggerMs ?? DEFAULT_STAGGER_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const connectTimeoutMs =
    options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const cancelled = options.cancelled ?? (() => false);

  const rows: RunRow[] = hosts.map((host) => ({
    hostId: host.id,
    hostName: host.name,
    status: "pending",
  }));
  // Sessions already open when the run starts are never typed into: the user
  // asked for fresh terminals, and an old tab may sit at a prompt of its own.
  const claimed = new Set<string>(
    (await ports.listSessions().catch(() => [])).map((session) => session.id),
  );
  const watches = new Map<number, Watch>();

  const set = (index: number, changes: Partial<RunRow>) => {
    rows[index] = { ...rows[index], ...changes };
    options.onUpdate?.([...rows]);
  };

  let opening = true;

  /** Opens the tabs in turn, leaving a gap for each one to mount. */
  const openAll = async (): Promise<void> => {
    try {
      for (const [index, host] of hosts.entries()) {
        if (cancelled()) {
          set(index, { status: "stopped" });
          continue;
        }
        if (host.enableSsh === false) {
          set(index, { status: "noSsh" });
          continue;
        }
        set(index, { status: "opening" });
        try {
          await ports.openTerminal(host, options.label?.(host) ?? host.name);
          watches.set(index, { openedAt: ports.now() });
          set(index, { status: "waiting" });
        } catch (error) {
          set(index, { status: "failed", detail: messageOf(error) });
          continue;
        }
        if (index < hosts.length - 1 && staggerMs > 0) {
          await ports.sleep(staggerMs);
        }
      }
    } finally {
      opening = false;
    }
  };

  /**
   * Watches every tab at once and types into each as soon as it is ready, so
   * the handshakes overlap instead of queueing behind one another.
   */
  const watchAll = async (): Promise<void> => {
    for (;;) {
      const waiting = rows.some((row) => row.status === "waiting");
      if (!opening && !waiting) return;

      if (cancelled()) {
        rows.forEach((row, index) => {
          if (row.status === "waiting" || row.status === "pending") {
            set(index, { status: "stopped" });
          }
        });
        return;
      }

      if (waiting) {
        const sessions: TerminalSessionInfo[] = await ports
          .listSessions()
          .catch(() => []);
        const byId = new Map<string, TerminalSessionInfo>(
          sessions.map((session) => [session.id, session] as const),
        );
        const now = ports.now();

        for (const [index, host] of hosts.entries()) {
          if (rows[index].status !== "waiting") continue;
          const watch = watches.get(index);
          if (!watch) continue;

          if (!watch.sessionId) {
            const found = sessions.find(
              (session) =>
                !claimed.has(session.id) &&
                session.hostId !== null &&
                String(session.hostId) === String(host.id),
            );
            if (found) {
              // Claimed the moment it is found: whatever happens next, this
              // session belongs to this row and no other host may take it.
              claimed.add(found.id);
              watch.sessionId = found.id;
              watch.foundAt = now;
            } else {
              if (now - watch.openedAt >= timeoutMs) {
                set(index, { status: "timeout" });
              }
              continue;
            }
          }

          const session = byId.get(watch.sessionId);
          if (!session) {
            // Gone from the list: the tab was closed, and nothing can reach it.
            set(index, { status: "unreachable", sessionId: watch.sessionId });
            continue;
          }
          if (!isUp(session)) {
            if (now - (watch.foundAt ?? now) >= connectTimeoutMs) {
              // The tab stays open with its own error in it, which is the
              // point: the run moves on and you read afterwards what went
              // wrong where.
              set(index, { status: "unreachable", sessionId: session.id });
            }
            continue;
          }

          watch.upAt ??= now;
          if (now - watch.upAt < settleMs) continue;

          try {
            const sent = await ports.send(
              session.id,
              options.command(host),
              options.run,
            );
            set(index, {
              status: sent ? "sent" : "unreachable",
              sessionId: session.id,
            });
          } catch (error) {
            set(index, {
              status: "failed",
              sessionId: session.id,
              detail: messageOf(error),
            });
          }
        }
      }

      if (!opening && !rows.some((row) => row.status === "waiting")) return;
      await ports.sleep(pollMs);
    }
  };

  await Promise.all([openAll(), watchAll()]);
  return rows;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
