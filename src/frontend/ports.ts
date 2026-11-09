import { invokeAction } from "@termix-ssh/plugin-sdk/frontend";
import type { RunnerHost, RunnerPorts, TerminalSessionInfo } from "./runner";

/**
 * The real ports: the SSH Terminal plugin's actions.
 *
 * `terminal.open` always opens a new tab (it passes forceNewTab), and
 * `terminal.sendToSession` writes into one named session, so a run never
 * types into a terminal the user is working in. Both return undefined when
 * that plugin is missing or switched off, which the runner reports as a host
 * that produced no terminal.
 */
export function createPorts(): RunnerPorts {
  return {
    async openTerminal(host: RunnerHost, label?: string) {
      return invokeAction("terminal.open", host.record ?? host, { label });
    },
    async listSessions() {
      const sessions = await invokeAction("terminal.listSessions");
      return Array.isArray(sessions) ? (sessions as TerminalSessionInfo[]) : [];
    },
    async send(sessionId: string, text: string, run: boolean) {
      return (
        (await invokeAction("terminal.sendToSession", sessionId, text, { run })) ===
        true
      );
    },
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}
