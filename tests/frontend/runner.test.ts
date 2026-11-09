import { describe, expect, it } from "vitest";
import {
  runInTerminals,
  type RunnerHost,
  type RunnerPorts,
  type TerminalSessionInfo,
} from "../../src/frontend/runner";
import { extractInputs, resolveCommand } from "../../src/frontend/variables";

/**
 * A terminal plugin that opens tabs on demand.
 *
 * `connectAfter` is how many milliseconds of fake time a session stays
 * unconnected after its tab was opened, which is what an SSH handshake looks
 * like to the runner. The clock only moves when something sleeps, so a test
 * costs no real time.
 */
function fakeTerminals(
  options: {
    connectAfter?: number;
    failHosts?: string[];
    neverConnect?: string[];
  } = {},
) {
  const sessions: TerminalSessionInfo[] = [];
  const connectAt = new Map<string, number>();
  const opens: Array<{ hostId: string; at: number }> = [];
  const sent: Array<{ sessionId: string; text: string; run: boolean; at: number }> = [];
  let nextOverride: Partial<TerminalSessionInfo> | null = null;
  let clock = 0;
  let nextId = 1;

  const ports: RunnerPorts = {
    async openTerminal(host: RunnerHost) {
      if (options.failHosts?.includes(host.id)) throw new Error("boom");
      opens.push({ hostId: host.id, at: clock });
      const id = `s${nextId++}`;
      const extra = nextOverride ?? {};
      nextOverride = null;
      sessions.push({ id, hostId: Number(host.id), connected: false, ...extra });
      if (!("connected" in extra) && !options.neverConnect?.includes(host.id)) {
        connectAt.set(id, clock + (options.connectAfter ?? 0));
      }
      return undefined;
    },
    async listSessions() {
      for (const session of sessions) {
        const due = connectAt.get(session.id);
        if (due !== undefined && clock >= due) {
          session.connected = true;
          connectAt.delete(session.id);
        }
      }
      return sessions.map((session) => ({ ...session }));
    },
    async send(sessionId, text, run) {
      sent.push({ sessionId, text, run, at: clock });
      return true;
    },
    async sleep(ms) {
      clock += ms;
    },
    now: () => clock,
  };

  return {
    ports,
    sent,
    opens,
    sessions,
    elapsed: () => clock,
    seed: (session: TerminalSessionInfo) => sessions.push(session),
    seedNext: (changes: Partial<TerminalSessionInfo>) => {
      nextOverride = changes;
    },
  };
}

const host = (id: string, name = `host-${id}`): RunnerHost => ({
  id,
  name,
  ip: `10.0.0.${id}`,
});

describe("runInTerminals", () => {
  it("opens a terminal per host and types the command into each", async () => {
    const fake = fakeTerminals({ connectAfter: 500 });
    const rows = await runInTerminals([host("1"), host("2")], fake.ports, {
      command: (target) => `uptime # ${target.name}`,
      run: true,
      staggerMs: 800,
      settleMs: 0,
    });

    expect(rows.map((row) => row.status)).toEqual(["sent", "sent"]);
    expect(new Set(fake.sent.map((entry) => entry.sessionId)).size).toBe(2);
    expect(fake.sent[0].run).toBe(true);
    expect(fake.sent.map((entry) => entry.text)).toContain("uptime # host-2");
  });

  it("leaves a gap between one tab and the next", async () => {
    // A tab registers its session only while it is mounted, and Termix
    // mounts the tab in front. Without the gap the later tabs are never
    // shown, hold no session, and can never be typed into.
    const fake = fakeTerminals();
    await runInTerminals([host("1"), host("2"), host("3")], fake.ports, {
      command: () => "uptime",
      run: true,
      staggerMs: 800,
      settleMs: 0,
    });

    expect(fake.opens.map((entry) => entry.hostId)).toEqual(["1", "2", "3"]);
    expect(fake.opens[1].at - fake.opens[0].at).toBeGreaterThanOrEqual(800);
    expect(fake.opens[2].at - fake.opens[1].at).toBeGreaterThanOrEqual(800);
  });

  it("lets the handshakes overlap instead of queueing them", async () => {
    // Four hosts that each take three seconds. One after another that would
    // be twelve; opened on top of each other it is about three.
    const fake = fakeTerminals({ connectAfter: 3000 });
    const hosts = [host("1"), host("2"), host("3"), host("4")];
    const rows = await runInTerminals(hosts, fake.ports, {
      command: () => "uptime",
      run: true,
      staggerMs: 800,
      settleMs: 0,
      pollMs: 200,
    });

    expect(rows.every((row) => row.status === "sent")).toBe(true);
    expect(fake.elapsed()).toBeLessThan(3000 + 4 * 800);
  });

  it("moves on from a host that never connects, without holding up the rest", async () => {
    // The offline host's tab is there and stays unconnected -- an SSH error
    // looks exactly like a handshake that never ends.
    const fake = fakeTerminals({ connectAfter: 300, neverConnect: ["2"] });
    const rows = await runInTerminals(
      [host("1"), host("2"), host("3")],
      fake.ports,
      {
        command: () => "uptime",
        run: true,
        staggerMs: 500,
        settleMs: 0,
        connectTimeoutMs: 4000,
        pollMs: 200,
      },
    );

    expect(rows.map((row) => row.status)).toEqual([
      "sent",
      "unreachable",
      "sent",
    ]);
    // Nothing is typed into a terminal that never came up.
    expect(fake.sent).toHaveLength(2);
    // The dead host costs its own deadline, not everyone else's.
    expect(fake.elapsed()).toBeLessThan(4000 + 3 * 500 + 1000);
  });

  it("waits for the prompt, counting from when the session came up", async () => {
    const fake = fakeTerminals({ connectAfter: 200 });
    await runInTerminals([host("1")], fake.ports, {
      command: () => "uptime",
      run: true,
      staggerMs: 0,
      settleMs: 900,
      pollMs: 200,
    });

    // The socket is up before the shell has drawn its prompt; anything typed
    // in between is swallowed.
    expect(fake.sent[0].at).toBeGreaterThanOrEqual(200 + 900);
  });

  it("never types into a terminal that was already open", async () => {
    const fake = fakeTerminals();
    fake.seed({ id: "old", hostId: 1, connected: true });

    await runInTerminals([host("1")], fake.ports, {
      command: () => "uptime",
      run: true,
      staggerMs: 0,
      settleMs: 0,
    });

    expect(fake.sent.map((entry) => entry.sessionId)).toEqual(["s1"]);
  });

  it("treats a terminal that never reports the flag as up", async () => {
    const fake = fakeTerminals();
    // A Termix that stops setting `connected` must not silence every run.
    fake.seedNext({ connected: undefined });

    const rows = await runInTerminals([host("1")], fake.ports, {
      command: () => "uptime",
      run: true,
      staggerMs: 0,
      settleMs: 0,
    });

    expect(rows[0].status).toBe("sent");
    expect(fake.sent).toHaveLength(1);
  });

  it("gives up on a host whose tab never registers a session", async () => {
    const fake = fakeTerminals();
    const openTerminal = fake.ports.openTerminal.bind(fake.ports);
    fake.ports.openTerminal = async (target) => {
      if (target.id === "1") return undefined; // a tab that never mounts
      return openTerminal(target);
    };

    const rows = await runInTerminals([host("1"), host("2")], fake.ports, {
      command: () => "uptime",
      run: true,
      staggerMs: 0,
      settleMs: 0,
      timeoutMs: 2000,
      pollMs: 200,
    });

    expect(rows.map((row) => row.status)).toEqual(["timeout", "sent"]);
  });

  it("skips a host with SSH switched off and reports why", async () => {
    const fake = fakeTerminals();
    const rows = await runInTerminals(
      [{ ...host("1"), enableSsh: false }, host("2")],
      fake.ports,
      { command: () => "uptime", run: true, staggerMs: 0, settleMs: 0 },
    );

    expect(rows.map((row) => row.status)).toEqual(["noSsh", "sent"]);
    expect(fake.opens.map((entry) => entry.hostId)).toEqual(["2"]);
  });

  it("keeps going when one tab cannot be opened", async () => {
    const fake = fakeTerminals({ failHosts: ["1"] });
    const rows = await runInTerminals([host("1"), host("2")], fake.ports, {
      command: () => "uptime",
      run: true,
      staggerMs: 0,
      settleMs: 0,
    });

    expect(rows[0].status).toBe("failed");
    expect(rows[0].detail).toBe("boom");
    expect(rows[1].status).toBe("sent");
  });

  it("pastes without the Enter key when asked", async () => {
    const fake = fakeTerminals();
    await runInTerminals([host("1")], fake.ports, {
      command: () => "rm -rf /tmp/x",
      run: false,
      staggerMs: 0,
      settleMs: 0,
    });

    expect(fake.sent[0].run).toBe(false);
  });

  it("stops where it is and leaves the rest of the hosts alone", async () => {
    const fake = fakeTerminals();
    let stop = false;
    const openTerminal = fake.ports.openTerminal.bind(fake.ports);
    fake.ports.openTerminal = async (target) => {
      const result = await openTerminal(target);
      stop = true;
      return result;
    };

    const rows = await runInTerminals(
      [host("1"), host("2"), host("3")],
      fake.ports,
      {
        command: () => "uptime",
        run: true,
        staggerMs: 0,
        settleMs: 0,
        cancelled: () => stop,
      },
    );

    expect(rows.slice(1).every((row) => row.status === "stopped")).toBe(true);
    expect(fake.opens).toHaveLength(1);
  });

  it("reports every status change as it happens", async () => {
    const fake = fakeTerminals();
    const seen: string[][] = [];
    await runInTerminals([host("1")], fake.ports, {
      command: () => "uptime",
      run: true,
      staggerMs: 0,
      settleMs: 0,
      onUpdate: (rows) => seen.push(rows.map((row) => row.status)),
    });

    expect(seen.map((statuses) => statuses[0])).toEqual([
      "opening",
      "waiting",
      "sent",
    ]);
  });
});

describe("variables", () => {
  it("fills in the host's own values", () => {
    const resolved = resolveCommand("ssh $USER@$HOST -p $PORT # $NAME", {
      ip: "10.0.0.5",
      username: "deploy",
      port: 22,
      name: "web-01",
    });
    expect(resolved).toBe("ssh deploy@10.0.0.5 -p 22 # web-01");
  });

  it("leaves a placeholder alone when there is no value", () => {
    expect(resolveCommand("echo $HOST", null)).toBe("echo $HOST");
    expect(resolveCommand("echo $HOSTNAME", { ip: "1.2.3.4" })).toBe(
      "echo $HOSTNAME",
    );
  });

  it("reads the inputs a command asks for", () => {
    expect(extractInputs("apt install ${INPUT_1:Package} $INPUT_2")).toEqual([
      { key: "INPUT_1", label: "Package" },
      { key: "INPUT_2", label: "Input 2" },
    ]);
  });

  it("fills inputs in and does not rescan their values", () => {
    expect(
      resolveCommand("echo ${INPUT_1:Text}", null, { INPUT_1: "$HOST" }),
    ).toBe("echo $HOST");
  });
});
