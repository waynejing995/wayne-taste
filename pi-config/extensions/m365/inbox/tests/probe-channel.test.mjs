/**
 * The agent probe's personal-channel routing (inbox/cli/probe.ts): with a `mode: personal` channel in rules.yaml,
 * each changed session's progress goes to its own thread, not the self-chat digest.
 *
 * Offline and deterministic: the Teams send is a mock behind the real teamsSender, WAYNE_INBOX_DIR is a temp
 * directory, and nothing reaches Graph.
 *
 *   node inbox/tests/probe-channel.test.mjs
 */
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gzipSync } from "node:zlib";
import YAML from "yaml";

// Point WAYNE_INBOX_DIR and HOME at a throwaway root before importing modules so no module-load read can touch live files.
const BOOT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-probe-channel-boot-"));
const SAVED_ENV = { WAYNE_INBOX_DIR: process.env.WAYNE_INBOX_DIR, HOME: process.env.HOME };
process.env.WAYNE_INBOX_DIR = BOOT_ROOT;
process.env.HOME = path.join(BOOT_ROOT, "home");

const { addAgent, readAgents } = await import("../cli/agents.ts");
const { InboxError } = await import("../cli/ledger.ts");
const { probeAgents, teamsSender } = await import("../cli/probe.ts");
const { isAgentSend } = await import("../../teams/card.ts");
const { cursorPath } = await import("../../teams/cursor-store.ts");

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

// Fake fixtures only: no real team, channel, or user identifiers.
const TEAM = "team-1";
const CHANNEL = "19:fake-channel@thread.skype";
const KEY = `channel:${TEAM}/${CHANNEL}`;
const T0 = Date.UTC(2026, 10, 6, 14, 0) / 1000;

const ompTail = gzipSync(Buffer.from(JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "working on it" }], stopReason: "stop" } }))).toString("base64");
const ompLive = (now, want) => ({
	alive: true,
	agent: "omp",
	state: "",
	session: "/s.jsonl",
	smtime: now,
	waiting: false,
	text: "pane-hash",
	rmtime: 0,
	rstatus: "",
	now,
	...(want ? { kind: "jsonl", tail: ompTail } : {}),
});

/**
 * The Teams transport behind the real teamsSender. A root post (channel, no replyTo) answers with a deterministic id
 * and the text, the way Teams does; every call is recorded so a test can see where each card went.
 */
function fakeTransport(f) {
	let roots = 0;
	return async (target, message, html, _mentions, _images, card) => {
		f.sends.push({ target, message, html, card });
		if (f.sendMode === "error") throw new Error("Graph 403 Forbidden");
		if (f.sendMode === "cardfail" && card) throw new Error("Graph 400: card rejected");
		if (target.kind === "channel" && target.replyTo === undefined) {
			roots += 1;
			return { text: "posted", id: `root-${roots}` };
		}
		return "sent";
	};
}

function makeFixture(dir) {
	const f = {
		dir,
		now: T0,
		/** Each watched session: its probe behaviour, and its rules.yaml row fields (e.g. `thread`, `goal`). */
		agents: {},
		sends: [],
		sendMode: "ok",
		logs: [],
		personal: true,
		/** Sets one watched session and rewrites rules.yaml with every session so far, each keeping its own fields. */
		watch(name, behaviour, fields = {}) {
			f.agents[name] = { behaviour, fields };
			const rows = Object.entries(f.agents).map(([n, a]) => ({ name: n, mux: "tern", pane: "1", host: "local", result: "", ...a.fields }));
			const rules = { agents: { "*": [{ action: "notify", tag: "agent" }] }, agent_watch: rows };
			if (f.personal) rules.teams_watch = { chats: [], channels: [{ channel: "personal-fixture", team_id: TEAM, channel_id: CHANNEL, mode: "personal", policy: "" }] };
			fs.writeFileSync(path.join(dir, "rules.yaml"), YAML.stringify(rules));
		},
		run(sender = teamsSender(fakeTransport(f))) {
			return probeAgents({
				stallMin: 30,
				digestMin: 30,
				now: () => f.now * 1000,
				log: (line) => f.logs.push(line),
				probe: async (a, want) => f.agents[a.name].behaviour(f.now, want),
				sender,
			});
		},
		cursor() {
			return JSON.parse(fs.readFileSync(cursorPath(KEY), "utf8"));
		},
		seedCursor(threads) {
			fs.mkdirSync(path.dirname(cursorPath(KEY)), { recursive: true });
			fs.writeFileSync(cursorPath(KEY), JSON.stringify({ version: 1, key: KEY, watermark: "1", done: [], threads }));
		},
		state() {
			return JSON.parse(fs.readFileSync(path.join(dir, "cursors", "agents.json"), "utf8"));
		},
		channelSends() {
			return f.sends.filter((s) => s.target.kind === "channel");
		},
		selfSends() {
			return f.sends.filter((s) => s.target.kind === "self");
		},
	};
	return f;
}

/** A fresh temp inbox, WAYNE_INBOX_DIR and HOME pointed at it, both restored afterwards. */
async function withFixture(body) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-probe-channel-"));
	process.env.WAYNE_INBOX_DIR = dir;
	process.env.HOME = path.join(dir, "home");
	try {
		await body(makeFixture(dir));
	} finally {
		process.env.WAYNE_INBOX_DIR = BOOT_ROOT;
		process.env.HOME = path.join(BOOT_ROOT, "home");
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** The thread a channel send went to: its replyTo, or "(root)" for a new root post. */
const threadOf = (s) => s.target.replyTo ?? "(root)";

try {
	await check("1. an explicit agent thread gets its progress there, and the self-chat gets nothing", () =>
		withFixture(async (f) => {
			f.watch("alpha", ompLive, { thread: "thread-explicit" });
			f.seedCursor({});
			await f.run();
			deepStrictEqual(f.channelSends().map(threadOf), ["thread-explicit"]);
			strictEqual(f.selfSends().length, 0, "no self-chat digest when a personal channel is configured");
		}),
	);

	await check("2. a cursor-bound agent:<name> thread gets its progress there", () =>
		withFixture(async (f) => {
			f.watch("beta", ompLive);
			f.seedCursor({ "thread-bound": { owner: "agent:beta", subject: "🤖 beta" } });
			await f.run();
			deepStrictEqual(f.channelSends().map(threadOf), ["thread-bound"]);
			strictEqual(f.selfSends().length, 0);
		}),
	);

	await check("3. an unbound agent creates one root with its goal, binds it, and the next change replies in that same thread", () =>
		withFixture(async (f) => {
			f.watch("gamma", ompLive, { goal: "ship option A" });
			f.seedCursor({});
			await f.run();
			deepStrictEqual(f.channelSends().map(threadOf), ["(root)"], "exactly one new root");
			ok(JSON.stringify(f.channelSends()[0].card).includes("ship option A"), "new root carries the session's concise goal");
			const bound = Object.entries(f.cursor().threads).find(([, b]) => b.owner === "agent:gamma");
			ok(bound, "the new root is bound to agent:gamma in the cursor");
			strictEqual(bound[1].subject, "🤖 gamma", "the root's subject names the session");
			const [rootId] = bound;
			f.now = T0 + 30 * 60;
			f.watch("gamma", (now, want) => ({ ...ompLive(now, want), state: "blocked", waiting: true }), { goal: "ship option A" });
			await f.run();
			deepStrictEqual(f.channelSends().slice(1).map(threadOf), [rootId], "the next change replies in the bound thread");
			strictEqual(f.channelSends().filter((s) => s.target.replyTo === undefined).length, 1, "still exactly one root");
		}),
	);

	await check("4. two agents sharing one explicit thread go in one reply card naming both", () =>
		withFixture(async (f) => {
			f.watch("delta", ompLive, { thread: "thread-shared" });
			f.watch("eps", ompLive, { thread: "thread-shared" });
			f.seedCursor({});
			await f.run();
			deepStrictEqual(f.channelSends().map(threadOf), ["thread-shared"], "one send, to the shared thread, no new root");
			const text = JSON.stringify(f.channelSends()[0].card);
			ok(text.includes("delta") && text.includes("eps"), "the one card names both sessions");
		}),
	);

	await check("5. a failed thread send leaves that agent owed; the other thread's agent is recorded", () =>
		withFixture(async (f) => {
			f.watch("zeta", ompLive, { thread: "thread-ok" });
			f.watch("eta", ompLive, { thread: "thread-fail" });
			f.seedCursor({});
			const base = fakeTransport(f);
			const flaky = async (target, ...rest) => {
				if (target.replyTo === "thread-fail") throw new Error("Graph 503 unavailable");
				return base(target, ...rest);
			};
			let err;
			try {
				await f.run(teamsSender(flaky));
			} catch (e) {
				err = e;
			}
			ok(err, "the run fails when a thread send fails");
			ok(/Graph 503/.test(String(err?.message)), `the failure names the send: ${err?.message}`);
			const st = f.state();
			ok(st.watches.zeta.digested !== undefined, "the succeeded agent is recorded as digested");
			strictEqual(st.watches.eta.digested, undefined, "the failed agent stays owed for the next due run");
		}),
	);

	await check("6. no personal channel in rules.yaml: the self-chat digest is unchanged", () =>
		withFixture(async (f) => {
			f.personal = false;
			f.watch("theta", ompLive);
			await f.run();
			strictEqual(f.channelSends().length, 0, "no channel send");
			strictEqual(f.selfSends().length, 1, "one self-chat digest, as before");
		}),
	);

	await check("7. inbox agent add --thread persists the thread in rules.yaml", () =>
		withFixture(async (f) => {
			const probe = async () => ({ alive: true, agent: "omp", agent_pid: 1, session: "/s.jsonl", smtime: T0, state: "", waiting: false, text: "", rmtime: 0, rstatus: "", now: T0 });
			await addAgent({ name: "iota", mux: "tern", pane: "9", thread: "thread-cli" }, probe);
			strictEqual(readAgents().find((a) => a.name === "iota")?.thread, "thread-cli");
			const raw = YAML.parse(fs.readFileSync(path.join(f.dir, "rules.yaml"), "utf8"));
			strictEqual(raw.agent_watch.find((a) => a.name === "iota").thread, "thread-cli");
		}),
	);

	await check("8. missing personal-channel cursor fails loudly before posting anything (zero orphan roots)", () =>
		withFixture(async (f) => {
			f.watch("kappa", ompLive);
			let err;
			try {
				await f.run();
			} catch (e) {
				err = e;
			}
			ok(err && /has no cursor yet/.test(String(err.message)), `explains missing cursor: ${err?.message}`);
			strictEqual(f.sends.length, 0, "zero Teams sends when the cursor is missing");
			strictEqual(f.state().watches.kappa.digested, undefined, "nothing marked digested");
		}),
	);

	await check("9. card rejection in a channel falls back to plain text preserving the agent footer and binds new roots", () =>
		withFixture(async (f) => {
			f.sendMode = "cardfail";
			f.watch("lambda", ompLive, { goal: "recover cleanly" });
			f.watch("mu", ompLive, { thread: "thread-reply" });
			f.seedCursor({});
			await f.run();
			strictEqual(f.logs.filter((l) => l.startsWith("progress card not sent, sending the text digest:")).length, 2);
			const textSends = f.channelSends().filter((s) => !s.card);
			strictEqual(textSends.length, 2, "both reply and new root fell back to text");
			for (const s of textSends) ok(isAgentSend(s.message.replaceAll("<br>", "\n")), "plain-text fallback keeps agent footer");
			const bound = Object.entries(f.cursor().threads).find(([, b]) => b.owner === "agent:lambda");
			ok(bound, "fallback root still binds its thread id in the cursor");
		}),
	);

	await check("10. a personal channel that fails its privacy check sends 0 posts and marks nothing digested", () =>
		withFixture(async (f) => {
			f.watch("nu", ompLive);
			f.seedCursor({});
			const refusing = { ...teamsSender(fakeTransport(f)), verifyPersonal: async () => ({ ok: false, reason: "membership is shared, not private" }) };
			let err;
			try {
				await f.run(refusing);
			} catch (e) {
				err = e;
			}
			ok(err && /failed its privacy check/.test(String(err.message)), `names the refusal: ${err?.message}`);
			strictEqual(f.sends.length, 0, "zero sends when the privacy check fails");
			strictEqual(f.selfSends().length, 0, "no silent self-chat fallback either");
			strictEqual(f.state().watches.nu.digested, undefined, "nothing marked digested");
		}),
	);

	await check("11. a malformed teams_watch block fails the run cleanly and still prunes removed agents", () =>
		withFixture(async (f) => {
			f.watch("xi", ompLive);
			fs.mkdirSync(path.join(f.dir, "cursors"), { recursive: true });
			fs.writeFileSync(path.join(f.dir, "cursors", "agents.json"), JSON.stringify({ watches: { gone: { phase: "working", at: 1, by: "probe" }, xi: { phase: "working", at: 1, by: "probe" } } }));
			const rules = YAML.parse(fs.readFileSync(path.join(f.dir, "rules.yaml"), "utf8"));
			rules.teams_watch.channels[0].channel_id = "";
			fs.writeFileSync(path.join(f.dir, "rules.yaml"), YAML.stringify(rules));
			let err;
			try {
				await f.run();
			} catch (e) {
				err = e;
			}
			ok(err && /needs team_id and channel_id/.test(String(err.message)), `names the malformed block: ${err?.message}`);
			strictEqual(f.sends.length, 0, "zero sends on a malformed routing block");
			const st = f.state();
			ok(!("gone" in st.watches), "the record of a name no longer watched is still pruned");
			strictEqual(st.watches.xi.digested, undefined, "the live session stays owed");
		}),
	);

	await check("12. numeric and string thread ids group into one card; a whitespace --thread is ignored", () =>
		withFixture(async (f) => {
			f.watch("omicron", ompLive, { thread: 1764212345678 });
			f.watch("piAgent", ompLive, { thread: "1764212345678" });
			f.watch("rho", ompLive, { thread: "   " });
			f.seedCursor({});
			await f.run();
			const replies = f.channelSends().filter((s) => s.target.replyTo === "1764212345678");
			strictEqual(replies.length, 1, "the numeric and the string id share one card");
			ok(JSON.stringify(replies[0].card).includes("omicron") && JSON.stringify(replies[0].card).includes("piAgent"), "the card names both sessions");
			const rhoSends = f.channelSends().filter((s) => s.target.subject === "🤖 rho");
			strictEqual(rhoSends.length, 1, "a whitespace-only thread is ignored, so rho gets its own new root");
		}),
	);

	await check("13. malformed cursor JSON fails loudly via InboxError with 0 sends and still prunes removed agents", () =>
		withFixture(async (f) => {
			f.watch("sigma", ompLive);
			fs.mkdirSync(path.join(f.dir, "cursors"), { recursive: true });
			fs.writeFileSync(path.join(f.dir, "cursors", "agents.json"), JSON.stringify({ watches: { gone: { phase: "working", at: 1, by: "probe" }, sigma: { phase: "working", at: 1, by: "probe" } } }));
			fs.writeFileSync(cursorPath(KEY), "{not json");
			let err;
			try {
				await f.run();
			} catch (e) {
				err = e;
			}
			ok(err instanceof InboxError && /cursor file does not parse/.test(String(err.message)), `throws InboxError on corrupt cursor: ${err?.message}`);
			strictEqual(f.sends.length, 0, "zero sends when cursor JSON is malformed");
			const st = f.state();
			ok(!("gone" in st.watches), "removed agent is still pruned");
			strictEqual(st.watches.sigma.digested, undefined, "live agent stays owed");
		}),
	);

	await check("14. inbox agent add with whitespace-only --thread omits thread in rules.yaml", () =>
		withFixture(async (f) => {
			const probe = async () => ({ alive: true, agent: "omp", agent_pid: 1, session: "/s.jsonl", smtime: T0, state: "", waiting: false, text: "", rmtime: 0, rstatus: "", now: T0 });
			await addAgent({ name: "tau", mux: "tern", pane: "9", thread: "   " }, probe);
			strictEqual(readAgents().find((a) => a.name === "tau")?.thread, undefined);
		}),
	);
} finally {
	for (const k of Object.keys(SAVED_ENV)) {
		if (SAVED_ENV[k] === undefined) delete process.env[k];
		else process.env[k] = SAVED_ENV[k];
	}
	fs.rmSync(BOOT_ROOT, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nall green" : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
