# Changelog

## 0.7.0

The first version worth publishing. Everything before it was written and
thrown away in one sitting while testing against a real set of hosts; the
entries below describe what the plugin does now, not that road.

### Added

- **Your snippets in a list, with a play button.** The panel is the snippet
  list itself: search, press play, done. No second place to pick what to run.
- **One terminal tab per host, opened and connected for you.** The tabs open
  one after another with a short gap, then connect side by side, and each
  gets the command as soon as its shell has drawn a prompt.
- **Hosts remembered per snippet.** Picked once under a snippet, kept in this
  plugin's own user settings, so the choice follows the account to the phone
  and the second desktop.
- **A stop button.** Ends a run part-way; the terminals already open stay
  open.
- **Tabs named "host · snippet",** so a row of eight terminals can be told
  apart.
- **An adjustable gap** between the tabs, from 0.3 to 1.2 seconds.
- **Paste without running,** for the first try of a new snippet.
- **The command palette.** Ctrl+K, the snippet's name, Enter, on the same
  remembered hosts.
- **The limits are written down** in the README: the target hosts saved
  inside a snippet cannot be read, a snippet using `{{SECRET}}` is refused
  rather than sent half-filled, and the pencil opens the Snippets panel
  instead of editing in place.
