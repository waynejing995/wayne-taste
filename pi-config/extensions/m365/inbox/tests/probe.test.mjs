/**
 * The agent probe (inbox/cli/probe.ts): what a run reads from a session, the progress digest it sends, and the
 * events it records. Ported from wayne-inbox/scripts/test_watch_agents.py.
 *
 * Digests go through the real `omp` call path with a fake `omp` on PATH; probes are injected, except the
 * `runProbe` tests, which run probe.sh against a fake `tern` and a real pane process.
 *
 *   node inbox/tests/probe.test.mjs
 */
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import YAML from "yaml";
import { CARD_PROMPT, cardStatus, latestLine, paneLine, probeAgents, runProbe } from "../cli/probe.ts";

let failed = 0;
async function check(label, fn) {
	try {
		await fn();
		console.log(`PASS ${label}`);
	} catch (e) {
		failed++;
		console.log(`FAIL ${label}\n${e.stack ?? e.message}`);
	}
}

const DOT = " \u00b7 ";
const SELF_RECEIPT = "Sent to self-chat (48:notes).";
const CARD_RECEIPT = "Sent a card to self-chat (48:notes).";
const T0 = Date.UTC(2026, 10, 6, 14, 0) / 1000;
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (s) => {
	const d = new Date(s * 1000);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const HHMM = hhmm(T0);
const md5 = (buf) => createHash("md5").update(buf).digest("hex").slice(0, 16);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonl(...objs) {
	return objs.map((o) => JSON.stringify(o)).join("\n");
}
const assistant = (...items) => ({ type: "message", message: { role: "assistant", content: items, stopReason: "stop" } });
const toolTurn = () => ({
	type: "message",
	message: { role: "assistant", content: [{ type: "toolCall", name: "bash", arguments: { command: "ls" } }], stopReason: "toolUse" },
});
const textItem = (value) => ({ type: "text", text: value });
function todoResult(...tasks) {
	const phase = { name: "Wave 1", tasks: tasks.map(([content, status]) => ({ content, status })) };
	return { type: "message", message: { role: "toolResult", toolName: "todo", details: { op: "update", phases: [phase] } } };
}
const tailOf = (value, kind) => ({ kind, tail: gzipSync(Buffer.from(value)).toString("base64") });
const decodeTail = (r) => gunzipSync(Buffer.from(r.tail, "base64")).toString("utf8");

const OMP_TAIL = jsonl(assistant(textItem("older")), toolTurn(), assistant(textItem("tail latest answer")));
/** A live omp session: its tail only when asked, as probe.sh does. */
const live = (tail, kind) => (now, want) => {
	const p = { alive: true, agent: "omp", state: "", session: "/s.jsonl", smtime: now, waiting: false, text: "pane-hash", rmtime: 0, rstatus: "", now };
	if (want) Object.assign(p, tailOf(tail, kind));
	return p;
};
const ompLive = live(OMP_TAIL, "jsonl");
const paneLive = live("older\nlast pane line\n\n", "pane");
const finished = (now, want) => ({ ...ompLive(now, want), rmtime: now, rstatus: "done" });
const dead = (now) => ({ alive: false, agent: "", state: "", session: "", smtime: 0, waiting: false, text: "", rmtime: 0, rstatus: "", now });
const broken = () => {
	throw new Error("ssh: connect refused");
};
const partialResult = (ropen) => (now, want) => ({ ...ompLive(now, want), rmtime: now, rstatus: "partial", ropen });
const blocked = (waiting) => (now, want) => ({ ...ompLive(now, want), state: "blocked", smtime: T0 - 3600, text: "", waiting });

/**
 * Stands in for `omp --mode json` running one teams_send with the arguments the prompt carries (a card prompt's JSON,
 * or the text digest). Its mode comes from FAKE_OMP_MODE at call time: ok, exit, error (teams error), receipt (wrong
 * chat), message (other text), cardfail (the card is refused, text works). Every call's argv is appended to FAKE_OMP_LOG.
 */
const OMP = `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_OMP_LOG, JSON.stringify(argv) + "\\n");
const mode = process.env.FAKE_OMP_MODE ?? "ok";
if (mode === "exit") {
	process.stderr.write("boom: no teams token");
	process.exit(1);
}
const prompt = argv.at(-1);
const card = prompt.startsWith(${JSON.stringify(CARD_PROMPT)});
const args = card ? JSON.parse(prompt.slice(${JSON.stringify(CARD_PROMPT)}.length)) : { target: "self", message: prompt.split("\\n\\n").slice(1).join("\\n\\n").trim() };
if (mode === "message") args.message = "some other text";
const refused = mode === "error" || (mode === "cardfail" && card);
const ok = card ? "${CARD_RECEIPT}" : "${SELF_RECEIPT}";
const text = refused ? (card && mode === "cardfail" ? "Graph 400: card rejected" : "Graph 403 Forbidden") : mode === "receipt" ? "Sent to chat 19:group@thread" : ok;
const start = { type: "tool_execution_start", toolCallId: "call-1", toolName: "teams_send", args };
const end = { type: "tool_execution_end", toolCallId: "call-1", toolName: "teams_send", result: { content: [{ type: "text", text }] } };
if (refused) end.isError = true;
console.log("noise");
console.log(JSON.stringify(start));
console.log(JSON.stringify(end));
`;

const ENV_KEYS = ["PATH", "HOME", "WAYNE_INBOX_DIR", "FAKE_OMP_LOG", "FAKE_OMP_MODE"];

function makeFixture(dir) {
	const rulesFile = path.join(dir, "rules.yaml");
	const stateFile = path.join(dir, "cursors", "agent-watch.json");
	const ledgerFile = path.join(dir, "ledger.tsv");
	const f = {
		dir,
		now: T0,
		behaviour: {},
		push: new Set(),
		probes: [],
		logs: [],
		children: [],
		/** Watch `name` with a fake probe; rewrites rules.yaml's agent_watch from every session watched so far. */
		watch(name, behaviour, push = false) {
			f.behaviour[name] = behaviour;
			if (push) f.push.add(name);
			else f.push.delete(name);
			const rows = Object.keys(f.behaviour).map((n) => ({
				name: n, mux: "tern", pane: "1", host: "local", result: "", ...(f.push.has(n) ? { push: true } : {}),
			}));
			fs.writeFileSync(rulesFile, YAML.stringify({ agents: { "*": [{ action: "notify", tag: "agent" }] }, agent_watch: rows }));
		},
		/** One probe pass; `extra` overrides options (e.g. `agent`, `digestMin`). */
		run(extra = {}) {
			return probeAgents({
				stallMin: 30,
				digestMin: 30,
				now: () => f.now * 1000,
				log: (line) => f.logs.push(line),
				probe: async (a, want) => {
					f.probes.push([a.name, want]);
					return f.behaviour[a.name](f.now, want);
				},
				...extra,
			});
		},
		/** The argv of every fake omp call so far. */
		calls() {
			if (!fs.existsSync(process.env.FAKE_OMP_LOG)) return [];
			return fs.readFileSync(process.env.FAKE_OMP_LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
		},
		/** What each fake omp call asked to send, as text: a card is its title, then one `- name · host · status · tail` line per row. */
		sent() {
			return f.calls().map((argv) => {
				const prompt = argv.at(-1);
				if (!prompt.startsWith(CARD_PROMPT)) return prompt.split("\n\n").slice(1).join("\n\n").trim();
				const card = JSON.parse(prompt.slice(CARD_PROMPT.length));
				return [card.title, ...card.agents.map((r) => `- ${[r.name, r.host, r.status, r.tail].join(DOT)}`)].join("\n");
			});
		},
		/** The teams_send arguments of every card call. */
		cards() {
			return f.calls().map((argv) => argv.at(-1)).filter((p) => p.startsWith(CARD_PROMPT)).map((p) => JSON.parse(p.slice(CARD_PROMPT.length)));
		},
		state() {
			return JSON.parse(fs.readFileSync(stateFile, "utf8"));
		},
		/** Ledger keys (the second column), optionally those starting with `prefix`. */
		ledgerKeys(prefix = "") {
			if (!fs.existsSync(ledgerFile)) return [];
			return fs.readFileSync(ledgerFile, "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split("\t")[1]).filter((k) => k.startsWith(prefix));
		},
		watchedNames() {
			return YAML.parse(fs.readFileSync(rulesFile, "utf8")).agent_watch.map((a) => a.name);
		},
		mode(m) {
			process.env.FAKE_OMP_MODE = m;
		},
		/** A pane's foreground process: holds the session jsonl open as tern's child does, or holds nothing. */
		async holdPane(session) {
			const child = session
				? spawn("bash", ["-c", `exec 9<'${session}'; exec sleep 30`], { stdio: "ignore" })
				: spawn("sleep", ["30"], { stdio: "ignore" });
			f.children.push(child);
			if (session) for (let i = 0; i < 250 && !fs.existsSync(`/proc/${child.pid}/fd/9`); i++) await sleep(20);
			return child.pid;
		},
		/** A fake `tern` under HOME, which probe.sh finds first on PATH. */
		writeTern(pid, pane) {
			const tern = path.join(process.env.HOME, ".local", "bin", "tern");
			fs.mkdirSync(path.dirname(tern), { recursive: true });
			fs.writeFileSync(
				tern,
				`#!/bin/sh\ncase "$1" in\nprocess) echo '{"foreground": {"pid": ${pid}}}' ;;\ncapture) cat '${pane}' ;;\nesac\n`,
				{ mode: 0o755 },
			);
		},
		/** Writes a session jsonl at a `sessions/<proj>/<file>.jsonl` path, the layout probe.sh looks for. */
		writeSession(body) {
			const session = path.join(dir, "sessions", "proj", "s.jsonl");
			fs.mkdirSync(path.dirname(session), { recursive: true });
			fs.writeFileSync(session, body);
			return session;
		},
		/** Runs the real probe.sh (runProbe) against a fake tern and a held pane. */
		async probeTern(session, paneText, { want = false, result = "" } = {}) {
			const pane = path.join(dir, "pane.txt");
			fs.writeFileSync(pane, paneText);
			f.writeTern(await f.holdPane(session), pane);
			return runProbe({ name: "alpha", mux: "tern", pane: "1", host: "local", result }, want);
		},
	};
	return f;
}

/** A fresh temp inbox with a fake omp on PATH; env restored and the directory removed afterwards. */
async function withFixture(body) {
	const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-probe-"));
	const bin = path.join(dir, "bin");
	fs.mkdirSync(bin);
	fs.writeFileSync(path.join(bin, "omp"), OMP, { mode: 0o755 });
	process.env.PATH = `${bin}${path.delimiter}${saved.PATH ?? ""}`;
	process.env.HOME = path.join(dir, "home");
	process.env.WAYNE_INBOX_DIR = dir;
	process.env.FAKE_OMP_LOG = path.join(dir, "omp-calls.log");
	process.env.FAKE_OMP_MODE = "ok";
	const f = makeFixture(dir);
	try {
		await body(f);
	} finally {
		for (const child of f.children) child.kill();
		for (const k of ENV_KEYS) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

async function failsWith(promise, text) {
	try {
		await promise;
	} catch (e) {
		ok(String(e.message).includes(text), `expected "${text}" in: ${e.message}`);
		return;
	}
	throw new Error(`expected a failure containing "${text}"`);
}

// ---- latestLine / paneLine: the one line a session shows ----

await check("latestLine takes the newest text turn and skips tool turns", () => {
	const body = jsonl(
		assistant(textItem("older answer")),
		toolTurn(),
		{ type: "message", message: { role: "toolResult", toolName: "bash", content: [] } },
		assistant(textItem("newest  answer\n  across lines")),
		toolTurn(),
	);
	strictEqual(latestLine(body), "newest answer across lines");
});

await check("latestLine falls back to the last text when the tail is tool calls only", () => {
	strictEqual(latestLine(jsonl(assistant(textItem("the real status")), toolTurn(), toolTurn())), "the real status");
});

await check("latestLine ignores empty text items", () => {
	strictEqual(latestLine(jsonl(assistant(textItem("real")), assistant(textItem("")))), "real");
});

await check("latestLine clips long text to 300 characters with a leading ellipsis", () => {
	const result = latestLine(jsonl(assistant(textItem(`${"a".repeat(400)} tail-marker`))));
	ok(result.length <= 300, result);
	ok(result.startsWith("\u2026"));
	ok(result.endsWith("tail-marker"));
});

await check("latestLine of an empty session is no text", () => {
	strictEqual(latestLine(""), "no text");
});

await check("latestLine's todo suffix counts the latest todo result", () => {
	const body = jsonl(
		todoResult(["Plan", "completed"], ["Build", "in_progress"]),
		assistant(textItem("working")),
		todoResult(["Plan", "completed"], ["Build", "completed"], ["Wire probe", "in_progress"], ["Test", "pending"]),
		assistant(textItem("wiring the probe")),
	);
	strictEqual(latestLine(body), "wiring the probe [todo 2/4, now: Wire probe]");
});

await check("latestLine with a todo but no in-progress task and no text", () => {
	strictEqual(latestLine(jsonl(todoResult(["Plan", "completed"], ["Ship", "pending"]))), "no text [todo 1/2]");
});

await check("latestLine skips a partial first line left by a cut", () => {
	strictEqual(latestLine(`"role":"assistant","content":[{"type":"text","te\n${jsonl(assistant(textItem("ok")))}`), "ok");
});

await check("paneLine is the last non-empty line, whitespace collapsed", () => {
	strictEqual(paneLine("first\n  the   last   line  \n\n\n"), "the last line");
});

await check("paneLine of an empty or blank capture is no text", () => {
	strictEqual(paneLine(""), "no text");
	strictEqual(paneLine("  \n\n "), "no text");
});

await check("paneLine clips to 300 characters with a leading ellipsis", () => {
	const result = paneLine("y".repeat(400));
	ok(result.length <= 300 && result.startsWith("\u2026"), result);
});

// ---- the digest: what one run sends, through the real omp call ----

await check("first run sends one digest and records its time", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run();
		const [digest] = f.sent();
		const lines = digest.split("\n");
		strictEqual(lines[0], `agent progress ${HHMM}${DOT}1 changed`);
		strictEqual(lines[1], `- alpha${DOT}local${DOT}working${DOT}tail latest answer`);
		strictEqual(f.state()._digest.at, T0);
	}),
);

await check("a run two minutes later sends nothing", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run();
		f.now = T0 + 120;
		await f.run();
		strictEqual(f.sent().length, 1);
		strictEqual(f.state()._digest.at, T0);
	}),
);

await check("an unchanged session is not resent and a changed one is", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run();
		f.now = T0 + 30 * 60;
		await f.run();
		strictEqual(f.sent().length, 1, "same line as the last digest: nothing new, nothing sent");
		strictEqual(f.state()._digest.at, T0 + 30 * 60);
		f.watch("alpha", paneLive);
		f.now = T0 + 60 * 60;
		await f.run();
		strictEqual(f.sent().length, 2);
		ok(f.sent()[1].split("\n")[1].endsWith(`${DOT}last pane line`));
	}),
);

await check("a status change with the same tail is sent", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run();
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), state: "blocked", waiting: true }));
		f.now = T0 + 30 * 60;
		await f.run();
		deepStrictEqual(f.cards().map((c) => c.agents.map((r) => r.status)), [["working"], ["waiting on question"]], "same tail, new status: the user must see it now waits on them");
		strictEqual(f.cards()[0].agents[0].tail, f.cards()[1].agents[0].tail);
	}),
);

await check("only changed sessions are in the digest", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		f.watch("beta", ompLive);
		await f.run();
		f.watch("beta", paneLive);
		f.now = T0 + 120;
		await f.run({ digestMin: 0 });
		const lines = f.sent()[1].split("\n");
		ok(lines[0].endsWith(`${DOT}1 changed`), lines[0]);
		deepStrictEqual(lines.slice(1).map((line) => line.split(DOT)[0]), ["- beta"]);
	}),
);

await check("one probe per session, and the session tail is asked only when a digest is due", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run();
		f.now = T0 + 120;
		await f.run();
		deepStrictEqual(f.probes, [["alpha", true], ["alpha", false]]);
	}),
);

await check("a finished push session gets only a digest line and is not removed", () =>
	withFixture(async (f) => {
		f.watch("alpha", finished, true);
		await f.run();
		const [digest] = f.sent();
		strictEqual(digest.split("\n")[1], `- alpha${DOT}local${DOT}done${DOT}tail latest answer`);
		deepStrictEqual(f.probes, [["alpha", true]]);
		strictEqual(f.calls().length, 1);
		deepStrictEqual(f.state().alpha, { last_active: T0, last_seen: T0, digested: `done:- alpha${DOT}local${DOT}tail latest answer` });
		deepStrictEqual(f.watchedNames(), ["alpha"]);

		f.now = T0 + 120;
		await f.run();
		deepStrictEqual(f.probes, [["alpha", true]]);
		strictEqual(f.calls().length, 1);
		ok("alpha" in f.state());
	}),
);

await check("a legacy probe registration is migrated and removed on completion", () =>
	withFixture(async (f) => {
		f.watch("alpha", finished);
		const rules = YAML.parse(fs.readFileSync(path.join(f.dir, "rules.yaml"), "utf8"));
		delete rules.agent_watch[0].generation;
		fs.writeFileSync(path.join(f.dir, "rules.yaml"), YAML.stringify(rules));
		await f.run();
		deepStrictEqual(f.watchedNames(), []);
	}),
);

for (const [label, behaviour] of [
	["probe", broken],
	["line", (now, want) => ({ ...ompLive(now, want), tail: "bad" })],
]) {
	await check(`a push session whose ${label} fails reports the probe failure in the digest`, () =>
		withFixture(async (f) => {
			f.watch("alpha", behaviour, true);
			await failsWith(f.run(), "alpha:");
			strictEqual(f.calls().length, 1);
			ok(f.sent()[0].split("\n").some((line) => line.startsWith(`- alpha${DOT}local${DOT}probe failed${DOT}`)), f.sent()[0]);
		}),
	);
}

for (const waiting of [false, true]) {
	await check(`a blocked session (waiting=${waiting}) never emits stalled or idle`, () =>
		withFixture(async (f) => {
			f.watch("alpha", blocked(waiting));
			await f.run();
			f.now = T0 + 3600;
			await f.run();
			// Event lines read `<name>: <event> <state> -> <ledger reply>`; digest lines are not events.
			const events = f.logs.filter((l) => l.includes(" -> ")).map((l) => l.replace(/ -> .*/, ""));
			// Keyed on last_active (first seen at T0), so the same key every run; the ledger keeps one row for it.
			deepStrictEqual([...new Set(events)], ["alpha: blocked waiting"]);
			deepStrictEqual(f.ledgerKeys("agents:alpha:"), [`agents:alpha:blocked:${T0}`]);
		}),
	);
}

await check("a pane session's digest line uses the last non-empty pane line", () =>
	withFixture(async (f) => {
		f.watch("beta", paneLive);
		await f.run();
		strictEqual(f.sent()[0].split("\n")[1], `- beta${DOT}local${DOT}working${DOT}last pane line`);
	}),
);

for (const [label, behaviour] of [
	["all-dead", dead],
	["finished-this-run", finished],
]) {
	await check(`nothing running (${label}) sends no digest`, () =>
		withFixture(async (f) => {
			f.watch("alpha", behaviour);
			await f.run();
			strictEqual(f.calls().length, 0);
			ok(!("_digest" in f.state()));
		}),
	);
}

await check("no sessions watched sends nothing", () =>
	withFixture(async (f) => {
		await f.run();
		strictEqual(f.calls().length, 0);
		ok(!("_digest" in f.state()));
	}),
);

await check("a finished session is left out of the digest", () =>
	withFixture(async (f) => {
		f.watch("alpha", finished);
		f.watch("beta", ompLive);
		await f.run();
		const [digest] = f.sent();
		ok(!digest.includes("- alpha"), digest);
		ok(digest.split("\n")[1].startsWith(`- beta${DOT}local${DOT}working${DOT}`));
	}),
);

await check("a rewritten result with the same status and open items makes no second card", () =>
	withFixture(async (f) => {
		f.watch("alpha", partialResult("h-url"));
		await f.run();
		f.now = T0 + 120;
		await f.run();
		strictEqual(f.ledgerKeys("agents:alpha:result:").length, 1, "same status and open items, new mtime: no card");
		f.watch("alpha", partialResult("h-rollout"));
		f.now = T0 + 240;
		await f.run();
		deepStrictEqual(f.ledgerKeys("agents:alpha:result:"), [`agents:alpha:result:${T0}`, `agents:alpha:result:${T0 + 240}`]);
	}),
);

await check("a digest-only run records no ledger row and makes exactly one agent call", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run();
		deepStrictEqual(f.ledgerKeys(), []);
		strictEqual(f.calls().length, 1);
	}),
);

await check("a failed first send fails the run and records no digest time", () =>
	withFixture(async (f) => {
		f.mode("exit");
		f.watch("alpha", ompLive);
		await failsWith(f.run(), "boom: no teams token");
		ok(!("_digest" in f.state()));
	}),
);

// `ran`: whether the send reaches the fake omp (a missing binary never does, so it is not logged).
const FAILED_SENDS = [
	["omp-exit", "exit", undefined, "boom: no teams token", true],
	["omp-missing", "ok", "/nonexistent/omp-missing", "ENOENT", false],
	["teams-error", "error", undefined, "Graph 403 Forbidden", true],
	["receipt-mismatch", "receipt", undefined, "Sent to chat 19:group@thread", true],
	["message-mismatch", "message", undefined, "teams_send", true],
];
for (const [label, mode, agent, cause, ran] of FAILED_SENDS) {
	await check(`a failed send (${label}) exits 1, keeps the last digest time and the session's state`, () =>
		withFixture(async (f) => {
			f.watch("alpha", ompLive);
			await f.run();
			f.mode(mode);
			f.watch("alpha", paneLive);
			f.now = T0 + 30 * 60;
			await failsWith(f.run({ agent }), cause);
			strictEqual(f.calls().length, ran ? 3 : 1, "card, then text; a failed send is not retried inside the run");
			const state = f.state();
			deepStrictEqual(state._digest, { at: T0 });
			strictEqual(state.alpha.last_seen, T0 + 30 * 60);
			ok(state.alpha.digested.endsWith("tail latest answer"), "the unsent line is not recorded as sent");
		}),
	);
}

await check("a probe failure for one session still sends the digest", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		f.watch("beta", broken);
		await failsWith(f.run(), "ssh: connect refused");
		const [digest] = f.sent();
		const lines = digest.split("\n");
		strictEqual(lines[0], `agent progress ${HHMM}${DOT}2 changed`);
		ok(lines.includes(`- beta${DOT}local${DOT}probe failed${DOT}ssh: connect refused`), digest);
		ok(lines.includes(`- alpha${DOT}local${DOT}working${DOT}tail latest answer`), digest);
		strictEqual(f.state()._digest.at, T0);
	}),
);

await check("the digest goes out as the progress card", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		f.watch("beta", (now, want) => ({ ...ompLive(now, want), state: "blocked", waiting: true, smtime: now - 45 * 60 }));
		// Seen before with the same pane, active 45 min ago: an unchanged pane is no new activity.
		fs.mkdirSync(path.join(f.dir, "cursors"), { recursive: true });
		fs.writeFileSync(path.join(f.dir, "cursors", "agent-watch.json"), JSON.stringify({ beta: { last_active: T0 - 45 * 60, text: "pane-hash" } }));
		await f.run();
		const [card] = f.cards();
		strictEqual(card.target, "self");
		strictEqual(card.title, `agent progress ${HHMM}${DOT}2 changed`);
		strictEqual(card.message, "");
		deepStrictEqual(card.agents, [
			{ name: "alpha", host: "local", idle_min: 0, status: "working", tail: "tail latest answer" },
			{ name: "beta", host: "local", idle_min: 45, status: "waiting on question", tail: "tail latest answer" },
		]);
		strictEqual(f.calls().length, 1, "a sent card is the whole digest");
		ok(f.logs.includes(`progress digest: ${CARD_RECEIPT}`), f.logs.join("\n"));
	}),
);

await check("a refused card falls back to the text digest", () =>
	withFixture(async (f) => {
		f.mode("cardfail");
		f.watch("alpha", ompLive);
		await f.run();
		ok(f.logs.includes("progress card not sent, sending the text digest: teams_send tool error: Graph 400: card rejected"), f.logs.join("\n"));
		const [, text] = f.sent();
		strictEqual(text.split("\n")[1], `- alpha${DOT}local${DOT}last activity ${HHMM}${DOT}tail latest answer`);
		ok(f.logs.includes(`progress digest: ${SELF_RECEIPT}`), f.logs.join("\n"));
		strictEqual(f.state()._digest.at, T0);
		strictEqual(f.state().alpha.digested, `working:- alpha${DOT}local${DOT}tail latest answer`);
	}),
);

await check("a card or text send whose arguments differ from the digest does not count as sent", () =>
	withFixture(async (f) => {
		f.mode("message");
		f.watch("alpha", ompLive);
		await failsWith(f.run(), "teams_send message differs");
		ok(f.logs.some((l) => l.startsWith("progress card not sent")), f.logs.join("\n"));
		ok(!("_digest" in f.state()));
	}),
);

// ---- runProbe: probe.sh against a fake tern and a real pane process ----

await check("a default probe has no tail and hashes the pane as before", () =>
	withFixture(async (f) => {
		const pane = "pane one\npane two\n";
		const r = await f.probeTern(null, pane);
		strictEqual(r.alive, true);
		ok(!("tail" in r) && !("kind" in r));
		strictEqual(r.text, md5(Buffer.from(pane.trimEnd())));
	}),
);

for (const [label, message, state] of [
	["ask", { type: "message", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: "toolu_1", name: "ask", arguments: { questions: [{ id: "q", question: "yes or no?", options: [{ label: "yes" }] }] } }] } }, "blocked"],
	["bash", toolTurn(), ""],
]) {
	await check(`a pending ${label} tool call gives state "${state}" and is not waiting`, () =>
		withFixture(async (f) => {
			const r = await f.probeTern(f.writeSession(jsonl(message)), "pane\n");
			strictEqual(r.state, state);
			strictEqual(r.waiting, false);
		}),
	);
}

await check("want keeps the text and todo behind more than 1 MB of tool output", () =>
	withFixture(async (f) => {
		const noise = { type: "message", message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "x".repeat(100_000) }] } };
		const cut = '{"type":"message","message":{"role":"assistant","content":[{"type":"te';
		const body = `${jsonl(
			assistant(textItem("old status")),
			assistant(textItem("still working on U1")),
			todoResult(["Plan", "completed"], ["U1", "in_progress"], ["Ship", "pending"]),
			...Array.from({ length: 15 }, () => [toolTurn(), noise]).flat(),
		)}\n${cut}`;
		ok(body.length > 1_400_000, `body is ${body.length} bytes`);
		const r = await f.probeTern(f.writeSession(body), "ignored capture\n", { want: true });
		strictEqual(r.kind, "jsonl");
		ok(decodeTail(r).length < 10_000);
		strictEqual(latestLine(decodeTail(r)), "still working on U1 [todo 1/3, now: U1]");
	}),
);

await check("want tails the pane when no session is held", () =>
	withFixture(async (f) => {
		const r = await f.probeTern(null, "pane one\npane two\n", { want: true });
		strictEqual(r.kind, "pane");
		strictEqual(decodeTail(r), "pane one\npane two");
	}),
);

const RESULT_CASES = [
	["status: done\n", "done"],
	["## RESULT\n- status: done\n- commits: abc\n", "done"],
	["status: in_progress\n", "in_progress"],
	["- status: partial\n", "partial"],
	["* status: blocked\n", "blocked"],
	["**status:** done\n", "done"],
	["**status**: done\n", "done"],
	["`status`: done\n", "done"],
	["`status:` done\n", "done"],
	["- **status:** in_progress\n", "in_progress"],
	["  * `status`: partial\n", "partial"],
	["RESULT\nstatus: done | partial | blocked\ncommits: none\n", ""],
	["RESULT\nstatus: done | partial | blocked\n\nRESULT\nstatus: partial\n", "partial"],
	["RESULT\ncommits: none\n", ""],
	["the status: done today\n", ""],
];
for (const [text, status] of RESULT_CASES) {
	await check(`a RESULT ${JSON.stringify(text)} reads as status "${status}"`, () =>
		withFixture(async (f) => {
			const resultFile = path.join(f.dir, "RESULT.md");
			fs.writeFileSync(resultFile, text);
			const r = await f.probeTern(null, "pane\n", { result: resultFile });
			strictEqual(r.rstatus, status);
			strictEqual(r.rmtime, Math.floor(fs.statSync(resultFile).mtimeMs / 1000));
		}),
	);
}

// ---- the progress card's status: only a real ask needs the user ----

const probeOf = (o) => ({ alive: true, agent: "omp", state: "", session: "/s.jsonl", smtime: 0, waiting: false, text: "", rmtime: 0, rstatus: "", now: 0, ...o });
for (const [label, o, want] of [
	["a RESULT awaiting review", { rstatus: "awaiting_review", rmtime: 1, waiting: true }, "idle"],
	["a partial RESULT, turn ended", { rstatus: "partial", rmtime: 1, waiting: true }, "idle"],
	["a turn that ended with no RESULT", { waiting: true }, "idle"],
	["herdr idle, no RESULT", { agent: "", session: "", state: "idle" }, "idle"],
	["a RESULT blocked with no questions", { rstatus: "blocked", rmtime: 1, waiting: true }, "idle"],
	["a pending ask card", { state: "blocked" }, "waiting on question"],
	["herdr or hc waiting on an approval", { agent: "", session: "", state: "blocked" }, "waiting on question"],
	["a RESULT blocked with an open question", { rstatus: "blocked", ropen_text: "which branch", rmtime: 1, waiting: true }, "waiting on question"],
	["a RESULT blocked with open none", { rstatus: "blocked", ropen_text: "none", rmtime: 1 }, "idle"],
	["a RESULT blocked with open 无", { rstatus: "blocked", ropen_text: "无", rmtime: 1 }, "idle"],
	["a done RESULT", { rstatus: "done", rmtime: 1, waiting: true }, "done"],
	["output still coming", {}, "working"],
]) {
	await check(`card status: ${label} is "${want}"`, () => strictEqual(cardStatus(probeOf(o)), want));
}

for (const [label, text, want] of [
	["an open question", "status: blocked\nopen: which branch\n", "which branch"],
	["no open question", "status: blocked\nopen: none\n", "none"],
]) {
	await check(`probe.sh reads ${label} in the RESULT as ropen_text=${want}`, () =>
		withFixture(async (f) => {
			const resultFile = path.join(f.dir, "RESULT.md");
			fs.writeFileSync(resultFile, text);
			const r = await f.probeTern(null, "pane\n", { result: resultFile });
			strictEqual(r.ropen_text, want);
		}),
	);
}

await check("the last RESULT block does not inherit an older open line", () =>
	withFixture(async (f) => {
		const resultFile = path.join(f.dir, "RESULT.md");
		fs.writeFileSync(resultFile, "RESULT\nstatus: blocked\nopen: old question\n\nRESULT\nstatus: done\ncommits: none\n");
		const r = await f.probeTern(null, "pane\n", { result: resultFile });
		strictEqual(r.rstatus, "done");
		strictEqual(r.ropen_text, "");
	}),
);

await check("a quoted open question survives the probe JSON", () =>
	withFixture(async (f) => {
		const resultFile = path.join(f.dir, "RESULT.md");
		fs.writeFileSync(resultFile, "RESULT\nstatus: blocked\nopen: say \"which\" branch\n");
		const r = await f.probeTern(null, "pane\n", { result: resultFile });
		strictEqual(r.ropen_text, 'say "which" branch');
	}),
);

await check("the task-prompt RESULT template is read only from its last block", () =>
	withFixture(async (f) => {
		const template = fs.readFileSync(path.resolve(import.meta.dirname, "../../../../../_shared/task-prompt.md"), "utf8");
		const block = template.slice(template.indexOf("RESULT\nstatus: done | partial | blocked"));
		const filled = `${block}\n\n${block
			.replace("status: done | partial | blocked", "status: blocked")
			.replace("commits: <shas, or none>", "commits: none")
			.replace("artifact: <url vN, or none>", "artifact: none")
			.replace("verified: <what you ran and saw>", "verified: probe")
			.replace("open: <questions for Wayne, or none>", "open: which branch")}`;
		const resultFile = path.join(f.dir, "RESULT.md");
		fs.writeFileSync(resultFile, filled);
		const r = await f.probeTern(null, "pane\n", { result: resultFile });
		strictEqual(r.rstatus, "blocked");
		strictEqual(r.ropen_text, "which branch");
		strictEqual(cardStatus(r), "waiting on question");
	}),
);

await check("open text containing quotes stays valid JSON", () =>
	withFixture(async (f) => {
		const resultFile = path.join(f.dir, "RESULT.md");
		fs.writeFileSync(resultFile, "RESULT\nstatus: blocked\nopen: say \"which\\branch\"\n");
		const r = await f.probeTern(null, "pane\n", { result: resultFile });
		strictEqual(r.ropen_text, "say \"which\\branch\"");
	}),
);

await check("a mux command failure is an error, not a dead pane", () =>
	withFixture(async (f) => {
		const tern = path.join(process.env.HOME, ".local", "bin", "tern");
		fs.mkdirSync(path.dirname(tern), { recursive: true });
		fs.writeFileSync(tern, "#!/bin/sh\necho tern exploded >&2\nexit 7\n", { mode: 0o755 });
		await failsWith(runProbe({ name: "alpha", mux: "tern", pane: "1", host: "local", result: "" }, false), "probe command failed");
	}),
);

await check("an open value containing a tab stays valid JSON", () =>
	withFixture(async (f) => {
		const resultFile = path.join(f.dir, "RESULT.md");
		fs.writeFileSync(resultFile, "RESULT\nstatus: blocked\nopen: left\tright\n");
		const r = await f.probeTern(null, "pane\n", { result: resultFile });
		strictEqual(r.ropen_text, "left\tright");
	}),
);

await check("an open value containing a pipe stays a question", () =>
	withFixture(async (f) => {
		const resultFile = path.join(f.dir, "RESULT.md");
		fs.writeFileSync(resultFile, "RESULT\nstatus: blocked\nopen: choose A | B\n");
		const r = await f.probeTern(null, "pane\n", { result: resultFile });
		strictEqual(r.ropen_text, "choose A | B");
		strictEqual(cardStatus(r), "waiting on question");
	}),
);

await check("a CRLF RESULT stays valid JSON", () =>
	withFixture(async (f) => {
		const resultFile = path.join(f.dir, "RESULT.md");
		fs.writeFileSync(resultFile, "RESULT\r\nstatus: blocked\r\nopen: which branch\r\n");
		const r = await f.probeTern(null, "pane\n", { result: resultFile });
		strictEqual(r.rstatus, "blocked");
		strictEqual(r.ropen_text, "which branch");
	}),
);

await check("a capture command failure is a probe error and each command runs once", () =>
	withFixture(async (f) => {
		const count = path.join(f.dir, "count");
		const tern = path.join(process.env.HOME, ".local", "bin", "tern");
		fs.mkdirSync(path.dirname(tern), { recursive: true });
		fs.writeFileSync(tern, `#!/bin/sh\necho x >> '${count}'\ncase "$1" in\nprocess) echo '{"foreground": {"pid": 1}}' ;;\ncapture) echo capture exploded >&2; exit 7 ;;\nesac\n`, { mode: 0o755 });
		await failsWith(runProbe({ name: "alpha", mux: "tern", pane: "1", host: "local", result: "" }, false), "probe command failed");
		strictEqual((fs.readFileSync(count, "utf8").match(/x/g) ?? []).length, 2);
	}),
);

await check("a tmux command failure is a probe error and each command runs once", () =>
	withFixture(async (f) => {
		const count = path.join(f.dir, "count");
		const tmux = path.join(f.dir, "bin", "tmux");
		fs.writeFileSync(tmux, `#!/bin/sh\necho x >> '${count}'\necho tmux exploded >&2\nexit 7\n`, { mode: 0o755 });
		await failsWith(runProbe({ name: "alpha", mux: "tmux", pane: "1", host: "local", result: "" }, false), "probe command failed");
		strictEqual((fs.readFileSync(count, "utf8").match(/x/g) ?? []).length, 3);
	}),
);

await check("a missing mux command is an operational error", () =>
	withFixture(async (f) => {
		const tern = path.join(process.env.HOME, ".local", "bin", "tern");
		fs.rmSync(tern, { force: true });
		await failsWith(runProbe({ name: "alpha", mux: "tern", pane: "1", host: "local", result: "" }, false), "probe command failed");
	}),
);

await check("a daemon error keeps its diagnostic", () =>
	withFixture(async (f) => {
		const hc = path.join(f.dir, "bin", "hc");
		fs.writeFileSync(hc, "#!/bin/sh\necho daemon unavailable >&2\nexit 7\n", { mode: 0o755 });
		await failsWith(runProbe({ name: "alpha", mux: "hc", pane: "1", host: "local", result: "" }, false), "daemon unavailable");
	}),
);

await check("a live hc pane returns JSON without command output", () =>
	withFixture(async (f) => {
		const hc = path.join(f.dir, "bin", "hc");
		fs.writeFileSync(hc, "#!/bin/sh\ncase \"$1\" in\nget) echo '{\"state\":\"live\"}' ;;\nread) echo pane text ;;\nesac\n", { mode: 0o755 });
		const r = await runProbe({ name: "alpha", mux: "hc", pane: "1", host: "local", result: "" }, false);
		strictEqual(r.alive, true);
	}),
);

await check("a missing tmux binary is an operational error", () =>
	withFixture(async (f) => {
		const bin = path.join(f.dir, "bin");
		fs.rmSync(path.join(bin, "tmux"), { force: true });
		await failsWith(runProbe({ name: "alpha", mux: "tmux", pane: "1", host: "local", result: "" }, false), "probe command failed");
	}),
);

await check("a failing tern process query is an operational error", () =>
	withFixture(async (f) => {
		const tern = path.join(process.env.HOME, ".local", "bin", "tern");
		fs.mkdirSync(path.dirname(tern), { recursive: true });
		fs.writeFileSync(tern, "#!/bin/sh\ncase \"$1\" in\nprocess) echo process exploded >&2; exit 7 ;;\nesac\n", { mode: 0o755 });
		await failsWith(runProbe({ name: "alpha", mux: "tern", pane: "1", host: "local", result: "" }, false), "probe command failed");
	}),
);

await check("same-second registrations record separate gone events", () =>
	withFixture(async (f) => {
		f.behaviour.alpha = () => ({ alive: false, agent: "", state: "", session: "", smtime: 0, waiting: false, text: "", rmtime: 0, rstatus: "", now: f.now });
		f.behaviour.beta = f.behaviour.alpha;
		const rows = ["alpha", "beta"].map((name, i) => ({ name, mux: "tern", pane: "1", host: "local", result: "", since: "2026-11-12 20:00:00", generation: `g${i}` }));
		fs.writeFileSync(path.join(f.dir, "rules.yaml"), YAML.stringify({ agents: { "*": [{ action: "notify", tag: "agent" }] }, agent_watch: rows }));
		const out = await probeAgents({ stallMin: 30, digestMin: 30, noDigest: true, now: () => f.now * 1000, probe: async (a) => f.behaviour[a.name]() });
		const keys = fs.readFileSync(path.join(f.dir, "ledger.tsv"), "utf8").split("\n").filter((line) => line.includes("gone"));
		strictEqual(new Set(keys).size, 2);

	}),
);

await check("an agent idle awaiting review is not counted as needing the user", () =>
	withFixture(async (f) => {
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: now, rstatus: "awaiting_review" }));
		f.watch("beta", (now, want) => ({ ...ompLive(now, want), state: "blocked" }));
		await f.run();
		const [card] = f.cards();
		deepStrictEqual(card.agents.map((r) => [r.name, r.status]), [["alpha", "idle"], ["beta", "waiting on question"]]);
	}),
);

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
