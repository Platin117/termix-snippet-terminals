# Snippet Terminals

A [Termix](https://github.com/Termix-SSH/Termix) plugin that runs a snippet on
several hosts **in real terminals you can watch**, the way Termius does it.

## Why

Termix's Snippets plugin can do two things: type a snippet into terminal tabs
that are *already* open, or run it headlessly over its own SSH connection and
show a results dialog at the end. The second one is what you reach for when you
want "update all my VMs", and it is the worse deal:

- a question from the host (`sudo` password, `Do you want to continue [Y/n]`)
  has nobody to answer it,
- you see the output only when it is over,
- if the run times out, the command keeps going on the host and you are left
  with "Failed" and no idea where it stopped.

This plugin fills the gap between the two: it **opens a terminal tab per host**
and types the command in once the session is connected. From there it is an
ordinary terminal — answer prompts, scroll back, keep working in it.

## What it does

The panel is your snippet list: search, press play, done.

- Every snippet you own, with its command underneath.
- The hosts a snippet runs on are picked once and remembered, so the second
  run is a single click.
- One terminal tab per host, opened in quick succession so the SSH
  handshakes overlap (see below).
- `$HOST`, `$USER`, `$PORT`, `$NAME` and `$INPUT_n` are filled in per host.
- "Paste only" puts the command in without pressing Enter.
- A status per host while it runs: opening, connecting, sent, no terminal.
- The play button turns into a stop button while a run is working through
  its hosts; the terminals already open stay open.
- Ctrl+K, snippet name, Enter — the command palette runs it with the same
  remembered hosts.

The run never types into a terminal that was already open, and a host that
fails does not stop the rest.

## What it does not do

- Read the target hosts you saved *inside* a snippet. The Snippets plugin keeps
  those to itself: neither `snippets.list` nor its `snippets.access` service
  hands them out, and another plugin's host settings are stripped from every
  host record a plugin sees. So the hosts are picked once here and kept in this
  plugin's own user settings, which live on the server and follow the account.
- `{{SECRET}}` placeholders. Saved secrets live in the Snippets plugin's
  encrypted store and are only resolved by its own run. A snippet that uses one
  is refused with a message rather than sent half-filled. (A small backend using
  the `snippets.access` service's `resolveCommand` would lift this.)
- Collect the output. The output is in the terminal, which is the point.

## Why the tabs open with a gap

A terminal tab registers its session only while it is mounted, and Termix
mounts a tab when it becomes the active one. Opening every tab at once leaves
all but the last without a session: `terminal.sendToSession` then has nothing
to send to, and the command is silently lost.

So the run opens one tab at a time with a short gap -- long enough for that
tab to mount while it is in front and start its SSH handshake. After that the
tab stays mounted and keeps connecting in the background, so the handshakes
overlap and the whole run takes about as long as its slowest host rather than
the sum of all of them. A host that never connects is given a deadline of its
own and then left with its error in its tab, which holds nobody else up. The
gap is adjustable in the panel, because how long a tab needs in front belongs
to the machine, not to this plugin.

## How it works

Everything goes through actions the SSH Terminal plugin registers for other
plugins: `terminal.open`, `terminal.listSessions` and `terminal.sendToSession`.
The run opens a tab, polls the session list until a new session for that host
reports itself connected, then sends the text to that session id.

That is the same path the Snippets plugin uses to type into a terminal, so it
is as stable as cross-plugin calls get here — but it is the terminal plugin's
contract, not the SDK's. If a Termix update renames those actions, the run
reports "no terminal" instead of doing something unexpected.

## Install

Add the registry once in Termix, under Plugins, and the plugin shows up there
with its updates:

```
https://raw.githubusercontent.com/Platin117/termix-plugins/main/index.json
```

Or install a release by hand: turn on Plugin developer mode (Settings →
Server → General) and upload the `.tmxplug` from the
[releases](https://github.com/Platin117/termix-snippet-terminals/releases) in
the Plugins area.

Requires Termix 26.10.3 or newer with the SSH Terminal plugin enabled. The
Snippets plugin provides the snippets; without it the panel is empty.

## Build

`nodeenv.sh` runs the toolchain inside a Flatpak SDK sandbox, for machines
with no system-wide Node. With Node 24 on PATH, drop it and use npm directly.

```bash
./nodeenv.sh "npm install && npm run build && npm test && npx termix-plugin validate"
```

```bash
./nodeenv.sh "npx termix-plugin pack"
```

## Releasing

Push a tag `vX.Y.Z` that matches `manifest.json`. The workflow builds, tests,
validates, packs, signs and publishes the release, then writes the version
into the shared registry index in
[Platin117/termix-plugins](https://github.com/Platin117/termix-plugins).

Two secrets are needed on this repository:

- `TERMIX_PLUGIN_SIGNING_KEY` — the private key the registry's `publicKey`
  belongs to. Without it the registry refuses to install the release.
- `REGISTRY_TOKEN` — a fine-grained GitHub token with contents read/write on
  the registry repository and nothing else.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
