import type { ShellApi } from "@termix-ssh/plugin-sdk/frontend";
import { getTabType } from "@termix-ssh/plugin-sdk/ui";

export const PANEL_ID = "snippet-terminals";

/**
 * Brings the panel up, whichever layout is running.
 *
 * The stock layout docks a panel into its left sidebar, which is what
 * `openRailView` opens. Compact Layout has no sidebar: it shows a panel in a
 * singleton tab of type "panel" and picks the panel by `panelId`, the same
 * way its own rail opens Snippets. Asking the tab registry which of the two
 * is there keeps this out of guesswork.
 */
export function openPanel(shell: ShellApi, panelId: string = PANEL_ID): void {
  if (getTabType("panel")) {
    shell.openSingletonTab("panel", { data: { panelId } });
    return;
  }
  shell.openRailView(panelId);
}

/** The Snippets plugin's own panel, where a snippet is edited. */
export const SNIPPETS_PANEL_ID = "snippets";
