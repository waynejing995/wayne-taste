/**
 * The resume list's channel section (teams/watch-list.ts, the `channels` list of teams_watch in rules.yaml):
 * a channel entry round-trips without touching the rest of the hand-written file, an omitted mode reads as shared,
 * and two sessions saving different channels at once both land.
 *
 *   bun test tests/channel/watch-list.test.ts
 */
import { expect, test, beforeEach } from "bun:test";
import { readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import * as m from "../../teams/watch-list.ts";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LIST_TS = join(PKG, "teams", "watch-list.ts"); // absolute path for the child-process writer below

// The preload (tests/channel/preload.ts, wired through bunfig.toml) has already pointed WAYNE_INBOX_DIR at a
// throwaway directory before any test module loads, so watch-list.ts's module-level WATCH_LIST is isolated
// however this file is ordered among the other channel tests in one process. Nothing here may set the env
// again: another file may have loaded the module first.
const DIR = process.env.WAYNE_INBOX_DIR;
if (!DIR) throw new Error("WAYNE_INBOX_DIR is not set: bunfig.toml must load tests/channel/preload.ts first");
const RULES = join(DIR, "rules.yaml");

const HAND_WRITTEN = [
	"# mine",
	"github: # repos",
	"  o/r:",
	'    - when: { number: ["1"], event: merged }',
	"      action: log",
	"",
	"teams_watch:",
	"  chats: []",
	"",
	"# after the program's section",
	"schedule:",
	"  - at: 09:00",
	"",
].join("\n");

beforeEach(() => {
	if (existsSync(RULES)) rmSync(RULES);
});

test("a channel entry saved and forgotten leaves every byte outside teams_watch as the user wrote it", () => {
	writeFileSync(RULES, HAND_WRITTEN);
	const warn = m.rememberChannelWatch({
		channel: "Synthetic channel",
		team_id: "team-1",
		channel_id: "19:fake-channel@thread.skype",
		mode: "personal",
		policy: "",
	});
	expect(warn).toBe("");
	expect(YAML.parse(readFileSync(RULES, "utf8")).teams_watch.channels).toEqual([
		{ channel: "Synthetic channel", team_id: "team-1", channel_id: "19:fake-channel@thread.skype", mode: "personal", policy: "" },
	]);

	expect(m.forgetChannelWatch("team-1", "19:fake-channel@thread.skype")).toBe("");
	const text = readFileSync(RULES, "utf8");
	const before = HAND_WRITTEN.slice(0, HAND_WRITTEN.indexOf("teams_watch:"));
	const after = HAND_WRITTEN.slice(HAND_WRITTEN.indexOf("\n# after"));
	expect(text.startsWith(before)).toBe(true);
	expect(text.endsWith(after)).toBe(true);
	expect(YAML.parse(text).teams_watch.channels).toEqual([]);
	expect(YAML.parse(text).schedule).toEqual([{ at: "09:00" }]);
});

test("a channel entry without a mode reads as shared", () => {
	writeFileSync(RULES, HAND_WRITTEN);
	expect(m.rememberChannelWatch({ channel: "Synthetic channel", team_id: "team-1", channel_id: "19:fake-channel@thread.skype", policy: "" })).toBe("");
	expect(m.savedWatches().channels).toEqual([
		{ channel: "Synthetic channel", team_id: "team-1", channel_id: "19:fake-channel@thread.skype", mode: "shared", policy: "" },
	]);
});

test("a hand-written channel entry without a mode reads as shared, and saving another channel keeps it", () => {
	writeFileSync(
		RULES,
		'teams_watch:\n  chats: []\n  channels:\n    - channel: Hand written\n      team_id: team-1\n      channel_id: "19:fake-channel@thread.skype"\n      policy: ""\n',
	);
	expect(m.savedWatches().channels[0].mode).toBe("shared");
	expect(m.rememberChannelWatch({ channel: "Second", team_id: "team-1", channel_id: "19:fake-2@thread.skype", mode: "personal", policy: "" })).toBe("");
	expect(m.savedWatches().channels.map((c: { channel: string }) => c.channel)).toEqual(["Hand written", "Second"]);
});

test("remembering the same team and channel again replaces the entry, and chats are kept", () => {
	writeFileSync(RULES, "teams_watch:\n  chats:\n    - chat: a\n      chat_id: '1'\n      policy: ''\n");
	m.rememberChannelWatch({ channel: "Old name", team_id: "team-1", channel_id: "19:fake-channel@thread.skype", mode: "shared", policy: "" });
	m.rememberChannelWatch({ channel: "New name", team_id: "team-1", channel_id: "19:fake-channel@thread.skype", mode: "personal", policy: "omp: then reply" });
	expect(m.savedWatches()).toEqual({
		chats: [{ chat: "a", chat_id: "1", policy: "" }],
		channels: [{ channel: "New name", team_id: "team-1", channel_id: "19:fake-channel@thread.skype", mode: "personal", policy: "omp: then reply" }],
	});
});

test("a channels value that is not a list is a warning and the file is left as it was", () => {
	const bad = "teams_watch:\n  chats: []\n  channels: 5\n";
	writeFileSync(RULES, bad);
	const warn = m.rememberChannelWatch({ channel: "Synthetic channel", team_id: "team-1", channel_id: "19:fake-channel@thread.skype", mode: "shared", policy: "" });
	expect(warn.startsWith(" Warning: not saved")).toBe(true);
	expect(readFileSync(RULES, "utf8")).toBe(bad);
});

test("two processes saving different channels at once both land", async () => {
	writeFileSync(RULES, HAND_WRITTEN);
	const writer = join(DIR, "writer.ts");
	writeFileSync(
		writer,
		`import { rememberChannelWatch } from ${JSON.stringify(LIST_TS)};
const warnings = [];
for (const id of process.argv.slice(2)) {
	warnings.push(rememberChannelWatch({ channel: id, team_id: "team-1", channel_id: id, mode: "shared", policy: "" }));
}
if (warnings.join("")) { console.error(warnings.join("")); process.exit(1); }
`,
	);
	const ids = (p: string) => Array.from({ length: 30 }, (_, i) => `19:${p}${i}@thread.skype`);
	const run = (list: string[]) =>
		Bun.spawn([process.execPath, writer, ...list], { env: process.env, stdout: "ignore", stderr: "pipe" });
	const procs = [run(ids("a")), run(ids("b"))];
	const codes = await Promise.all(procs.map((p) => p.exited));
	const errs = await Promise.all(procs.map((p) => new Response(p.stderr).text()));
	expect(errs.join("")).toBe("");
	expect(codes).toEqual([0, 0]);
	const saved = YAML.parse(readFileSync(RULES, "utf8")).teams_watch.channels.map((c: { channel_id: string }) => c.channel_id).sort();
	expect(saved).toEqual([...ids("a"), ...ids("b")].sort());
	expect(YAML.parse(readFileSync(RULES, "utf8")).schedule).toEqual([{ at: "09:00" }]);
});

test("board config on a personal channel survives rememberChannelWatch, rememberWatch, and rememberInterval", () => {
	const withBoard = [
		"teams_watch:",
		"  chats: []",
		"  channels:",
		"    - channel: Agent Desk",
		"      team_id: team-1",
		'      channel_id: "19:fake-channel@thread.skype"',
		"      mode: personal",
		'      policy: ""',
		"      board:",
		"        site_url: https://contoso.sharepoint.test/sites/AgentSite",
		"        list_id: 00000000-0000-4000-8000-000000000099",
		"        columns:",
		'          waiting: "🟡 Waiting"',
		'          working: "🔄 Working"',
		'          done: "✅ Done"',
		"",
	].join("\n");
	writeFileSync(RULES, withBoard);

	expect(m.rememberChannelWatch({ channel: "Agent Desk", team_id: "team-1", channel_id: "19:fake-channel@thread.skype", mode: "personal", policy: "new policy" })).toBe("");
	expect(m.rememberInterval(30)).toBe("");
	expect(m.rememberWatch({ chat: "self", chat_id: "48:notes", policy: "" })).toBe("");

	const saved = m.savedWatches();
	expect(saved.interval_sec).toBe(30);
	expect(saved.channels).toEqual([
		{
			channel: "Agent Desk",
			team_id: "team-1",
			channel_id: "19:fake-channel@thread.skype",
			mode: "personal",
			policy: "new policy",
			board: {
				site_url: "https://contoso.sharepoint.test/sites/AgentSite",
				list_id: "00000000-0000-4000-8000-000000000099",
				columns: { waiting: "🟡 Waiting", working: "🔄 Working", done: "✅ Done" },
			},
		},
	]);
});

test("omitted teams_watch.chats defaults to [] while non-array chats still fails", () => {
	writeFileSync(
		RULES,
		[
			"teams_watch:",
			"  channels:",
			"    - channel: Agent Desk",
			"      team_id: team-1",
			'      channel_id: "19:fake-channel@thread.skype"',
			"      mode: personal",
			'      policy: ""',
			"",
		].join("\n"),
	);
	expect(m.savedWatches().chats).toEqual([]);
	expect(m.rememberInterval(15)).toBe("");
	expect(m.savedWatches().interval_sec).toBe(15);

	writeFileSync(RULES, "teams_watch:\n  chats: 5\n");
	const warn = m.rememberInterval(20);
	expect(warn.startsWith(" Warning: not saved")).toBe(true);
});
