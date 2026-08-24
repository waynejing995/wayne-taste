# Microsoft Teams for pi

Talks to Microsoft Graph directly, from this process. The self-chat (`48:notes`)
goes through chatsvc instead, because Graph has no API for it.

It grew out of a Python CLI (`fetch_teams.py`) that did the same job over a
subprocess. That path is still selectable as a rollback if you have the script,
but nothing here needs it.

## Read this before installing

This extension signs in as **Microsoft Office's first-party client id**
(`d3590ed6-…`) using the device-code flow, and reaches the self-chat through
`chatsvc`, an undocumented Teams endpoint. That is how the Python tool it
replaces has always worked, and the consequences are yours to weigh:

- **It is your account.** Messages go out under your name; the agent footer says
  a machine wrote them, nothing else distinguishes them.
- **Your organisation may not allow this.** Some tenants block unfamiliar
  device-code sign-ins, and some policies forbid using a first-party client id
  for a self-built tool. If yours does, `/teams login` will fail with a clear
  error — that is the policy answering, and the right response is to ask, not to
  work around it.
- **Undocumented endpoints break.** `chatsvc` can change without notice. Only
  the self-chat depends on it; everything else is Microsoft Graph.

No tenant id is in this source: sign-in uses the `organizations` authority, so
the tenant comes from whoever logs in.

## Backends

| `backend` | What answers | When |
|---|---|---|
| `graph` (default) | Microsoft Graph + chatsvc, in-process | Normal operation |
| `script` | `fetch_teams.py` over a subprocess | Rollback: one line in `teams.json`, no code change |

Set it in `~/.pi/agent/teams.json`. A misspelled value throws at load rather
than falling back — the point of the switch is knowing which one answered.

## Login

No tenant id, no name, no path to anyone's checkout lives in this source. The
sign-in uses the `organizations` authority, so the tenant comes from the account
that signs in; the display name comes from `GET /me` and is cached beside the
token. Everything personal is in `$XDG_CACHE_HOME/pi/teams-auth/` or in
`teams.json`, never in a constant.

The `graph` backend keeps **its own** MSAL token cache at
`$XDG_CACHE_HOME/pi/teams-auth/msal-cache.json` (mode 0600), plus
`identity.json` next to it holding the signed-in display name, UPN, oid and tid.
It never reads or writes the Python side's `outlook_token_cache.bin`. Two MSAL implementations
sharing one cache is two writers of one piece of state; they rotate refresh
tokens independently and the loser re-authenticates every morning.

| Command | What it does |
|---|---|
| `/teams login` (alias `init`) | Device-code sign-in, then **proves it**: `GET /me` must return 200, and the verified name, UPN and audience are reported |
| `/teams verify` | Same proof against the cached token, without signing in again |
| `/teams status` | Which backend, whether a token cache exists, unread count, remote state |

Device code, not a stored password: the Python path keeps a decryptable copy of
a domain password because it predates this, and copying that to save one browser
click per refresh-token lifetime is a bad trade. Nothing here ever reads it.

## Surfaces

| Surface | What it does |
|---|---|
| Status bar | `Teams: 3 unread` — chats holding unread activity, polled every 10 min |
| `teams_send` tool | The agent sends a Teams message when you tell it to. self / chat / channel. **It says what you asked, worded naturally, at the size you asked for** — rephrasing is fine; padding it with summaries and background you never mentioned is not |
| `teams_read` tool | The agent reads the last 20 messages of a chat or the self-chat. A shared file becomes two lines: the name, and the url `teams_download` needs |
| `teams_download` tool | Fetches a file someone shared, to a local path. Size-capped (256 MB default) |
| `teams_unread` tool | The agent reads the unread list |
| `/teams` | Two-pane floating composer: chats left, history + draft right |
| `/teams remote on` | **Unverified, deferred.** Post `pi: <task>` to your self-chat and this session runs it, then replies there |

`/teams` with no argument opens the composer. Other subcommands:
`login`, `init`, `verify`, `status`, `unread`, `refresh`, `remote on`, `remote off`.

## The composer

```
╭─ teams ────────────────────────────────────────────────╮
│ CHATS                │ Family, Given                   │
│ ▸ Family, Given      │ 06:20 Family, Given             │
│   Other, Person      │   I looked at that patch        │
│   [Team] Standup     │ 06:28 me                        │
│                      │   no problem, fixed it          │
│                      │ ─────────────────────────────── │
│ filter: fam          │ > draft█                        │
│ enter send · ^j newline · ^f format · tab chats · esc  │
╰────────────────────────────────────────────────────────╯
```

| Pane | Keys |
|---|---|
| Chats | type to filter · `↑↓` move · `enter` open · `^r` refetch the list · `^p` find a person |
| | `●` marks a chat with unread activity; the header shows how many are in view |
| People (`^p`) | type a name · `enter` searches · `enter` again opens the matching chat · `^p` back |
| Composer | `enter` send · `←→` `home` `end` move · `backspace`/`delete` edit · `^j` newline · `^r` refetch this conversation · `^f` cycle md→html / raw html / plain text |
| History | `↑↓` scroll a line · `PgUp`/`PgDn` scroll a page. It sticks to the newest message; while scrolled up the separator says how far back you are, and opening a chat or sending a message returns to the bottom. |
| Both | `tab` switch pane · `esc` close |

`^r` refreshes whatever pane has focus — the chat list on the left, the open
conversation's messages on the right. The hint line names the current one, so
the binding is never ambiguous about what it will refetch.

The composer is a real edit buffer with a caret, not an append-only field:
text can be inserted and deleted anywhere. Wrapping, the caret position, and
CJK width are computed in one pass (`layoutDraft`), because a caret is an index
into the text and mapping it onto a wrapped line is only correct if the same
pass produces both.

Opening a chat loads its last 20 messages; sending refreshes them, so a sent
message is visible in the pane rather than merely reported as sent.

Opening the composer also refreshes the unread scan (through the same 10-minute
disk cache), so the dots reflect now rather than whenever the last poll landed.

Opening a chat clears its dot by calling Graph's `markChatReadForUser`, the same
watermark the Teams client moves — so the desktop client agrees. The local list
is pruned only *after* that call succeeds; a failure leaves the dot up and says
why in the status line. The badge is never merely hidden.

The chat list is stale-while-revalidate: the composer opens instantly from
`~/.cache/pi/teams-chats.json`, and if that cache is older than 5 minutes one
background fetch refreshes the list in place. `^r` forces it. A refresh failure
is shown in the status line instead of being swallowed.

Every rendered row is padded to exactly the frame width. A row wider than the
frame corrupts the whole TUI, so the render is regression-tested at 60/80/100/120
columns, including CJK width.

## Config

Optional. `~/.pi/agent/teams.json` overrides these defaults:

```json
{
  "backend": "graph",
  "script": "/path/to/fetch_teams.py",
  "unreadPollSec": 600,
  "remotePollSec": 60,
  "remotePrefix": "pi:",
  "remoteReply": true,
  "execTimeoutMs": 150000
}
```

`script` has no default, and `script` / `execTimeoutMs` matter only when
`backend` is `script`. Your display name is not configured at all: it is read
from the signed-in account and cached.

A malformed config is a hard error at load, not a silent fallback to defaults.

## Tests

Not shipped. The suite (27 offline suites plus live parity against the Python
implementation) was written against a real mailbox and holds real names,
addresses and conversation text, so it stays on the machine it was developed on
rather than in a repository other people clone.

What it covered, in case you are changing this code and want to rebuild it:
argv parity for the script backend, the auth cache and its refusal to prompt
outside `/teams login`, Graph pagination and throttling, the unread rules, the
HTML→Markdown port measured against the Python converter, message projection,
send/people/mark-read, the chatsvc self-chat, attachments, paste, and the status
indicator.

## Paste

Pasting works, including multi-line. pi-tui enables bracketed paste, so a paste
arrives wrapped in `\x1b[200~ ... \x1b[201~` — the composer used to reject
anything starting with ESC and dropped every paste in silence.

A paste is text, all of it: an Enter inside one is a newline, never a send, so
pasting a 40-line log does not fire 40 messages. A large paste that arrives
split across several writes is reassembled, CRLF is normalised to LF, and a
paste into the left pane goes to the filter with its newlines flattened.

Use the terminal's own paste (Ctrl+Shift+V, ⌘V, middle-click) — Ctrl+V is not a
paste in a terminal, it is a literal keystroke.

## Shared files

A Teams file attachment is not stored in Teams. It is a `reference` to the
sender's OneDrive, and the `contentUrl` in the message is a web address, not an
API endpoint — Graph reaches it through `/shares/{u!base64url}/driveItem`.

Two bugs made these invisible, both fixed:

- **The message was dropped entirely.** `is_empty_event` treats "flat text is
  empty" as "system event", which is true of a join notice and false of a file:
  a file-only body is just `<attachment id="...">` and strips to `""`. The same
  trap was fixed for images long ago by rendering `<img>` as `[image]`; files
  never got it. **The Python path still drops them** — that divergence is
  deliberate and declared in `tests/parity.test.mjs`.
- **Even when kept, it was only a link inside the prose.** The pane now gives a
  file its own row, in its own colour, and does not repeat the Markdown link.

## Unread is chat-level, on purpose

One Graph call (`/me/chats?$expand=lastMessagePreview`) marks a chat unread when
its last message is newer than my own `lastMessageReadDateTime`. Sending marks a
chat read, so this also excludes my own messages without a second lookup.

The preview carries **no mention data**, so there is no honest per-message count
and no `@me` count. The status bar says `N unread` meaning N *chats*, never
N messages. Getting real counts means walking every chat's messages — ~30 Graph
calls, throttled within minutes of polling. Not worth it for an indicator.

The script caches each scan at `~/.cache/pi/teams-unread.json`, so N parallel pi
sessions cost one Graph call. On a throttle (HTTP 429, which does happen) it
serves the last good scan flagged `stale` and the status bar shows `⚠stale`.

## Remote channel

> **Status: written but not runtime-verified, and deliberately parked.** The
> code below is off by default. Do not rely on it until it has been driven
> end to end in a live session.

Off by default. `/teams remote on`:

1. Takes a cross-session lock at `~/.cache/pi/teams-remote.lock`. A second pi
   session refuses to arm rather than running your command twice.
2. Baselines the cursor to the newest self-chat message, so arming does not
   replay your note history.
3. Polls the self-chat every 60s. A message starting with `pi:` is stripped of
   the prefix and injected as if you typed it.
4. On settle, posts the answer back to the self-chat as HTML.

The cursor is the chatsvc message id (a monotonic ms timestamp) at
`~/.cache/pi/teams-remote-cursor.json`, so each command runs exactly once.

This is remote code execution over a chat channel. It is opt-in per session and
released on `/teams remote off` or session shutdown for that reason.

## Markdown

`marked` (gfm, `breaks: true`) does the rendering — single newlines become
`<br>` the way chat clients behave. Teams accepts the subset marked emits:
`<h1-6>`, `<p>`, `<b>/<strong>`, `<i>`, `<a>`, `<ul>/<ol>/<li>`, `<pre>`,
`<code>`, `<blockquote>`.

## Dependencies

`npm install` in this directory (already done). Only `marked`.

## Pictures

This terminal cannot draw them. tty7 26.8.3 implements the Kitty graphics
protocol and answers `a=q`, but it leaves an already-placed image behind when
the screen scrolls — and pi's regular mode redraws by emitting newlines at the
bottom of the screen, so every frame scrolls. Measured from `PI_TUI_WRITE_LOG`:
the image is placed, then pi writes 53 more newlines, and the picture is left
53 rows adrift. `fullscreen` mode misplaces it immediately instead.

So the model reads them out instead. When a conversation loads, every image in
it is described in the background and the description replaces the marker in
the history pane:

```
2026-08-20 15:56  Family, Given
  [image 1: a terminal showing "cargo build" failing with
   error[E0308]: mismatched types at src/main.rs:42]
```

No keystroke: it is there when the conversation is. Descriptions are cached by
image URL under `~/.cache/pi/teams-alt`, so a chat is described once. A failure
is written into the line rather than leaving a silent bare marker.

`teams_read` also attaches the pictures themselves (up to 4, newest first), so
the agent can answer questions about them directly.

### If the terminal ever grows working image support

`^o` still opens a viewer built on pi's own `Image` component, and the code is
in place — it just refuses while `getCapabilities().images` is null. Re-enable
`~/.pi/agent/extensions/tty7-images.ts.disabled` once tty7 keeps placements
glued to their cells while scrolling.

## Message formatting

pi renders Markdown, not HTML, so the script converts each message and the pane
hands it to pi's own `Markdown` component: bold, italics, inline code, fenced
blocks with syntax highlighting, quotes, lists and clickable links, in the same
palette as the rest of pi.

Two Teams-specific pieces are handled directly, because a generic conversion
loses exactly the ones that matter:

- `<at>` becomes a coloured `@mention`: the alert colour when it is **you**,
  the accent colour for anyone else, and the message header also turns orange
  with `@you`. Markdown's bold alone does not catch the eye in a busy pane, and
  pi's Markdown component passes ANSI through untouched, so the colour is
  injected before rendering rather than left to the `**` markers.
- `<attachment>` is almost never a file. It is usually a reply or a forward,
  with the quoted message buried in `content` as JSON, so it renders as
  `↩ replying to X: …` / `⤷ forwarded from X: …`. Two forwarded messages in a
  real history flattened to the empty string before this — discarded as system
  events, invisible. A real file attachment renders as a linked filename.

Messages render in full. A pasted log fills the pane and pushes older messages
out of view, which is what `↑↓`/`PgUp` are for — a message is what it is, and a
truncation marker is a promise the reader then has to go collect.

## Emoji and inline images

Teams encodes emoji as `<emoji alt="😃">`, an element with no text content, and
inline images as `<img>`. The script's HTML flattening dropped both, which lost
every emoji and made an image-only message flatten to the empty string — at
which point it was discarded as a system event. Emoji now come through as
characters and images as `[image]`. Emoji are double-width, which the render
regression covers.

## Speed

Addressing a chat by name costs a full chat-list fetch to resolve it — measured
2.65s of a 4.26s call, more than double the message fetch itself. The composer
already knows the id, so it passes `--chat-id` and skips that lookup entirely:
**4.26s → 1.86s**. Sending takes the same shortcut. Name addressing still works
for the agent tools, which only have a name to go on.

## Reaching someone not in the list

The picker lists 100 chats. `^p` searches `/me/people` — the relevance graph of
people you actually interact with, since directory queries (`/users`) are
throttled to 429 in this tenant. A result is matched to an existing chat **by
email**, not by display name.

If there is no existing chat, it says so and stops. Starting a brand new
conversation would mean `POST /chats`, which this extension deliberately does
not do: open it once in the Teams client and it appears here.
