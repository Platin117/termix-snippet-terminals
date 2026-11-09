/**
 * The snippet placeholders this plugin fills in before typing a command into
 * a terminal: $HOST, $USER, $PORT, $NAME and $INPUT_n, in both the plain and
 * the ${...} form, exactly as the Snippets plugin writes them.
 *
 * {{SECRET}} is deliberately not resolved here. Saved secrets live in the
 * Snippets plugin's own encrypted store and are only handed out through its
 * backend; a snippet that uses one is refused with a clear message instead of
 * being sent with the placeholder still in it.
 */

export interface SnippetInput {
  key: string;
  label: string;
}

export interface HostVars {
  ip?: string;
  username?: string;
  port?: number | string;
  name?: string;
}

const INPUT_PATTERN =
  /\$\{INPUT_(\d+)(?::([^}$]+))?\}|\$INPUT_(\d+)(?![a-zA-Z0-9_])/g;
const SECRET_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]{0,63})\}\}/g;
const HOST_VAR_PATTERN =
  /\$\{(HOST|USER|PORT|NAME)\}|\$(HOST|USER|PORT|NAME)(?![a-zA-Z0-9_])/;
const RESOLVE_PATTERN = new RegExp(
  `${HOST_VAR_PATTERN.source}|${INPUT_PATTERN.source}`,
  "g",
);

/** The $INPUT_n placeholders in a command, in the order they first appear. */
export function extractInputs(content: string): SnippetInput[] {
  const seen = new Map<string, SnippetInput>();
  INPUT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INPUT_PATTERN.exec(content)) !== null) {
    const digits = match[1] ?? match[3];
    const key = `INPUT_${digits}`;
    if (!seen.has(key)) {
      seen.set(key, { key, label: match[2]?.trim() || `Input ${digits}` });
    }
  }
  return [...seen.values()];
}

/** The {{NAME}} secrets a command uses. */
export function extractSecretNames(content: string): string[] {
  const names = new Set<string>();
  for (const match of content.matchAll(SECRET_PATTERN)) names.add(match[1]);
  return [...names];
}

/**
 * Fills in the host's values and the user's inputs. A placeholder with no
 * value is left as it is rather than blanked, so a half-filled command is
 * visible in the terminal instead of silently running against nothing. Values
 * are never scanned again, so an input holding "$HOST" stays literal.
 */
export function resolveCommand(
  content: string,
  host: HostVars | null,
  inputValues: Record<string, string> = {},
): string {
  const vars: Record<string, string | undefined> = {
    HOST: host?.ip,
    USER: host?.username,
    PORT: host?.port !== undefined ? String(host.port) : undefined,
    NAME: host?.name,
  };
  return content.replace(
    RESOLVE_PATTERN,
    (
      fullMatch: string,
      braceVar: string | undefined,
      plainVar: string | undefined,
      braceDigits: string | undefined,
      _label: string | undefined,
      plainDigits: string | undefined,
    ) => {
      const name = braceVar ?? plainVar;
      if (name) return vars[name] ?? fullMatch;
      const key = `INPUT_${braceDigits ?? plainDigits}`;
      return Object.hasOwn(inputValues, key) ? inputValues[key] : fullMatch;
    },
  );
}
