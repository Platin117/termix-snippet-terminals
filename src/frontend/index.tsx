import { Play, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { RunnerPanel } from "./RunnerPanel";
import { openPanel, PANEL_ID } from "./open-panel";
import { countSent, listSnippets, runSnippet } from "./run-snippet";
import { extractInputs } from "./variables";
import { loadStore } from "./store";

export function activate(app: TermixApp): void {
  // A panel, not a tab: it then has a home in every layout -- the sidebar in
  // Classic, the panel tab in Compact -- without this plugin knowing which
  // one is running.
  app.registerPanel(PANEL_ID, RunnerPanel);

  // The panel alone is only a component the shell can render; this is what
  // puts it in the left rail and in Appearance > Sidebar > Navigation.
  // Without it the plugin loads and does nothing visible, which is exactly
  // what 0.2.0 did. Not promotable: there is no tab type of this name, and a
  // layout that offers to open one as a full tab would open nothing.
  app.registerRailItem({
    id: PANEL_ID,
    icon: SquareTerminal,
    titleKey: "nav.panel",
    kind: "panel",
    group: "tools",
  });

  // The short way: Ctrl+K, type the snippet's name, Enter. It runs on the
  // hosts the panel remembers for it, so nothing else has to be picked.
  app.registerPaletteGroup({
    id: "snippet-terminals",
    titleKey: "palette.group",
    load: async () => {
      await loadStore();
      const snippets = await listSnippets();
      return snippets
        .filter((snippet) => !snippet.isNote)
        .map((snippet) => ({
          id: `snippet-terminals-${snippet.id}`,
          title: snippet.name,
          description: snippet.content,
          icon: Play,
          hint: app.t("palette.hint"),
          run: ({ shell }) => {
            // A snippet that asks for input needs the panel's fields.
            if (extractInputs(snippet.content).length > 0) {
              openPanel(shell);
              toast.warning(app.t("toast.needsInputs"));
              return;
            }
            void app
              .listHosts()
              .then((hosts) => runSnippet({ snippet, hosts }))
              .then((outcome) => {
                if (outcome.kind === "noHosts") {
                  openPanel(shell);
                  toast.warning(app.t("toast.pickHosts"));
                  return;
                }
                if (outcome.kind === "secrets") {
                  toast.error(
                    app.t("toast.secrets", { names: outcome.names.join(", ") }),
                  );
                  return;
                }
                const sent = countSent(outcome.rows);
                if (sent === outcome.rows.length)
                  toast.success(app.t("toast.allSent", { count: sent }));
                else if (sent === 0) toast.error(app.t("toast.noneSent"));
                else
                  toast.warning(
                    app.t("toast.someSent", {
                      count: sent,
                      total: outcome.rows.length,
                    }),
                  );
              })
              .catch(() => toast.error(app.t("toast.noneSent")));
          },
        }));
    },
  });

  app.registerPaletteEntry({
    id: "open-snippet-terminals",
    titleKey: "nav.panel",
    icon: SquareTerminal,
    scope: "global",
    keywords: ["snippet", "terminal", "hosts", "run"],
    run: (shell) => openPanel(shell),
  });
}
