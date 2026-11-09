import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";

// The whole plugin is a panel that drives other plugins' terminals, so there
// is nothing to run on the server. The build still needs a backend entry.
export async function activate(_ctx: PluginContext) {}

export async function deactivate() {}
