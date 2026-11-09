import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ChevronDown,
  Pencil,
  Play,
  RefreshCw,
  Server,
  Square,
  SquareTerminal,
} from "lucide-react";
import {
  useHosts,
  useToast,
  useTranslation,
  type PanelProps,
  type PluginHostRecord,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  Checkbox,
  Input,
  Label,
  Switch,
} from "@termix-ssh/plugin-sdk/ui";
import type { RunRow, RunStatus } from "./runner";
import {
  countSent,
  listSnippets,
  runSnippet,
  type Snippet,
} from "./run-snippet";
import { openPanel, SNIPPETS_PANEL_ID } from "./open-panel";
import { extractInputs } from "./variables";
import {
  forgetMissing,
  forgetUnknownHosts,
  hostsFor,
  loadStore,
  runOptions,
  setHostsFor,
  setRunOptions,
  snapshot,
  STAGGER_CHOICES,
  subscribe,
} from "./store";

/**
 * The snippet list, with a Start button that opens a terminal per host.
 *
 * It is deliberately the same shape as the Snippets panel: find the snippet,
 * press play. The hosts are set once per snippet and remembered, so a run is
 * one click -- the difference to Snippets' own run is only where the command
 * ends up, namely in terminal tabs that stay open and can be answered.
 *
 * Every row is width-bounded (min-w-0 and truncate all the way down): a host
 * name or a long one-liner must not push the panel wider than the column it
 * is docked into, which has no horizontal scrollbar to fall back on.
 */
export function RunnerPanel({ shell }: PanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { hosts, loaded: hostsLoaded } = useHosts();
  const store = useSyncExternalStore(subscribe, snapshot);

  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  // Which snippet the rows below belong to. Without it the last run's badges
  // show up under every snippet, claiming hosts ran that never did.
  const [rowsFor, setRowsFor] = useState<string | null>(null);
  const [rows, setRows] = useState<RunRow[] | null>(null);
  // A ref, not state: the run reads it between hosts and must see the latest
  // value, not the one captured when it started.
  const stopped = useRef(false);

  const load = useCallback(async () => {
    await loadStore();
    const list = await listSnippets();
    setSnippets(list);
    forgetMissing(list.map((snippet) => snippet.id));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sshHosts = useMemo(
    () => hosts.filter((host) => host.enableSsh !== false),
    [hosts],
  );

  // The ids a run can actually reach. A snippet may still remember a host
  // that was deleted or had SSH switched off since; it is skipped silently
  // at run time, so the count must skip it too rather than promise a host
  // that has no checkbox.
  const knownHostIds = useMemo(
    () => new Set(sshHosts.map((host) => host.id)),
    [sshHosts],
  );

  // A host that is gone for good is dropped from what the snippet remembers.
  // Only when the shell really has a list: an empty one early on would wipe
  // every choice.
  const hostIdKey = useMemo(
    () => hosts.map((host) => host.id).join("|"),
    [hosts],
  );
  useEffect(() => {
    if (!hostsLoaded || !hostIdKey || !store.loaded) return;
    forgetUnknownHosts(hostIdKey.split("|"));
  }, [hostsLoaded, hostIdKey, store.loaded]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return snippets ?? [];
    return (snippets ?? []).filter((snippet) =>
      `${snippet.name} ${snippet.content}`.toLowerCase().includes(needle),
    );
  }, [snippets, search]);

  const start = async (snippet: Snippet) => {
    const inputs = extractInputs(snippet.content);
    const missing = inputs.filter(
      (input) => !(inputValues[input.key] ?? "").trim(),
    );
    if (missing.length > 0) {
      setOpenId(String(snippet.id));
      toast.warning(t("toast.needsInputs"));
      return;
    }
    stopped.current = false;
    setRunningId(String(snippet.id));
    setRowsFor(String(snippet.id));
    setRows(null);
    try {
      const outcome = await runSnippet({
        snippet,
        hosts: sshHosts,
        inputValues,
        onUpdate: setRows,
        cancelled: () => stopped.current,
      });
      if (outcome.kind === "noHosts") {
        setOpenId(String(snippet.id));
        toast.warning(t("toast.pickHosts"));
        return;
      }
      if (outcome.kind === "secrets") {
        toast.error(t("toast.secrets", { names: outcome.names.join(", ") }));
        return;
      }
      const sent = countSent(outcome.rows);
      if (stopped.current) toast.warning(t("toast.stopped", { count: sent }));
      else if (sent === outcome.rows.length)
        toast.success(t("toast.allSent", { count: sent }));
      else if (sent === 0) toast.error(t("toast.noneSent"));
      else
        toast.warning(
          t("toast.someSent", { count: sent, total: outcome.rows.length }),
        );
    } finally {
      setRunningId(null);
      stopped.current = false;
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3 overflow-hidden p-3">
      <header className="flex w-full min-w-0 flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <SquareTerminal size={16} className="shrink-0" />
          <span className="truncate">{t("nav.panel")}</span>
        </h2>
        <p className="text-xs text-muted-foreground">{t("panel.hint")}</p>
      </header>

      <div className="flex w-full min-w-0 items-center gap-1">
        <Input
          className="h-8 min-w-0 flex-1"
          placeholder={t("panel.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2"
          title={t("panel.reload")}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
        </Button>
      </div>

      {/*
        A plain scroller, not the kit's ScrollArea: Radix renders its viewport
        content inside a `display: table` wrapper, which sizes to the widest
        child instead of to the column. One long one-liner then pushed the
        whole list past the right edge of the panel.
      */}
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <ul className="flex w-full min-w-0 flex-col gap-2 pr-1">
          {snippets === null && (
            <li className="text-xs text-muted-foreground">
              {t("panel.loading")}
            </li>
          )}
          {snippets !== null && shown.length === 0 && (
            <li className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {snippets.length === 0 ? t("panel.noSnippets") : t("panel.noMatch")}
            </li>
          )}
          {shown.map((snippet) => (
            <SnippetRow
              key={String(snippet.id)}
              snippet={snippet}
              hosts={sshHosts}
              hostsLoaded={hostsLoaded}
              savedIds={store.loaded ? hostsFor(snippet.id) : []}
              knownIds={knownHostIds}
              open={openId === String(snippet.id)}
              onToggleOpen={() =>
                setOpenId((prev) =>
                  prev === String(snippet.id) ? null : String(snippet.id),
                )
              }
              running={runningId === String(snippet.id)}
              busy={runningId !== null}
              rows={rowsFor === String(snippet.id) ? rows : null}
              inputValues={inputValues}
              onInput={(key, value) =>
                setInputValues((prev) => ({ ...prev, [key]: value }))
              }
              onRun={() => void start(snippet)}
              onStop={() => {
                stopped.current = true;
              }}
              onEdit={() => openPanel(shell, SNIPPETS_PANEL_ID)}
            />
          ))}
        </ul>
      </div>

      <footer className="flex w-full min-w-0 flex-col gap-2 border-t pt-2">
        <div className="flex items-center gap-2">
          <Switch
            id="snippet-terminals-paste"
            checked={store.options.pasteOnly}
            onCheckedChange={(value: boolean) =>
              void setRunOptions({ ...runOptions(), pasteOnly: value })
            }
          />
          <Label htmlFor="snippet-terminals-paste" className="text-xs">
            {t("panel.pasteOnly")}
          </Label>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-1">
          <span className="mr-1 text-xs">{t("panel.stagger")}</span>
          {STAGGER_CHOICES.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={store.options.staggerMs === value ? "secondary" : "ghost"}
              className="h-6 shrink-0 px-2 text-[10px]"
              onClick={() =>
                void setRunOptions({ ...runOptions(), staggerMs: value })
              }
            >
              {t("panel.seconds", { value: (value / 1000).toFixed(1) })}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {t("panel.staggerHint")}
        </p>
      </footer>
    </div>
  );
}

function SnippetRow({
  snippet,
  hosts,
  hostsLoaded,
  savedIds,
  knownIds,
  open,
  onToggleOpen,
  running,
  busy,
  rows,
  inputValues,
  onInput,
  onRun,
  onStop,
  onEdit,
}: {
  snippet: Snippet;
  hosts: PluginHostRecord[];
  hostsLoaded: boolean;
  savedIds: string[];
  knownIds: Set<string>;
  open: boolean;
  onToggleOpen: () => void;
  running: boolean;
  busy: boolean;
  rows: RunRow[] | null;
  inputValues: Record<string, string>;
  onInput: (key: string, value: string) => void;
  onRun: () => void;
  onStop: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const [hostSearch, setHostSearch] = useState("");
  const inputs = extractInputs(snippet.content);
  const count = savedIds.filter((id) => knownIds.has(id)).length;

  const shownHosts = useMemo(() => {
    const needle = hostSearch.trim().toLowerCase();
    if (!needle) return hosts;
    return hosts.filter((host) =>
      [host.name, host.ip, host.folder, host.username]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    );
  }, [hosts, hostSearch]);

  const toggleHost = (hostId: string) => {
    const next = savedIds.includes(hostId)
      ? savedIds.filter((id) => id !== hostId)
      : [...savedIds, hostId];
    void setHostsFor(snippet.id, next);
  };

  return (
    <li className="w-full min-w-0 overflow-hidden rounded-md border bg-card/40">
      <div className="flex w-full min-w-0 items-start gap-2 p-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 shrink-0 p-0"
          disabled={busy && !running}
          title={running ? t("panel.stop") : t("panel.run", { count })}
          onClick={running ? onStop : onRun}
        >
          {running ? <Square size={13} /> : <Play size={14} />}
        </Button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-xs font-medium">{snippet.name}</span>
          <span className="block w-full truncate font-mono text-[10px] text-muted-foreground">
            {snippet.content}
          </span>
          <button
            type="button"
            onClick={onToggleOpen}
            className="flex w-fit max-w-full items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Server size={11} className="shrink-0" />
            <span className="truncate">
              {count === 0
                ? t("panel.noHostsYet")
                : t("panel.hostCount", { count })}
            </span>
            <ChevronDown
              size={11}
              className={open ? "shrink-0 rotate-180 transition" : "shrink-0 transition"}
            />
          </button>
        </div>
        {running ? (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {t("panel.running")}
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 shrink-0 p-0"
            title={t("panel.edit")}
            onClick={onEdit}
          >
            <Pencil size={13} />
          </Button>
        )}
      </div>

      {open && (
        <div className="flex w-full min-w-0 flex-col gap-2 border-t p-2">
          {inputs.map((input) => (
            <div key={input.key} className="flex w-full min-w-0 flex-col gap-1">
              <Label className="text-[11px]">{input.label}</Label>
              <Input
                className="h-7 w-full min-w-0 text-xs"
                value={inputValues[input.key] ?? ""}
                onChange={(event) => onInput(input.key, event.target.value)}
              />
            </div>
          ))}
          <div className="flex w-full min-w-0 items-center gap-1">
            <Input
              className="h-7 min-w-0 flex-1 text-xs"
              placeholder={t("panel.filterHosts")}
              value={hostSearch}
              onChange={(event) => setHostSearch(event.target.value)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-[10px]"
              onClick={() =>
                void setHostsFor(
                  snippet.id,
                  shownHosts.map((host) => host.id),
                )
              }
            >
              {t("panel.selectAll")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 px-2 text-[10px]"
              onClick={() => void setHostsFor(snippet.id, [])}
            >
              {t("panel.selectNone")}
            </Button>
          </div>
          <ul className="max-h-48 w-full min-w-0 divide-y overflow-y-auto overflow-x-hidden rounded-md border">
            {!hostsLoaded && (
              <li className="p-2 text-[11px] text-muted-foreground">
                {t("panel.loadingHosts")}
              </li>
            )}
            {hostsLoaded && shownHosts.length === 0 && (
              <li className="p-2 text-[11px] text-muted-foreground">
                {t("panel.noHostsMatch")}
              </li>
            )}
            {shownHosts.map((host) => (
              <li
                key={host.id}
                className="flex w-full min-w-0 items-center gap-2 px-2 py-1 text-[11px]"
              >
                <Checkbox
                  id={`st-${snippet.id}-${host.id}`}
                  className="shrink-0"
                  checked={savedIds.includes(host.id)}
                  onCheckedChange={() => toggleHost(host.id)}
                />
                <label
                  htmlFor={`st-${snippet.id}-${host.id}`}
                  className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2"
                >
                  <span className="truncate">{host.name}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {host.ip}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="flex w-full min-w-0 flex-wrap gap-1 border-t p-2">
          {rows.map((row) => (
            <li key={row.hostId} className="min-w-0 max-w-full">
              <StatusBadge row={row} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function StatusBadge({ row }: { row: RunRow }) {
  const { t } = useTranslation();
  const tone: Record<RunStatus, "default" | "secondary" | "destructive"> = {
    pending: "secondary",
    opening: "secondary",
    waiting: "secondary",
    sent: "default",
    noSsh: "destructive",
    timeout: "destructive",
    unreachable: "destructive",
    failed: "destructive",
    stopped: "secondary",
  };
  return (
    <Badge
      variant={tone[row.status]}
      className="max-w-full truncate text-[10px]"
      title={row.detail}
    >
      {row.hostName}: {t(`status.${row.status}`)}
    </Badge>
  );
}
