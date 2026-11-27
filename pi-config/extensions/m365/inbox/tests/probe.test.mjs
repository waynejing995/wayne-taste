/**
 * The agent probe (inbox/cli/probe.ts): what a run reads from a session, the progress digest it sends, and the
 * events it records. Ported from wayne-inbox/scripts/test_watch_agents.py.
 *
 * Digests go through the real `omp` call path with a fake `omp` on PATH; probes are injected, except the
 * `runProbe` tests, which run probe.sh against a fake `tern` and a real pane process.
 *
 *   node inbox/tests/probe.test.mjs
 */
import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import YAML from "yaml";
import { AgentTailer } from "../agents.ts";
import { addAgent, readAgents } from "../cli/agents.ts";
import { inbox } from "../cli/main.ts";
import { cardStatus, latestLine, paneLine, phaseOf, probeAgents, runProbe, teamsSender } from "../cli/probe.ts";
import { isAgentSend } from "../../teams/card.ts";

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
 * Stands in for the Teams core's `send`, behind the real teamsSender: the card is the one teams/card.ts builds and the
 * text is the HTML the probe sends. `f.sendMode` decides the answer: ok, error (Teams refuses everything), cardfail
 * (the card is refused, text works), filter (a provider-style content filter refusal), hang (never answers). Every
 * call is logged in `f.sends` with what the probe asked for (`spec` or `digest`) and what reached `send`.
 */
function fakeTeams(f) {
	let asked;
	const real = teamsSender(async (target, message, html, _mentions, _images, card) => {
		f.sends.push({ ...asked, target, message, html, card });
		if (f.sendMode === "hang") return new Promise(() => {});
		if (f.sendMode === "error") throw new Error("Graph 403 Forbidden");
		if (f.sendMode === "filter") throw new Error("400 content_filter: the response was filtered");
		if (f.sendMode === "cardfail" && card) throw new Error("Graph 400: card rejected");
		return card ? CARD_RECEIPT : SELF_RECEIPT;
	});
	return {
		card: (spec) => ((asked = { spec }), real.card(spec)),
		text: (digest) => ((asked = { digest }), real.text(digest)),
		channelCard: (target, spec) => ((asked = { spec }), real.channelCard(target, spec)),
		channelText: (target, digest) => ((asked = { digest }), real.channelText(target, digest)),
	};
}

const ENV_KEYS = ["PATH", "HOME", "WAYNE_INBOX_DIR"];

function makeFixture(dir) {
	const rulesFile = path.join(dir, "rules.yaml");
	const stateFile = path.join(dir, "cursors", "agents.json");
	const ledgerFile = path.join(dir, "ledger.tsv");
	const f = {
		dir,
		now: T0,
		behaviour: {},
		probes: [],
		logs: [],
		children: [],
		sends: [],
		sendMode: "ok",
		/** Watch `name` with a fake probe; rewrites rules.yaml's agent_watch from every session watched so far. */
		watch(name, behaviour) {
			f.behaviour[name] = behaviour;
			const rows = Object.keys(f.behaviour).map((n) => ({ name: n, mux: "tern", pane: "1", host: "local", result: "" }));
			fs.writeFileSync(rulesFile, YAML.stringify({ agents: { "*": [{ action: "notify", tag: "agent" }] }, agent_watch: rows }));
		},
		/** One probe pass; `extra` overrides options (e.g. `digestMin`). The digest goes to the fake Teams send. */
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
				sender: fakeTeams(f),
				...extra,
			});
		},
		/** Every Teams send so far, refused ones included. */
		calls() {
			return f.sends;
		},
		/** What each send carried, as text: a card is its title, then one `- name · host · status · tail` line per row. */
		sent() {
			return f.sends.map((s) => (s.spec ? [s.spec.title, ...s.spec.agents.map((r) => `- ${[r.name, r.host, r.status, r.tail].join(DOT)}`)].join("\n") : s.digest));
		},
		/** The progress-card arguments of every card send: target, title, message and rows. */
		cards() {
			return f.sends.filter((s) => s.spec).map((s) => ({ target: s.target.kind, title: s.spec.title, message: s.message, agents: s.spec.agents }));
		},
		state() {
			return JSON.parse(fs.readFileSync(stateFile, "utf8"));
		},
		/** Ledger keys (the second column), optionally those starting with `prefix`. */
		ledgerKeys(prefix = "") {
			if (!fs.existsSync(ledgerFile)) return [];
			return fs.readFileSync(ledgerFile, "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split("\t")[1]).filter((k) => k.startsWith(prefix));
		},
		/** Every key ever recorded with `prefix`, archived rows first: one live row per session archives the earlier ones. */
		reportedKeys(prefix) {
			const keys = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.split("\t")[1]) : []);
			return [...keys(path.join(dir, "archive.tsv")), ...keys(ledgerFile)].filter((k) => k.startsWith(prefix));
		},
		/** The live rules tag a result row `agent-result`, which is what fires an agent-result then. */
		tagResults() {
			const rules = YAML.parse(fs.readFileSync(rulesFile, "utf8"));
			rules.agents["*"].unshift({ when: { event: "result" }, action: "do", tag: "agent-result" });
			fs.writeFileSync(rulesFile, YAML.stringify(rules));
		},
		watchedNames() {
			return YAML.parse(fs.readFileSync(rulesFile, "utf8")).agent_watch.map((a) => a.name);
		},
		mode(m) {
			f.sendMode = m;
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
		/** Runs the real probe.sh against one mux command and pane. */
		async probeMux(mux, pane, command) {
			const bin = path.join(process.env.HOME, ".local", "bin", mux);
			fs.mkdirSync(path.dirname(bin), { recursive: true });
			fs.writeFileSync(bin, `#!/bin/sh\n${command}\n`, { mode: 0o755 });
			return runProbe({ name: "alpha", mux, pane, host: "local", result: "" }, false);
		},
	};

	return f;
}
/** A fresh temp inbox with an empty `bin/` first on PATH (tests put fake mux commands there); env restored and the directory removed afterwards. */
async function withFixture(body) {
	const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-probe-"));
	fs.mkdirSync(path.join(dir, "bin"));
	process.env.PATH = `${path.join(dir, "bin")}${path.delimiter}${saved.PATH ?? ""}`;
	process.env.HOME = path.join(dir, "home");
	process.env.WAYNE_INBOX_DIR = dir;
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

const MISSING = {
	tern: { pane: "99999", command: "echo \"tern process: no block is called \`99999\`\" >&2; exit 1" },
	hc: { pane: "nope-xyz", command: "echo '{\"error\":{\"kind\":\"not_found\",\"message\":\"no terminal\"}}'; exit 3" },
	herdr: { pane: "missing-agent", command: "echo '{\"error\":{\"code\":\"agent_not_found\"}}'; exit 1" },
	tmux: { pane: "%9999", command: "echo \"can't find pane: %9999\" >&2; exit 1" },
};
for (const mux of Object.keys(MISSING)) {
	await check(`a missing ${mux} pane is not alive`, () => withFixture(async (f) => {
		const r = await f.probeMux(mux, MISSING[mux].pane, MISSING[mux].command);
		strictEqual(r.alive, false);
	}));
}
// Real tmux 3.4 output for a gone window or session (no leading dot), and for a stopped server.
for (const [what, line] of [["window", "can't find window: 9"], ["session", "can't find session: nosess"]]) {
	await check(`a missing tmux ${what} is not alive`, () => withFixture(async (f) => {
		const r = await f.probeMux("tmux", "nosess:9", `echo "${line}" >&2; exit 1`);
		strictEqual(r.alive, false);
	}));
}
for (const [mux, query, capture] of [["tmux", "display-message", "can't find window: 9"], ["tern", "process", "tern capture: no block is called `1`"], ["herdr", "get", "{\\\"error\\\":{\\\"code\\\":\\\"agent_not_found\\\"}}"]]) {
	await check(`a ${mux} pane that goes away between ${query} and the capture is not alive`, () => withFixture(async (f) => {
		const ok = mux === "tmux" ? "echo 0" : mux === "tern" ? "echo '{\"foreground\": {\"pid\": 1}}'" : "echo '{\"agent_status\": \"working\"}'";
		const r = await f.probeMux(mux, "1", `case "$*" in *${query}*) ${ok}; exit 0 ;; *) echo "${capture}" >&2; exit 1 ;; esac`);
		strictEqual(r.alive, false);
	}));
}
await check("a stopped tmux server stays a probe error", () => withFixture(async (f) => {
	await failsWith(f.probeMux("tmux", "%1", "echo 'no server running on /tmp/tmux-0/default' >&2; exit 1"), "no server running");
}));
for (const [mux, query] of [["tern", "process"], ["herdr", "get"]]) {
	await check(`a failing ${mux} ${query} is still reported when the capture fails too`, () => withFixture(async (f) => {
		const command = `case "$*" in *${query}*) echo "${query} broke" >&2 ;; *) echo "capture broke" >&2 ;; esac; exit 1`;
		const err = await f.probeMux(mux, "1", command).then(() => null, (e) => String(e.message));
		ok(err?.includes(`${query} broke`), `first error kept: ${err}`);
		ok(err?.includes("capture broke"), `second error kept: ${err}`);
	}));
}
await check("a missing mux binary stays a probe error", () => withFixture(async (f) => {
	fs.mkdirSync(path.join(process.env.HOME, ".local", "bin"), { recursive: true });
	fs.writeFileSync(path.join(process.env.HOME, ".local", "bin", "tern"), "#!/bin/sh\necho missing >&2\nexit 127\n", { mode: 0o755 });
	await failsWith(runProbe({ name: "alpha", mux: "tern", pane: "1", host: "local", result: "" }, false), "probe command failed");
}));

await check("a stopped daemon stays a probe error", () => withFixture(async (f) => {
	await failsWith(f.probeMux("herdr", "agent", "echo '{\"error\":{\"code\":\"server_not_running\"}}'; exit 1"), "probe command failed");
}));

await check("real muxes report only a missing target as not alive", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "probe-real-mux-"));
	const cleanup = [];
	const skip = (reason) => console.log(`SKIP real muxes: ${reason}`);
	try {
		if (!fs.existsSync("/usr/bin/tmux")) return skip("tmux absent");
		const socket = path.join(dir, "tmux.sock");
		cleanup.push(() => spawnSync("tmux", ["-S", socket, "kill-server"]));
		const started = spawnSync("tmux", ["-S", socket, "-f", "/dev/null", "new-session", "-d", "-s", "probe"]);
		if (started.status !== 0) return skip(started.stderr.toString());
		const missingPane = spawnSync("tmux", ["-S", socket, "capture-pane", "-p", "-t", "%999"]);
		strictEqual(missingPane.status, 1);
		match(missingPane.stderr.toString(), /can't find pane/);
		if (!fs.existsSync("/root/.local/bin/hc")) skip("hc absent");
		else {
			const terminal = spawn("hc", ["terminal", "sleep", "300"], { stdio: "ignore" });
			cleanup.push(() => terminal.kill());
			await new Promise((resolve) => setTimeout(resolve, 300));
			const missingHc = spawnSync("hc", ["get", `missing-${process.pid}`]);
			strictEqual(missingHc.status, 3);
			match(`${missingHc.stdout}\n${missingHc.stderr}`, /"kind":"not_found"/);
		}
		for (const [bin, args, pattern] of [["tern", ["process", "99999", "--json"], /no block is called/], ["herdr", ["agent", "get", `missing-${process.pid}`], /agent_not_found/]]) {
			if (!fs.existsSync(`/root/.local/bin/${bin}`)) { skip(`${bin} absent`); continue; }
			const home = path.join(dir, "herdr-home");
			const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config") };
			delete env.HERDR_CONFIG_PATH;
			if (bin === "herdr") {
				fs.mkdirSync(home, { recursive: true });
				const server = spawn(bin, ["server"], { env, stdio: "ignore" });
				cleanup.push(() => server.kill());
				const socket = path.join(home, ".config/herdr/herdr.sock");
				for (let i = 0; i < 25 && !fs.existsSync(socket); i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
			}
			const out = spawnSync(bin, args, { encoding: "utf8", env });
			ok(out.status !== 0);
			match(`${out.stdout}\n${out.stderr}`, pattern);
		}
	} finally {
		for (const fn of cleanup.reverse()) fn();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});


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
		strictEqual(f.state().digest.at, T0);
	}),
);

await check("a run two minutes later sends nothing", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run();
		f.now = T0 + 120;
		await f.run();
		strictEqual(f.sent().length, 1);
		strictEqual(f.state().digest.at, T0);
	}),
);

await check("an unchanged session is not resent and a changed one is", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run();
		f.now = T0 + 30 * 60;
		await f.run();
		strictEqual(f.sent().length, 1, "same line as the last digest: nothing new, nothing sent");
		strictEqual(f.state().digest.at, T0 + 30 * 60);
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

/** A launch id, as builds before session identity stored on entries and thens and put into row keys. */
const GEN = "11111111-1111-4111-8111-111111111111";

await check("an old entry with generation, stamped, instance and push is probed like any other, and the list is not rewritten", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		const file = path.join(f.dir, "rules.yaml");
		const rules = YAML.parse(fs.readFileSync(file, "utf8"));
		Object.assign(rules.agent_watch[0], { generation: GEN, stamped: true, instance: "first-add", push: true });
		rules.agent_watch.push({ name: "beta", mux: "tern", pane: "2", host: "local" });
		f.behaviour.beta = ompLive;
		const text = YAML.stringify(rules);
		fs.writeFileSync(file, text);
		await f.run({ noDigest: true });
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true }));
		fs.writeFileSync(file, text);
		f.now = T0 + 120;
		await f.run({ noDigest: true });
		deepStrictEqual(f.ledgerKeys("agents:alpha:"), [`agents:alpha:idle:${T0 + 120}`], "its turn end is a row keyed by the name, never by the launch id");
		strictEqual(fs.readFileSync(file, "utf8"), text);
	}),
);

await check("a watch first seen with no agent in its pane makes no row: an older build reported it", () =>
	withFixture(async (f) => {
		f.watch("alpha", dead);
		await f.run();
		f.now = T0 + 120;
		await f.run();
		deepStrictEqual(f.reportedKeys("agents:alpha:"), []);
		strictEqual(f.state().watches.alpha.phase, "gone");
	}),
);

for (const waiting of [false, true]) {
	await check(`a blocked session (waiting=${waiting}) never emits stalled or idle`, () =>
		withFixture(async (f) => {
			f.watch("alpha", blocked(waiting));
			await f.run();
			f.now = T0 + 3600;
			await f.run();
			// Event lines read `<name>: <event> <state> -> <ledger reply>`; digest lines are not events.
			const events = f.logs.filter((l) => l.includes(" -> ")).map((l) => l.replace(/ -> .*/, ""));
			// A mux that names no ask: the spell is keyed on the last output (first seen at T0), recorded on its second sighting.
			deepStrictEqual(events, ["alpha: ask approval"]);
			deepStrictEqual(f.ledgerKeys("agents:alpha:"), [`agents:alpha:ask:${T0}`]);
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

for (const [label, behaviour, calls = 0, digest = false] of [
	["all-dead", dead],
	["finished-this-run", finished, 1, true],
]) {
	await check(`nothing running (${label}) sends ${calls ? "a digest and keeps the watch" : "no digest"}`, () =>
		withFixture(async (f) => {
			f.watch("alpha", behaviour);
			await f.run();
			strictEqual(f.calls().length, calls);
			if (!digest) ok(!("digest" in f.state()));
		}),
	);
}

await check("no sessions watched sends nothing", () =>
	withFixture(async (f) => {
		await f.run();
		strictEqual(f.calls().length, 0);
		ok(!("digest" in f.state()));
	}),
);

await check("a finished session stays in the digest", () =>
	withFixture(async (f) => {
		f.watch("alpha", finished);
		f.watch("beta", ompLive);
		await f.run();
		const [digest] = f.sent();
		ok(digest.includes(`- alpha${DOT}local${DOT}done${DOT}`), digest);
		ok(digest.split("\n").some((line) => line.startsWith(`- beta${DOT}local${DOT}working${DOT}`)));
	}),
);

await check("a RESULT version makes one row, and the same version again makes none", () =>
	withFixture(async (f) => {
		const hash = "1".repeat(16);
		f.watch("alpha", (now, want) => ({ ...partialResult("h-url")(now, want), waiting: true, rhash: hash, rfile: "/runs/RESULT.md" }));
		await f.run();
		f.now = T0 + 120;
		await f.run();
		deepStrictEqual(f.reportedKeys("agents:alpha:result:"), [`agents:alpha:result:${hash}`], "same version: one row");
		const next = "2".repeat(16);
		f.watch("alpha", (now, want) => ({ ...partialResult("h-rollout")(now, want), waiting: true, rhash: next, rfile: "/runs/RESULT-p2.md" }));
		f.now = T0 + 240;
		await f.run();
		deepStrictEqual(f.reportedKeys("agents:alpha:result:"), [`agents:alpha:result:${hash}`, `agents:alpha:result:${next}`], "a new version is its own row");
	}),
);

const HASH = "3".repeat(16);

await check("a then armed on a RESULT version does not fire on its row; the next version fires it", () =>
	withFixture(async (f) => {
		const thens = path.join(f.dir, "thens.json");
		fs.writeFileSync(thens, JSON.stringify([
			{ row: "7", n: 1, when: "agent-result:alpha", action: "round 2", added: "2026-11-06 14:00", after: 0, generation: GEN, baseline: { version: HASH } },
		]));
		f.watch("alpha", (now, want) => ({ ...partialResult("h-url")(now, want), waiting: true, rhash: HASH, rfile: "/runs/RESULT.md" }));
		f.tagResults();
		await f.run();
		f.now = T0 + 120;
		await f.run();
		deepStrictEqual(f.reportedKeys("agents:alpha:result:"), [`agents:alpha:result:${HASH}`], "the version no row reported makes its one row");
		strictEqual(JSON.parse(fs.readFileSync(thens, "utf8"))[0].fired, undefined, "the RESULT version from before the then is not its answer");
		const next = "4".repeat(16);
		f.watch("alpha", (now, want) => ({ ...partialResult("h-url")(now, want), waiting: true, rhash: next, rfile: "/runs/RESULT.md" }));
		f.tagResults();
		f.now = T0 + 240;
		await f.run();
		deepStrictEqual(f.reportedKeys("agents:alpha:result:"), [`agents:alpha:result:${HASH}`, `agents:alpha:result:${next}`], "same status and open, new version: one row");
		ok(JSON.parse(fs.readFileSync(thens, "utf8"))[0].fired, "the next version fires the then");
		f.now = T0 + 360;
		await f.run();
		strictEqual(f.reportedKeys("agents:alpha:result:").length, 2, "the next probe adds nothing");
	}),
);

await check("after a done RESULT the watch still reports an ask and the agent's exit", () =>
	withFixture(async (f) => {
		const done = (p) => ({ ...p, rmtime: T0, rstatus: "done", rhash: HASH, waiting: true });
		f.watch("alpha", (now, want) => done(ompLive(now, want)));
		await f.run();
		strictEqual(f.ledgerKeys("agents:alpha:result:").length, 1);
		f.watch("alpha", (now, want) => done(blocked(false)(now, want)));
		for (const at of [120, 240]) {
			f.now = T0 + at;
			await f.run();
		}
		strictEqual(f.ledgerKeys("agents:alpha:ask:").length, 1, "an ask after done");
		f.watch("alpha", (now) => done(dead(now)));
		f.now = T0 + 360;
		await f.run();
		deepStrictEqual(f.ledgerKeys("agents:alpha:"), ["agents:alpha:gone:"], "gone after done; the ask row is archived");
		deepStrictEqual(f.watchedNames(), ["alpha"], "the watch stays");
	}),
);

await check("a digest-only run records no ledger row and makes exactly one Teams send", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run();
		deepStrictEqual(f.ledgerKeys(), []);
		strictEqual(f.calls().length, 1);
	}),
);

await check("a failed first send fails the run, naming the send, and records no digest time", () =>
	withFixture(async (f) => {
		f.mode("error");
		f.watch("alpha", ompLive);
		await failsWith(f.run(), "progress digest not sent: Teams text send: Graph 403 Forbidden");
		ok(f.logs.includes("progress card not sent, sending the text digest: Teams card send: Graph 403 Forbidden"), f.logs.join("\n"));
		ok(!("digest" in f.state()));
	}),
);

for (const [label, mode, cause] of [
	["teams-error", "error", "Graph 403 Forbidden"],
	["content-filter", "filter", "content_filter"],
]) {
	await check(`a failed send (${label}) exits 1, keeps the last digest time and the session's digest marker`, () =>
		withFixture(async (f) => {
			f.watch("alpha", ompLive);
			await f.run();
			f.mode(mode);
			f.watch("alpha", paneLive);
			f.now = T0 + 30 * 60;
			await failsWith(f.run(), cause);
			strictEqual(f.calls().length, 3, "card, then text; a failed send is not retried inside the run");
			const state = f.state();
			deepStrictEqual(state.digest, { at: T0 });
			strictEqual(state.watches.alpha.at, (T0 + 30 * 60) * 1000);
			ok(state.watches.alpha.digested.endsWith("tail latest answer"), "the unsent line is not recorded as sent");
			f.mode("ok");
			f.now = T0 + 32 * 60;
			await f.run();
			ok(f.sent().at(-1).endsWith("last pane line"), "the next due run sends what the failed one did not");
			deepStrictEqual(f.state().digest, { at: T0 + 32 * 60 });
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
		strictEqual(f.state().digest.at, T0);
	}),
);

await check("the digest goes out as the progress card, built here and sent with no model", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		f.watch("beta", (now, want) => ({ ...ompLive(now, want), state: "blocked", waiting: true, smtime: now - 45 * 60 }));
		// Seen before, active 45 min ago: the idle minutes count from the session's last output.
		fs.mkdirSync(path.join(f.dir, "cursors"), { recursive: true });
		fs.writeFileSync(path.join(f.dir, "cursors", "agents.json"), JSON.stringify({ watches: { beta: { phase: "asking", at: (T0 - 120) * 1000, by: "probe", active: T0 - 45 * 60 } } }));
		await f.run();
		const [card] = f.cards();
		strictEqual(card.target, "self");
		strictEqual(card.title, `agent progress ${HHMM}${DOT}2 changed`);
		strictEqual(card.message, "");
		deepStrictEqual(card.agents, [
			{ name: "alpha", host: "local", idle_min: 0, status: "working", tail: "tail latest answer" },
			{ name: "beta", host: "local", idle_min: 45, status: "waiting on question", tail: "tail latest answer" },
		]);
		const built = JSON.stringify(f.calls()[0].card);
		ok(built.includes(`agent progress ${HHMM}`) && built.includes("tail latest answer") && built.includes("AdaptiveCard"), "the Adaptive Card teams/card.ts builds is what is sent");
		strictEqual(f.calls().length, 1, "a sent card is the whole digest");
		ok(f.logs.includes(`progress digest: ${CARD_RECEIPT}`), f.logs.join("\n"));
		strictEqual(f.state().digest.at, T0);
		strictEqual(f.state().watches.alpha.digested, `working:- alpha${DOT}local${DOT}tail latest answer`);
	}),
);

await check("a refused card falls back to the text digest, escaped and marked as the agent's", () =>
	withFixture(async (f) => {
		f.mode("cardfail");
		f.watch("alpha", live(jsonl(assistant(textItem("a <b>tag</b> & @[Bob](bob@x.com)"))), "jsonl"));
		await f.run();
		ok(f.logs.includes("progress card not sent, sending the text digest: Teams card send: Graph 400: card rejected"), f.logs.join("\n"));
		const [, text] = f.sent();
		strictEqual(text.split("\n")[1], `- alpha${DOT}local${DOT}last activity ${HHMM}${DOT}a <b>tag</b> & @[Bob](bob@x.com)`);
		const html = f.calls()[1].message;
		ok(html.includes("a &lt;b&gt;tag&lt;/b&gt; &amp; @[Bob](bob@x.com)") && !html.includes("<b>tag"), html);
		ok(isAgentSend(html.replaceAll("<br>", "\n")), "the self-chat watch reads the text digest as the agent's");
		ok(f.logs.includes(`progress digest: ${SELF_RECEIPT}`), f.logs.join("\n"));
		strictEqual(f.state().digest.at, T0);
	}),
);

await check("a Teams send that never answers fails the run on the send's deadline, not the job's", () =>
	withFixture(async (f) => {
		f.mode("hang");
		f.watch("alpha", ompLive);
		const realTimeout = globalThis.setTimeout;
		// The send deadline (120 s) fires at once; everything else keeps its own timing.
		globalThis.setTimeout = (fn, ms, ...rest) => realTimeout(fn, ms === 120_000 ? 0 : ms, ...rest);
		try {
			await failsWith(f.run(), "progress digest not sent: Teams text send: timed out after 120s");
		} finally {
			globalThis.setTimeout = realTimeout;
		}
		ok(f.logs.includes("progress card not sent, sending the text digest: Teams card send: timed out after 120s"), f.logs.join("\n"));
		ok(!("digest" in f.state()));
	}),
);

// ---- runProbe: probe.sh against a fake tern and a real pane process ----

await check("a default probe has no tail and hashes the pane as before", () =>
	withFixture(async (f) => {
		const pane = "pane one\npane two\n";
		const r = await f.probeTern(null, pane);
		strictEqual(r.alive, true);
		ok(!("tail" in r) && !("kind" in r));
		strictEqual(r.text, md5(Buffer.from(pane)));
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
		strictEqual(decodeTail(r), "pane one\npane two\n");
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

for (const [label, o, want] of [
	["a dead pane", { alive: false, waiting: true }, "gone"],
	["a pending ask", { state: "blocked", waiting: true }, "asking"],
	["an ended turn", { waiting: true }, "idle"],
	["a mux that says idle", { state: "idle" }, "idle"],
	["a mux that says done", { state: "done" }, "idle"],
	["a running turn", {}, "working"],
]) {
	await check(`phase: ${label} is ${want}`, () => strictEqual(phaseOf(probeOf(o)), want));
}

await check("probe.sh reads the RESULT block's last verified line as rverified", () =>
	withFixture(async (f) => {
		const resultFile = path.join(f.dir, "RESULT.md");
		fs.writeFileSync(resultFile, "RESULT\nstatus: done\n- **verified:** unit tests\nverified: `node tests/run.mjs` all green\nopen: none\n");
		const r = await f.probeTern(null, "pane\n", { result: resultFile });
		strictEqual(r.rverified, "`node tests/run.mjs` all green");
		fs.writeFileSync(resultFile, "RESULT\nstatus: done\n");
		strictEqual((await f.probeTern(null, "pane\n", { result: resultFile })).rverified, "");
	}),
);

/** Mark one of the fixture's watches as acknowledged by `inbox agent close`. */
const markClosing = (f, name) => {
	const file = path.join(f.dir, "rules.yaml");
	const rules = YAML.parse(fs.readFileSync(file, "utf8"));
	for (const a of rules.agent_watch.filter((entry) => entry.name === name)) Object.assign(a, { since: "2026-11-06 14:00:00", closing: { at: "2026-11-06 14:00", ack: "none", note: "read it" } });
	// 1.1, as the CLI writes the list: the `since` stamp stays a quoted string, not a YAML timestamp.
	fs.writeFileSync(file, YAML.stringify(rules, { version: "1.1" }));
};

await check("the probe removes a closing entry whose pane is gone, with no gone row", () =>
	withFixture(async (f) => {
		f.watch("alpha", dead);
		f.watch("beta", ompLive);
		markClosing(f, "alpha");
		await f.run({ noDigest: true });
		deepStrictEqual(f.watchedNames(), ["beta"]);
		deepStrictEqual(f.reportedKeys("agents:alpha:"), []);
		ok(f.logs.some((line) => line === "alpha: closed, pane gone -> watch removed"), f.logs.join("\n"));
	}),
);

await check("a closing entry whose pane is alive stays, and its new RESULT version is still recorded before it is removed", () =>
	withFixture(async (f) => {
		const hash = "e".repeat(16);
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true }));
		markClosing(f, "alpha");
		await f.run({ noDigest: true });
		deepStrictEqual(f.watchedNames(), ["alpha"]);
		deepStrictEqual(f.probes, [["alpha", false]], "a closing push entry is probed on every pass");
		deepStrictEqual(f.reportedKeys("agents:alpha:"), [], "an acknowledged idle session makes no row");
		f.behaviour.alpha = (now) => ({ ...dead(now), rmtime: now, rstatus: "done", rhash: hash, rfile: "/runs/RESULT.md" });
		f.now = T0 + 120;
		await f.run({ noDigest: true });
		deepStrictEqual(f.reportedKeys("agents:alpha:"), [`agents:alpha:result:${hash}`]);
		deepStrictEqual(f.watchedNames(), []);
	}),
);

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

await check("a later bare Result heading in the body does not hide the RESULT block above it", () =>
	withFixture(async (f) => {
		const resultFile = path.join(f.dir, "RESULT.md");
		fs.writeFileSync(resultFile, "RESULT\nstatus: blocked\nopen: which branch\n\nResult\nThe suite ran green; details below.\n");
		const r = await f.probeTern(null, "pane\n", { result: resultFile });
		strictEqual(r.rstatus, "blocked");
		strictEqual(r.ropen_text, "which branch");
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
		await failsWith(runProbe({ name: "alpha", mux: "tern", pane: "1", host: "local", result: "" }, false), "capture exploded");
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
		fs.mkdirSync(path.dirname(tern), { recursive: true });
		fs.writeFileSync(tern, "#!/bin/sh\necho missing >&2\nexit 127\n", { mode: 0o755 });
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
		fs.writeFileSync(path.join(bin, "tmux"), "#!/bin/sh\necho missing >&2\nexit 127\n", { mode: 0o755 });
		process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
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

await check("real tern capture keeps trailing newlines and status", () => withFixture(async (f) => {
	const tern = path.join(process.env.HOME, ".local", "bin", "tern");
	fs.mkdirSync(path.dirname(tern), { recursive: true });
	fs.writeFileSync(tern, "#!/bin/sh\ncase \"$1\" in\nprocess) printf '{\\\"foreground\\\":{\\\"pid\\\":1}}\\n\\n' ;;\ncapture) printf 'pane\\n\\n' ;;\nesac\n", { mode: 0o755 });
	const r = await runProbe({ name: "alpha", mux: "tern", pane: "1", host: "local", result: "" }, true);
	strictEqual(r.alive, true);
	strictEqual(decodeTail(r).endsWith("pane\n\n"), true);
}));
await check("RESULT version: same content twice is one row; a rename is not new; a new file is", () =>
	withFixture(async (f) => {
		const dir = path.join(f.dir, "run");
		fs.mkdirSync(dir);
		const result = path.join(dir, "RESULT.md");
		fs.writeFileSync(result, "RESULT\nstatus: done\n");
		const hash = createHash("sha256").update(fs.readFileSync(result)).digest("hex").slice(0, 16);
		const key = `agents:alpha:result:${hash}`;
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: now, rstatus: "done", rhash: hash, rfile: result }));
		f.watch = ((watch) => (name, behaviour, ...rest) => {
			watch(name, behaviour, ...rest);
			const rules = YAML.parse(fs.readFileSync(path.join(f.dir, "rules.yaml"), "utf8"));
			rules.agent_watch[0].result = result;
			fs.writeFileSync(path.join(f.dir, "rules.yaml"), YAML.stringify(rules));
		})(f.watch.bind(f));
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: now, rstatus: "done", rhash: hash, rfile: result }));
		await f.run({ noDigest: true });
		f.now = T0 + 120;
		await f.run({ noDigest: true });
		deepStrictEqual(f.reportedKeys("agents:alpha:result:"), [key], "same content twice: one result row");
		const renamed = path.join(dir, "RESULT-round1.md");
		fs.renameSync(result, renamed);
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: now, rstatus: "done", rhash: hash, rfile: renamed }));
		f.now = T0 + 240;
		await f.run({ noDigest: true });
		deepStrictEqual(f.reportedKeys("agents:alpha:result:"), [key], "a rename of the same content is not a new result");
		const next = path.join(dir, "RESULT-p4.md");
		fs.writeFileSync(next, "RESULT\nstatus: partial\n");
		const nextHash = createHash("sha256").update(fs.readFileSync(next)).digest("hex").slice(0, 16);
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: now, rstatus: "partial", rhash: nextHash, rfile: next }));
		f.now = T0 + 360;
		await f.run({ noDigest: true });
		deepStrictEqual(f.reportedKeys("agents:alpha:result:"), [key, `agents:alpha:result:${nextHash}`], "a new RESULT file with a status is one row");
	}),
);

await check("a turn end with an unchanged RESULT makes no result row and one no-result row carrying the last output", () =>
	withFixture(async (f) => {
		const hash = "a".repeat(16);
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: now, rstatus: "done", rhash: hash, rfile: "/runs/RESULT.md", last: gzipSync(Buffer.from(jsonl(assistant(textItem("still the same answer"))))).toString("base64") }));
		await f.run({ noDigest: true });
		f.now = T0 + 120;
		await f.run({ noDigest: true });
		strictEqual(f.reportedKeys("agents:alpha:result:").length, 1, "the unchanged RESULT is not a second result row");
		const idle = f.ledgerKeys("agents:alpha:").filter((k) => k.includes(":idle:"));
		strictEqual(idle.length, 1, "one no-result row for the turn end");
		const note = fs.readFileSync(path.join(f.dir, "ledger.tsv"), "utf8").split("\n").find((line) => line.includes(":idle:"));
		ok(note.includes("turn ended with no new RESULT. Last output: still the same answer"), note);
	}),
);

await check("legacyReported suppresses the first version row after a deploy", () =>
	withFixture(async (f) => {
		const hash = "b".repeat(16);
		const minute = new Date(T0 * 1000);
		const stamp = `${minute.getFullYear()}-${pad(minute.getMonth() + 1)}-${pad(minute.getDate())} ${pad(minute.getHours())}:${pad(minute.getMinutes())}`;
		fs.writeFileSync(path.join(f.dir, "archive.tsv"), `id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink\n1\tagents:alpha:${GEN}:s1:1\tagent alpha\t${stamp}\tagents\tagent-result\tdo\tdone\tcoordinator\tclosed with a rewritten note\t\n`);
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: T0, rstatus: "done", rhash: hash, rfile: "/runs/RESULT.md" }));
		await f.run({ noDigest: true });
		deepStrictEqual(f.ledgerKeys("agents:alpha:result:"), [], "a version the old build already reported makes no row");
	}),
);

await check("one live row per session: a second row archives the first, a claimed row stays", () =>
	withFixture(async (f) => {
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), state: "blocked" }));
		await f.run({ noDigest: true });
		f.now = T0 + 60;
		await f.run({ noDigest: true });
		const ledger = fs.readFileSync(path.join(f.dir, "ledger.tsv"), "utf8").split("\n");
		const blocked = ledger.find((line) => line.includes(":ask:"));
		ok(blocked, ledger.join("\n"));
		const claimed = blocked.replace("\topen\t", "\tclaimed\t");
		fs.writeFileSync(path.join(f.dir, "ledger.tsv"), ledger.map((line) => (line === blocked ? claimed : line)).join("\n"));
		const hash = "c".repeat(16);
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: now, rstatus: "done", rhash: hash, rfile: "/runs/RESULT.md" }));
		f.now = T0 + 120;
		await f.run({ noDigest: true });
		const live = fs.readFileSync(path.join(f.dir, "ledger.tsv"), "utf8");
		ok(live.includes(":ask:") && live.includes("claimed"), "a claimed row stays live");
		ok(live.includes(`agents:alpha:result:${hash}`), live);
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true }));
		f.now = T0 + 240;
		await f.run({ noDigest: true });
		const archive = fs.readFileSync(path.join(f.dir, "archive.tsv"), "utf8");
		ok(archive.includes(`agents:alpha:result:${hash}`) && archive.includes("superseded by #"), archive);
		ok(!fs.readFileSync(path.join(f.dir, "ledger.tsv"), "utf8").includes(`agents:alpha:result:${hash}`), "the superseded result row left the ledger");
	}),
);

await check("a result row no session was shown yet stays live when the next row of the session comes", () =>
	withFixture(async (f) => {
		const cursor = path.join(f.dir, "cursors", "session-push.id");
		fs.mkdirSync(path.dirname(cursor), { recursive: true });
		fs.writeFileSync(cursor, "0\n");
		const hash = "d".repeat(16);
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: now, rstatus: "done", rhash: hash, rfile: "/runs/RESULT.md" }));
		await f.run({ noDigest: true });
		f.watch("alpha", (now) => ({ ...dead(now), rmtime: T0, rstatus: "done", rhash: hash, rfile: "/runs/RESULT.md" }));
		f.now = T0 + 120;
		await f.run({ noDigest: true });
		deepStrictEqual(f.ledgerKeys("agents:alpha:").sort(), [`agents:alpha:gone:`, `agents:alpha:result:${hash}`].sort(), "delivery has not reached the result row: it stays beside the gone row");
		const resultId = fs.readFileSync(path.join(f.dir, "ledger.tsv"), "utf8").split("\n").find((l) => l.includes(`:result:${hash}`)).split("\t")[0];
		fs.writeFileSync(cursor, `${resultId}\n`);
		f.watch("alpha", (now, want) => ({ ...blocked(false)(now, want), rmtime: T0, rstatus: "done", rhash: hash, rfile: "/runs/RESULT.md" }));
		for (const at of [240, 360]) {
			f.now = T0 + at;
			await f.run({ noDigest: true });
		}
		ok(f.ledgerKeys("agents:alpha:ask:").length === 1, f.ledgerKeys("agents:alpha:").join(" "));
		ok(!f.ledgerKeys("agents:alpha:").includes(`agents:alpha:result:${hash}`), "once delivered, the result row is superseded as before");
	}),
);

await check("a probe that recorded a row runs checkThens in the same process", () =>
	withFixture(async (f) => {
		fs.writeFileSync(path.join(f.dir, "ledger.tsv"), "id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink\n7\task:row\trow\t2026-11-06 14:00\tcoordinator\task-wayne\tnotify\topen\twayne\t\t\n");
		fs.writeFileSync(path.join(f.dir, "thens.json"), JSON.stringify([
			{ row: "7", n: 1, when: "agent-result:alpha", action: "report it", added: "2026-11-06 14:00", after: 0, generation: GEN, baseline: { version: "0".repeat(16) } },
		]));
		const hash = "d".repeat(16);
		f.watch("alpha", (now, want) => ({ ...ompLive(now, want), waiting: true, rmtime: now, rstatus: "done", rhash: hash, rfile: "/runs/RESULT.md" }));
		f.tagResults();
		await f.run({ noDigest: true });
		ok(f.logs.some((line) => line.startsWith("fired 7.1")), f.logs.join("\n"));
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

// ---- one state record per watch (cursors/agents.json), written by the probe and by the event tailer ----

const gz = (value) => gzipSync(Buffer.from(value)).toString("base64");
const askCall = (id, question) => ({ type: "message", message: { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id, name: "ask", arguments: { questions: [{ id: "q", question, options: [{ label: "yes" }, { label: "no" }] }] } }] } });
const asking = (id, question) => (now, want) => ({ ...ompLive(now, want), state: "blocked", ask: gz(jsonl(askCall(id, question))) });
const idleNow = (now, want) => ({ ...ompLive(now, want), waiting: true });
const ledgerLines = (f, file = "ledger.tsv") => (fs.existsSync(path.join(f.dir, file)) ? fs.readFileSync(path.join(f.dir, file), "utf8").split("\n").slice(1).filter(Boolean) : []);
/** Feed reporter events for `alpha` through the real tailer, recording through the real CLI. */
async function tail(f, ...events) {
	fs.appendFileSync(path.join(f.dir, "agent-events.jsonl"), events.map(([type, at, extra = {}], i) => `${JSON.stringify({ v: 1, ts: new Date(at * 1000).toISOString(), name: "alpha", pid: 17, session: "sess", seq: at * 10 + i, type, ...extra })}\n`).join(""));
	const warnings = [];
	const tailer = new AgentTailer({ dir: f.dir, inbox, warn: (w) => warnings.push(w) });
	tailer.start();
	await tailer.poke();
	tailer.stop();
	deepStrictEqual(warnings, []);
}

await check("both sensors on one turn end make one row", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run({ noDigest: true });
		// The probe comes first: the event of the same turn end adds nothing.
		f.watch("alpha", idleNow);
		f.now = T0 + 120;
		await f.run({ noDigest: true });
		await tail(f, ["idle", T0 + 121, { text: "round one over" }]);
		strictEqual(f.reportedKeys("agents:alpha:").length, 1, f.reportedKeys("agents:alpha:").join(" "));
		strictEqual(f.state().watches.alpha.phase, "idle");
		// The event comes first: the probe that then sees the ended turn adds nothing.
		await tail(f, ["working", T0 + 180], ["idle", T0 + 200, { text: "round two over" }]);
		f.now = T0 + 240;
		await f.run({ noDigest: true });
		strictEqual(f.reportedKeys("agents:alpha:").length, 2, f.reportedKeys("agents:alpha:").join(" "));
		strictEqual(f.ledgerKeys("agents:alpha:").length, 1, "one live row per session");
		ok(ledgerLines(f)[0].includes("Last output: round two over"), ledgerLines(f)[0]);
	}),
);

await check("an old event after a newer probe changes nothing", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run({ noDigest: true });
		f.now = T0 + 300;
		await f.run({ noDigest: true });
		const before = f.state().watches.alpha;
		await tail(f, ["idle", T0 + 100, { text: "an old turn end" }], ["ask", T0 + 101, { ask: { kind: "ask", question: "old?" } }]);
		deepStrictEqual(f.reportedKeys("agents:alpha:"), []);
		deepStrictEqual(f.state().watches.alpha, before);
		strictEqual(before.by, "probe");
	}),
);

await check("gone is a pane that holds only a shell; the row carries the resume line of the stored agent", () =>
	withFixture(async (f) => {
		const session = f.writeSession(jsonl(toolTurn()));
		const pane = path.join(f.dir, "pane.txt");
		fs.writeFileSync(pane, "pane\n");
		const agentPid = await f.holdPane(session);
		f.writeTern(agentPid, pane);
		f.watch("alpha", null);
		const real = { noDigest: true, probe: (a, want) => runProbe(a, want) };
		await f.run(real);
		const seen = f.state().watches.alpha;
		strictEqual(seen.phase, "working");
		deepStrictEqual(seen.agent, { pid: agentPid, session: "s", sessionFile: session, cwd: process.cwd() });
		// The agent exited; the pane is back at its shell.
		const shell = spawn("bash", ["-c", "read x; :"], { stdio: ["pipe", "ignore", "ignore"] });
		f.children.push(shell);
		f.writeTern(shell.pid, pane);
		const p = await runProbe({ name: "alpha", mux: "tern", pane: "1", host: "local", result: "" }, false);
		strictEqual(p.alive, true);
		strictEqual(p.agent_pid, 0);
		strictEqual(phaseOf(p), "gone");
		f.now = T0 + 120;
		await f.run(real);
		deepStrictEqual(f.ledgerKeys("agents:alpha:"), [`agents:alpha:gone:${agentPid}`]);
		const [line] = ledgerLines(f);
		ok(line.includes(`no agent process in tern pane 1 on local. RESULT status: none. Resume: cd ${process.cwd()} && omp --resume s, then inbox agent add alpha --mux tern --pane <new pane>`), line);
		ok(f.logs.some((l) => l.startsWith("alpha: ended gone -> ")), f.logs.join("\n"));
		deepStrictEqual(f.state().watches.alpha.agent, seen.agent, "the agent is kept after gone");
		f.now = T0 + 240;
		await f.run(real);
		strictEqual(f.reportedKeys("agents:alpha:").length, 1, "gone is reported once");
	}),
);

await check("a first ask sighting makes no row, the second makes one with the question, a resolved ask archives it", () =>
	withFixture(async (f) => {
		f.watch("alpha", asking("toolu_9", "ship it now?"));
		await f.run({ noDigest: true });
		deepStrictEqual(f.reportedKeys("agents:alpha:"), []);
		deepStrictEqual(f.state().watches.alpha.ask, { id: "toolu_9", sightings: 1 });
		f.now = T0 + 120;
		await f.run({ noDigest: true });
		deepStrictEqual(f.ledgerKeys("agents:alpha:"), ["agents:alpha:ask:toolu_9"]);
		ok(ledgerLines(f)[0].includes("waiting on ask: ship it now? [options: yes | no]"), ledgerLines(f)[0]);
		ok(f.logs.some((l) => l.startsWith("alpha: ask ask -> ")), f.logs.join("\n"));
		f.now = T0 + 240;
		await f.run({ noDigest: true });
		strictEqual(f.reportedKeys("agents:alpha:").length, 1, "a third sighting adds nothing");
		f.watch("alpha", ompLive);
		f.now = T0 + 360;
		await f.run({ noDigest: true });
		deepStrictEqual(f.ledgerKeys("agents:alpha:"), []);
		const [archived] = ledgerLines(f, "archive.tsv");
		ok(archived.includes("agents:alpha:ask:toolu_9") && archived.includes("[ask resolved in the session]"), archived);
		strictEqual(f.state().watches.alpha.ask, undefined);
	}),
);

await check("a probed ask makes no row while a live row of the session already says what it waits on", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await f.run({ noDigest: true });
		await tail(f, ["ask", T0 + 10, { ask: { kind: "ask", question: "ship it now?" } }]);
		strictEqual(f.ledgerKeys("agents:alpha:ask:").length, 1);
		f.watch("alpha", asking("toolu_9", "ship it now?"));
		for (const at of [120, 240, 360]) {
			f.now = T0 + at;
			await f.run({ noDigest: true });
		}
		strictEqual(f.reportedKeys("agents:alpha:").length, 1, f.reportedKeys("agents:alpha:").join(" "));
	}),
);

await check("an ask the session reports is a row at once, and its answer archives the row", () =>
	withFixture(async (f) => {
		f.watch("alpha", ompLive);
		await tail(f, ["ask", T0 + 10, { ask: { id: "toolu_3", kind: "ask", question: "which branch?", options: ["main", "dev"] } }]);
		deepStrictEqual(f.ledgerKeys("agents:alpha:"), ["agents:alpha:ask:toolu_3"]);
		ok(ledgerLines(f)[0].includes("waiting on ask: which branch? [options: main | dev]"), ledgerLines(f)[0]);
		strictEqual(f.state().watches.alpha.phase, "asking");
		await tail(f, ["ask-resolved", T0 + 20]);
		deepStrictEqual(f.ledgerKeys("agents:alpha:"), []);
		ok(ledgerLines(f, "archive.tsv")[0].includes("[ask resolved in the session]"), ledgerLines(f, "archive.tsv")[0]);
		strictEqual(f.state().watches.alpha.phase, "working");
	}),
);

await check("agent add probes the pane first: a missing pane and a pane with no agent process are refused, and nothing is written", () =>
	withFixture(async (f) => {
		const add = (pane) => inbox(["agent", "add", "alpha", "--mux", "tern", "--pane", pane]).then((out) => `added: ${out}`, (e) => e.message);
		fs.mkdirSync(path.join(process.env.HOME, ".local", "bin"), { recursive: true });
		fs.writeFileSync(path.join(process.env.HOME, ".local", "bin", "tern"), `#!/bin/sh\n${MISSING.tern.command}\n`, { mode: 0o755 });
		strictEqual(await add("99999"), "no tern pane 99999 on local: nothing to watch. Not added.");
		const shell = spawn("bash", ["-c", "read x; :"], { stdio: ["pipe", "ignore", "ignore"] });
		f.children.push(shell);
		const pane = path.join(f.dir, "pane.txt");
		fs.writeFileSync(pane, "$ \n");
		f.writeTern(shell.pid, pane);
		strictEqual(await add("1"), "tern pane 1 on local holds no agent process, only shells: start the session there first. Not added.");
		deepStrictEqual([readAgents(), fs.existsSync(path.join(f.dir, "cursors", "agents.json")), fs.existsSync(path.join(f.dir, "thens.json"))], [[], false, false]);
	}),
);

await check("agent add prints what it attached to (pid, session, phase, RESULT, reporter events, the armed then) and binds the record", () =>
	withFixture(async (f) => {
		const dir = path.join(f.dir, "sessions", "proj");
		fs.mkdirSync(dir, { recursive: true });
		const session = path.join(dir, "2026-11-06T14-00-00-000Z_01a1-sess.jsonl");
		fs.writeFileSync(session, jsonl(assistant(textItem("round one done"))));
		const pane = path.join(f.dir, "pane.txt");
		fs.writeFileSync(pane, "pane\n");
		const agentPid = await f.holdPane(session);
		f.writeTern(agentPid, pane);
		const result = path.join(f.dir, "run", "RESULT.md");
		fs.mkdirSync(path.dirname(result));
		fs.writeFileSync(result, "status: partial\nopen: none\n");
		const version = createHash("sha256").update("status: partial\nopen: none\n").digest("hex").slice(0, 16);
		// The host's event file: two lines of this session, one of another.
		const line = (id, seq) => JSON.stringify({ v: 1, ts: "2026-11-06T14:00:00.000Z", name: "", pid: agentPid, session: id, seq, type: "working" });
		fs.writeFileSync(path.join(f.dir, "agent-events.jsonl"), `${line("01a1-sess", 1)}\n${line("01a1-other", 2)}\n${line("01a1-sess", 3)}\n`);
		fs.writeFileSync(path.join(f.dir, "rules.yaml"), YAML.stringify({ agents: { "*": [{ action: "notify", tag: "agent" }] } }));
		const row = (await inbox(["ask", "fix it", "--key", "fix"])).split(" ")[1];
		const out = await inbox(["agent", "add", "alpha", "--mux", "tern", "--pane", "1", "--result", result, "--goal", "fix it", "--row", row, "--then", "read it and reply"]);
		strictEqual(out, [
			"watching alpha: tern pane 1 on local",
			`agent pid ${agentPid}, session 01a1-sess, phase idle`,
			`RESULT ${result}, status partial, version ${version}`,
			"reporter events of this session on local: 2",
			`then ${row}.1 waits for agent-result:alpha`,
		].join("\n"));
		deepStrictEqual(Object.keys(readAgents()[0]), ["name", "mux", "host", "pane", "result", "goal", "since"]);
		const seen = f.state().watches.alpha;
		deepStrictEqual([seen.phase, seen.by, seen.agent], ["idle", "probe", { pid: agentPid, session: "01a1-sess", sessionFile: session, cwd: process.cwd() }]);
		deepStrictEqual(JSON.parse(fs.readFileSync(path.join(f.dir, "thens.json"), "utf8")).map((t) => [t.action, t.baseline, t.generation]), [["read it and reply", { version }, undefined]]);
		// A session with no reporter events is still watched, and the print says who watches it.
		fs.rmSync(path.join(f.dir, "agent-events.jsonl"));
		match(await inbox(["agent", "add", "alpha", "--mux", "tern", "--pane", "1"]), /\nreporter events of this session on local: 0 \(no reporter has written for it: only the probe watches it\)\nno plan armed$/);
	}),
);

await check("a re-add of the session a name already watches keeps its record; another session under the name starts a new one", () =>
	withFixture(async (f) => {
		const p = (pid, session) => async () => ({ ...ompLive(T0, false), agent_pid: pid, session: `/sessions/p/t_${session}.jsonl`, cwd: "/w" });
		const add = (probe) => addAgent({ name: "alpha", mux: "tern", pane: "1" }, probe);
		await add(p(41, "s1"));
		const records = path.join(f.dir, "cursors", "agents.json");
		const state = f.state();
		Object.assign(state.watches.alpha, { phase: "asking", by: "event", digested: "sent" });
		fs.writeFileSync(records, JSON.stringify(state));
		await add(p(41, "s1"));
		deepStrictEqual([f.state().watches.alpha.phase, f.state().watches.alpha.digested], ["asking", "sent"], "the same session: what was known of it stays");
		await add(p(42, "s2"));
		deepStrictEqual(f.state().watches.alpha, { phase: "working", at: T0 * 1000, by: "probe", active: T0, agent: { pid: 42, session: "s2", sessionFile: "/sessions/p/t_s2.jsonl", cwd: "/w" } });
	}),
);

await check("stall and turn-end rows carry the session; a stall an older build keyed by launch id is not reported again", () =>
	withFixture(async (f) => {
		const quiet = (now, want) => ({ ...ompLive(now, want), smtime: T0, agent_pid: 41, session: "/sessions/p/t_s1.jsonl", cwd: "/w" });
		f.watch("alpha", quiet);
		f.watch("beta", quiet);
		await f.run({ noDigest: true });
		// What the older build made for beta's quiet spell.
		const stamp = (s) => { const d = new Date(s * 1000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
		fs.writeFileSync(path.join(f.dir, "archive.tsv"), `id\tkey\tsubject\tfirst_seen\tsource\ttag\taction\tstate\towner\tnote\tlink\n1\tagents:beta:${GEN}:stalled:${T0}\tagent beta\t${stamp(T0 + 1800)}\tagents\tagent\tnotify\tdone\t\tno output for 30 min\t\n`);
		f.now = T0 + 31 * 60;
		await f.run({ noDigest: true });
		deepStrictEqual(f.ledgerKeys("agents:"), [`agents:alpha:s1:stalled:${T0}`]);
		f.watch("alpha", (now, want) => ({ ...quiet(now, want), smtime: T0 + 32 * 60, waiting: true }));
		f.now = T0 + 33 * 60;
		await f.run({ noDigest: true });
		deepStrictEqual(f.ledgerKeys("agents:alpha:"), [`agents:alpha:s1:idle:${T0 + 32 * 60}`]);
	}),
);

await check("the record of a name that is no longer watched is deleted on the next probe; the old state files are ignored", () =>
	withFixture(async (f) => {
		fs.mkdirSync(path.join(f.dir, "cursors"), { recursive: true });
		fs.writeFileSync(path.join(f.dir, "cursors", "agent-watch.json"), JSON.stringify({ alpha: { last_active: T0 - 7200, alive: true }, _digest: { at: T0 } }));
		f.watch("alpha", idleNow);
		f.watch("beta", ompLive);
		await f.run();
		strictEqual(f.sent().length, 1, "the old digest time is not read");
		deepStrictEqual(f.reportedKeys("agents:"), [], "a first observation makes no row");
		deepStrictEqual(Object.keys(f.state().watches).sort(), ["alpha", "beta"]);
		delete f.behaviour.alpha;
		f.watch("beta", ompLive);
		f.now = T0 + 120;
		await f.run();
		deepStrictEqual(Object.keys(f.state().watches), ["beta"]);
	}),
);

console.log(failed === 0 ? "all green" : `${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
