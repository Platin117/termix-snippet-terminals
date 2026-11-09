# Snippet Terminals

Your snippets in a list. Press play, and a terminal tab opens on every host
the snippet is set to run on, with the command typed in.

## Using it

1. Open **Snippet Terminals** from the rail, or press Ctrl+K and type the
   snippet's name.
2. The first time, click **Pick hosts** under a snippet and tick the machines
   it should run on. The choice is saved for that snippet.
3. Press ▶. One tab per host, opened in quick succession; each gets the
   command as soon as it is connected and its shell has drawn a prompt. Press
   ■ to stop a run part-way; the terminals already open stay open.

From then on a run is one click, or three keystrokes in the palette.

## Why a terminal and not a result dialog

Everything stays visible and answerable: a `sudo` password prompt, a
`Configuration file '/etc/...' ==> What would you like to do about it?`
question during an upgrade, a long `apt dist-upgrade` that would have run past
a headless timeout. Nothing is cut off at the end of a run, because there is no
run to end — the session is yours, and the SSH Terminal plugin keeps it alive
and reconnects it on its own.

## Options

- **Paste only, do not press Enter** — the command lands in each terminal and
  waits for you. Good for the first try of a new snippet.
- **Gap** — how long each terminal gets in front before the next one opens.
  0.8 s is the default; shorten it if your machine keeps up, lengthen it if a
  tab stays empty.

Both are remembered.

## Why the gap

A terminal tab registers its session when it mounts, and Termix mounts the tab
in front. Opening every tab in the same instant leaves all but the last
unmounted: they hold no session, so `terminal.sendToSession` has nothing to
send to and the command is silently lost.

So the run gives each tab a moment in front, long enough to mount and start
its SSH handshake. From then on the tab stays mounted and keeps connecting in
the background, which means the handshakes overlap: eight hosts take about as
long as the slowest one, not eight times as long. A host that is offline costs
the run nothing but its own tab.

## Variables

`$HOST`, `$USER`, `$PORT` and `$NAME` are filled in per host. `$INPUT_n` asks
once, in the snippet's row, and the same answer goes to every host. A
placeholder with no value is left visible in the command rather than silently
blanked.

`{{SECRET}}` is not supported here: saved secrets are only unlocked by the
Snippets plugin's own run.

## Status per host

| Status | Meaning |
| --- | --- |
| opening | the tab is being created |
| connecting | waiting for the SSH session to come up |
| sent | the command went into that terminal |
| no terminal | the tab never registered a session |
| no connection | the tab is open but never came up -- an offline host, a refused port; its own error is in the tab |
| stopped | you stopped the run before this host's turn |
| no SSH | the host has SSH switched off |
| failed | the tab could not be opened |

Nothing is rolled back and no tab is closed: a run that half worked leaves
every terminal open to read.

## Requirements

The SSH Terminal plugin must be enabled — this plugin drives it. The Snippets
plugin provides the list of snippets.
