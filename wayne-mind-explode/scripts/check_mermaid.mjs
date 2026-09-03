#!/usr/bin/env node
/**
 * Parse every ```mermaid block in a markdown file with mermaid's own parser.
 *
 * The spec contract requires diagrams that render in GitHub, Obsidian, and most
 * editors without a build step. Nothing checked that, so a spec could reach the
 * reviewers carrying a diagram that renders as an error box. This is that check:
 * mermaid.parse() headless over jsdom — the real grammar, no chromium, and the
 * spec bytes never leave the machine.
 *
 * Usage:
 *     node check_mermaid.mjs <file.md> [<file.md> ...]
 *
 * Dependencies install once into ~/.cache/wayne-mind-explode/mermaid-validator/.
 * A missing npm is a hard error, never a skipped check.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The reference renderer. Pinned so a passing run means the same thing next
// month; bump it deliberately, not by resolving a range.
const DEPS = { mermaid: "11.17.2", jsdom: "26.1.0" };

// The contract names these two and no others. A type this parser accepts but an
// older bundled mermaid does not is the version skew that makes a diagram fail
// only for the reader.
const PORTABLE = new Set(["flowchart", "flowchart-v2", "sequence"]);

// The pin is part of the path: bumping DEPS installs beside the old tree instead
// of reusing it, so a passing run always names the parser that produced it.
const CACHE = join(
  homedir(),
  ".cache",
  "wayne-mind-explode",
  Object.entries(DEPS)
    .map(([n, v]) => `${n}-${v}`)
    .join("_"),
);

function bootstrap() {
  const modules = join(CACHE, "node_modules");
  const installed = Object.keys(DEPS).every((n) => existsSync(join(modules, n, "package.json")));
  if (!installed) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(
      join(CACHE, "package.json"),
      JSON.stringify({ name: "wayne-mermaid-validator", private: true, dependencies: DEPS }),
    );
    const spec = Object.entries(DEPS).map(([n, v]) => `${n}@${v}`);
    process.stderr.write(`installing ${spec.join(" ")} into ${CACHE}\n`);
    try {
      execFileSync(
        "npm",
        ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--prefix", CACHE, ...spec],
        { stdio: ["ignore", "ignore", "inherit"] },
      );
    } catch (err) {
      throw new Error(`cannot install the mermaid parser (${err.message}); npm is required`);
    }
  }
  return join(CACHE, "node_modules");
}

async function loadMermaid(modules) {
  const { JSDOM } = await import(pathToFileURL(join(modules, "jsdom", "lib", "api.js")).href);
  const dom = new JSDOM("<!DOCTYPE html><body></body>", { pretendToBeVisual: true });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, "navigator", { value: dom.window.navigator, configurable: true });
  const mermaid = (await import(pathToFileURL(join(modules, "mermaid", "dist", "mermaid.core.mjs")).href))
    .default;
  mermaid.initialize({ startOnLoad: false });
  return mermaid;
}

/** Fenced blocks with their 1-based first-content line, so a finding names a real line. */
function blocks(text) {
  const lines = text.split("\n");
  const found = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s*(`{3,}|~{3,})\s*(\S*)/);
    if (open === null) {
      if (fence) {
        open = { marker: fence[1][0], width: fence[1].length, info: fence[2], start: i + 2, body: [] };
      }
      continue;
    }
    if (fence && fence[1][0] === open.marker && fence[1].length >= open.width && !fence[2]) {
      if (open.info === "mermaid") found.push(open);
      open = null;
      continue;
    }
    open.body.push(lines[i]);
  }
  if (open !== null && open.info === "mermaid") {
    found.push({ ...open, unclosed: true });
  }
  return found;
}

async function checkFile(path, mermaid) {
  const text = readFileSync(path, "utf-8");
  const findings = [];
  for (const block of blocks(text)) {
    if (block.unclosed) {
      findings.push(`${path}:${block.start - 1}: fence opened here is never closed`);
      continue;
    }
    const body = block.body.join("\n");
    if (/^\s*(---|%%\{)/.test(body)) {
      findings.push(
        `${path}:${block.start}: in-block renderer config; GitHub and core Obsidian ignore it` +
          ` (layout: elk needs @mermaid-js/layout-elk registered, which neither does)`,
      );
    }
    try {
      const { diagramType } = await mermaid.parse(body);
      if (!PORTABLE.has(diagramType)) {
        findings.push(
          `${path}:${block.start}: diagram type '${diagramType}' is outside the portable profile` +
            ` (flowchart, sequenceDiagram)`,
        );
      }
    } catch (err) {
      const detail = String(err?.message ?? err).split("\n")[0];
      const at = Number(detail.match(/on line (\d+)/)?.[1]);
      const line = Number.isFinite(at) ? block.start + at - 1 : block.start;
      findings.push(`${path}:${line}: ${detail}`);
    }
  }
  return findings;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write("usage: node check_mermaid.mjs <file.md> [<file.md> ...]\n");
  process.exit(2);
}

let mermaid;
try {
  mermaid = await loadMermaid(bootstrap());
} catch (err) {
  process.stderr.write(`mermaid check unavailable: ${err.message}\n`);
  process.exit(2);
}

let findings = [];
for (const path of files) findings = findings.concat(await checkFile(path, mermaid));

if (findings.length) {
  process.stderr.write(`mermaid: ${findings.length} finding(s)\n`);
  for (const f of findings) process.stderr.write(`    ${f}\n`);
  process.exit(1);
}
process.stderr.write(`mermaid: pass (${files.length} file(s))\n`);
