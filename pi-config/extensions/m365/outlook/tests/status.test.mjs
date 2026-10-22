/**
 * The Outlook status bar tells the truth about the current state (U20).
 *
 *   Outlook: …                          before the first poll
 *   Outlook: N unread | Outlook: 0      after a poll that worked
 *   Outlook: sign in with /teams init   the poll was refused for want of a sign-in
 *   Outlook: <first line of the error>  any other failed poll
 *
 * The poll runs on session_start (only with a UI) and every 60 s after that,
 * single-flight. The clock here is hand-made: setInterval and clearInterval are
 * replaced, so the test decides when time passes and can see the interval being
 * unref'd and cleared. setImmediate stays real so promise chains can be flushed.
 *
 * Offline: unreadCount is a stand-in on Mailbox; no token, no network.
 *
 *   node tests/status.test.mjs
 */
import { createJiti, PI } from "../../tests/host.mjs";
// Resolved paths: importing through the symlink would give a second copy of every module. See ext-path.mjs.
import { ext } from "./ext-path.mjs";

const D = PI;
const jiti = createJiti(import.meta.url, {
	alias: {
		"@earendil-works/pi-coding-agent": `${D}/dist/index.js`,
		"@earendil-works/pi-ai": `${D}/node_modules/@earendil-works/pi-ai/dist/compat.js`,
		typebox: `${D}/node_modules/typebox/build/index.mjs`,
		"@earendil-works/pi-tui": `${D}/node_modules/@earendil-works/pi-tui/dist/index.js`,
	},
	interopDefault: true,
});
const extension = await jiti.import(ext("index.ts"), { default: true });
const { Mailbox } = await jiti.import(ext("mailbox.ts"));

// --- Checks ------------------------------------------------------------------

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
	if (ok) {
		passed++;
		console.log(`PASS ${label}`);
	} else {
		failed++;
		console.log(`FAIL ${label}${detail ? ` (${detail})` : ""}`);
	}
};
/** Deep equality, key order ignored. */
const equal = (label, actual, expected) => {
	const same = JSON.stringify(actual) === JSON.stringify(expected);
	check(label, same, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
};
/** An exception inside a section fails that section; the other sections still run. */
async function section(title, run) {
	console.log(`\n== ${title} ==`);
	try {
		await run();
	} catch (e) {
		check(`${title}: ran to the end`, false, e instanceof Error ? e.message : String(e));
	}
}

// --- Stand-ins ---------------------------------------------------------------

/** What Mailbox.unreadCount answers next. Each call is counted in `asked`. */
let answer = async () => 0;
let asked = 0;
Mailbox.prototype.unreadCount = function unreadCount() {
	asked++;
	return answer();
};

// Installed after the imports above, so only the extension's timers are fake.
let now = 0;
let intervals = [];
globalThis.setInterval = (fn, ms) => {
	const t = {
		fn,
		ms,
		next: now + ms,
		cleared: false,
		unrefd: false,
		unref() {
			this.unrefd = true;
			return this;
		},
	};
	intervals.push(t);
	return t;
};
globalThis.clearInterval = (t) => {
	if (t) t.cleared = true;
};
const live = () => intervals.filter((t) => !t.cleared);
const flush = () => new Promise((resolve) => setImmediate(resolve));
/** Moves the clock forward by ms, firing each live interval that comes due, in order. */
async function advance(ms) {
	const end = now + ms;
	for (;;) {
		const due = live()
			.filter((t) => t.next <= end)
			.sort((a, b) => a.next - b.next)[0];
		if (!due) break;
		now = due.next;
		due.next += due.ms;
		due.fn();
		await flush();
	}
	now = end;
	await flush();
}

/** A fresh extension with its own state and handlers, and a clock with no leftovers. */
async function load() {
	intervals = [];
	now = 0;
	asked = 0;
	const handlers = {};
	await extension({
		registerTool: () => {},
		registerCommand: () => {},
		on: (name, fn) => {
			handlers[name] = fn;
		},
		exec: async () => {
			throw new Error("outlook never runs pi.exec");
		},
		sendUserMessage: () => {},
	});
	return handlers;
}

/** A session whose setStatus calls under the shared "comms" row key are recorded. `fg` is the theme's coloring; the default leaves text plain. */
function session(hasUI = true, fg = (_color, s) => s) {
	const statuses = [];
	const ctx = {
		hasUI,
		cwd: "/tmp",
		model: { name: "test-model" },
		ui: {
			theme: { fg },
			setStatus: (key, text) => {
				if (key === "comms") statuses.push(text);
			},
			notify: () => {},
		},
	};
	return { ctx, statuses, last: () => statuses.at(-1) };
}

const HINT = "not authenticated — run /teams init";

// --- U20 ---------------------------------------------------------------------

await section("U20 before the first poll the bar reads Outlook: …", async () => {
	answer = () => new Promise(() => {}); // a poll that never answers
	const handlers = await load();
	const s = session();
	await handlers.session_start({}, s.ctx);
	equal("the placeholder is all there is", s.statuses, ["Outlook: …"]);
	equal("the poll was asked once", asked, 1);
});

await section("U20 session_start shows the count the poll returns", async () => {
	answer = async () => 3;
	const handlers = await load();
	const s = session();
	await handlers.session_start({}, s.ctx);
	await flush();
	equal("3 unread after session_start", s.last(), "Outlook: 3 unread");
});

await section("U20 advancing the clock 60 s polls again and the count follows", async () => {
	answer = async () => 3;
	const handlers = await load();
	const s = session();
	await handlers.session_start({}, s.ctx);
	await flush();
	answer = async () => 4;
	await advance(60_000);
	equal("one more poll at 60 s", asked, 2);
	equal("4 unread after the tick", s.last(), "Outlook: 4 unread");
});

await section("U20 a count of zero reads Outlook: 0", async () => {
	answer = async () => 0;
	const handlers = await load();
	const s = session();
	await handlers.session_start({}, s.ctx);
	await flush();
	equal("zero", s.last(), "Outlook: 0");
});

await section("U20 a refused sign-in shows the way back; the next good tick clears it", async () => {
	answer = async () => {
		throw new Error(HINT);
	};
	const handlers = await load();
	const s = session();
	await handlers.session_start({}, s.ctx);
	await flush();
	equal("the sign-in hint", s.last(), "Outlook: sign in with /teams init");
	answer = async () => 2;
	await advance(60_000);
	equal("the next success clears it", s.last(), "Outlook: 2 unread");
});

await section("U20 another failure replaces the count with its first line", async () => {
	answer = async () => 3;
	const handlers = await load();
	const s = session();
	await handlers.session_start({}, s.ctx);
	await flush();
	equal("the count first", s.last(), "Outlook: 3 unread");
	answer = async () => {
		throw new Error("Graph 503 on /me/mailFolders/inbox\nsecond line that must not show");
	};
	await advance(60_000);
	check("the status names the failure", s.last().startsWith("Outlook: Graph 503 on /me/mailFolders/inbox"), s.last());
	check("the second line stays out", !s.last().includes("second line"), s.last());
});

await section("U20 a tick while a poll is still pending issues no second call", async () => {
	let answerFirst;
	answer = () =>
		new Promise((resolve) => {
			answerFirst = resolve;
		});
	const handlers = await load();
	const s = session();
	await handlers.session_start({}, s.ctx);
	await advance(60_000);
	equal("the tick did not call again", asked, 1);
	answerFirst(3);
	await flush();
	equal("the first answer shows", s.last(), "Outlook: 3 unread");
	answer = async () => 5;
	await advance(60_000);
	equal("the next tick polls again", asked, 2);
	equal("and shows its answer", s.last(), "Outlook: 5 unread");
});

await section("U20 after session_shutdown the clock issues no call", async () => {
	answer = async () => 3;
	const handlers = await load();
	const s = session();
	await handlers.session_start({}, s.ctx);
	await flush();
	await handlers.session_shutdown({}, s.ctx);
	const before = asked;
	await advance(3 * 60_000);
	equal("no poll after shutdown", asked, before);
	equal("the interval was cleared", live().length, 0);
});

await section("U20 the poll timer is 60 s and unref'd", async () => {
	answer = async () => 0;
	const handlers = await load();
	await handlers.session_start({}, session().ctx);
	equal("one live interval", live().length, 1);
	equal("60 s", live()[0]?.ms, 60_000);
	equal("unref'd, so it never holds the process", live()[0]?.unrefd, true);
});

await section("U20 without a UI nothing is polled, shown or timed", async () => {
	answer = async () => 3;
	const handlers = await load();
	const s = session(false);
	await handlers.session_start({}, s.ctx);
	await advance(60_000);
	equal("no poll", asked, 0);
	equal("no status", s.statuses, []);
	equal("no timer", live().length, 0);
});

await section("U20 colours: dim for the placeholder and for zero, warning for a count, error for a refused sign-in", async () => {
	let finish;
	answer = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	const handlers = await load();
	const s = session(true, (color, text) => `<${color}>${text}</${color}>`);
	await handlers.session_start({}, s.ctx);
	equal("the placeholder is dim", s.last(), "<dim>Outlook: …</dim>");
	finish(3);
	await flush();
	equal("a count is warning", s.last(), "<warning>Outlook: 3 unread</warning>");
	answer = async () => 0;
	await advance(60_000);
	equal("zero is dim", s.last(), "<dim>Outlook: 0</dim>");
	answer = async () => {
		throw new Error(HINT);
	};
	await advance(60_000);
	equal("a refused sign-in is error", s.last(), "<error>Outlook: sign in with /teams init</error>");
});

await section("Outlook and Teams share one status row, even from separate module copies", async () => {
	answer = async () => 6;
	const handlers = await load();
	const s = session();
	await handlers.session_start({}, s.ctx);
	equal("Outlook alone fills the row", s.last(), "Outlook: 6 unread");
	// The Teams extension is its own module graph: a second jiti instance gives a second copy of status-row.ts.
	const teamsCopy = await createJiti(import.meta.url, { moduleCache: false }).import(ext("../core/status-row.ts"));
	teamsCopy.setStatusPart(s.ctx.ui, "teams", "Teams: 0");
	equal("both parts on one row, Outlook first", s.last(), "Outlook: 6 unread  Teams: 0");
	answer = async () => 5;
	await advance(60_000);
	equal("an Outlook refresh keeps the Teams part", s.last(), "Outlook: 5 unread  Teams: 0");
	teamsCopy.setStatusPart(s.ctx.ui, "teams", undefined);
	equal("removing a part leaves the other", s.last(), "Outlook: 5 unread");
});

console.log(`\n${passed} passed, ${failed} failed`);
console.log(failed === 0 ? "all ok" : "FAIL");
process.exit(failed === 0 ? 0 : 1);
