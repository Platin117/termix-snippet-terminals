#!/usr/bin/env node
/**
 * Puts this version into the shared registry index.
 *
 * Everything but the signature is derived: the metadata from manifest.json,
 * the checksum and size from the packed file itself. Typing any of it by
 * hand is how an index ends up describing a build nobody can install.
 *
 *   node scripts/update-index.mjs snippet-terminals-0.7.0.tmxplug registry/index.json
 *
 * The signature is read from <file>.sig, which `termix-plugin sign` writes.
 * Re-running for a version already listed replaces that entry, so a botched
 * release can be redone without hand-editing JSON. A plugin the index does
 * not know yet is added, so the first release needs no manual entry.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";

const [pluginFile, indexFile = "index.json"] = process.argv.slice(2);
if (!pluginFile) {
  console.error("usage: update-index.mjs <file.tmxplug> [index.json]");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const index = JSON.parse(readFileSync(indexFile, "utf8"));
const bytes = readFileSync(pluginFile);
const signature = readFileSync(`${pluginFile}.sig`, "utf8").trim();

const version = manifest.version;
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const tag = `v${version}`;
const base = `${manifest.repository}/releases`;

const entry = {
  version,
  api: "1",
  url: `${base}/download/${tag}/${pluginFile.split("/").pop()}`,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  signature,
  size: statSync(pluginFile).size,
  capabilities: manifest.capabilities,
  releaseNotesUrl: `${base}/tag/${tag}`,
  publishedAt: now,
};

index.plugins ??= [];
let plugin = index.plugins.find((p) => p.id === manifest.id);
if (!plugin) {
  plugin = { id: manifest.id, versions: [] };
  index.plugins.push(plugin);
}

// A semver with a dash is a prerelease, and the registry keeps those in
// their own list so an install on the stable channel is never offered one.
const prerelease = version.includes("-");
const list = prerelease ? "prereleases" : "versions";
plugin[list] = [
  entry,
  ...(plugin[list] ?? []).filter((v) => v.version !== version),
];

// A stable release makes every older prerelease moot: the schema wants only
// betas newer than the newest stable one.
if (!prerelease && plugin.prereleases) {
  delete plugin.prereleases;
}

// The manifest owns how the plugin presents itself.
plugin.name = manifest.name;
plugin.description = manifest.description;
plugin.author = manifest.author?.name ?? manifest.author;
plugin.category = manifest.category;
plugin.repository = manifest.repository;
plugin.icon = manifest.icon;
plugin.features = manifest.features;

index.updatedAt = now;
writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
console.log(`${indexFile}: ${manifest.id} ${version}`);
