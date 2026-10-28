# Outlook (part of pi-ext-m365)

Outlook mail for omp and pi. The agent gets ten mail tools and an Inbox unread
count in the status bar, and you get a NeoMutt-style `/outlook` overlay. Mail is
written in Markdown, rendered to Outlook-styled HTML with semantic colours, and
sent as MIME through Microsoft Graph. Mail is read from its raw MIME and
converted back to Markdown.

## Requirements

This is the Outlook half of `pi-ext-m365` (`../README.md`). It uses the shared
modules in `../core/`: the sign-in (`auth.ts`) and Graph client (`graph.ts`),
people search (`people.ts`, behind `outlook_people`), SharePoint downloads
(`shares.ts`), file saving (`save-file.ts`), picture descriptions
(`describe-image.ts`), the @mention syntax (`mention.ts`) and the status row.

## Layout

| File | Role |
| --- | --- |
| `index.ts` | Entry point: the ten tools, `/outlook` and the status-bar count. |
| `overlay.ts` | `openOutlookOverlay`: the index, folder picker, pager and compose screens. |
| `mailbox.ts` | `Mailbox`: every mail operation against Graph, folders, and `FOLDER_LABELS`. |
| `mime.ts` | `buildEml`, `parseEml`, `respondDefaults`, `withMentioned`, `mailImages`, `AGENT_FOOTER`: the MIME in and out. |
| `render.ts` | `renderMarkdown`, `TONES`, `CALLOUTS`: Markdown to HTML, and the palette. |
| `convert.ts` | `htmlToMarkdown`: mail HTML back to Markdown. |
| `signature.ts` | `readSignature`, `writeSignature`: the signature file. |
| `files.ts` | `sharedLinks`, `saveAttachment`, `freePath`: attachments and linked SharePoint/OneDrive files on disk. |

## Sign in

Sign in once with `/teams init`. Outlook never prompts; it reads the Teams token
cache silently.

- The cache is `$XDG_CACHE_HOME/pi/teams-auth/msal-cache.json`, or
  `~/.cache/pi/teams-auth/msal-cache.json` when `XDG_CACHE_HOME` is unset.
- With no cache, or when the silent refresh fails, the tools fail with
  `not authenticated — run /teams init`.
- The token is requested for `https://graph.microsoft.com/.default`. Mail needs
  `Mail.ReadWrite` and `Mail.Send` in its `scp` claim; the Teams Graph token
  carries both.
- Your own name and addresses (From, and who counts as self in a reply) come
  from `/me` once and are then cached in `$XDG_CACHE_HOME/pi/outlook-me.json`:
  the tenant throttles `/me` for minutes at a time. Delete the file after
  signing in as someone else.

## Surfaces

- **Agent tools:** `outlook_list`, `outlook_folders`, `outlook_search`,
  `outlook_read`, `outlook_download`, `outlook_people`, `outlook_draft`,
  `outlook_send`, `outlook_move`, `outlook_mark`.
- **Status bar:** the unread count in Inbox, on the same row as the Teams count
  (`Outlook: 6 unread Teams: 0`); both write their part through
  `../core/status-row.ts`, because omp gives each status key its own line.
- **`/outlook`:** at a frame 140 columns or wider, Outlook's three panes:
  folders | messages | reading pane. The reading pane follows the highlighted
  message once it rests (200 ms) without marking it read; Enter opens it there
  and marks it read. Narrower, one pane at a time: index, then pager, then
  compose. A draft always takes the whole frame.
- **`/outlook signature`:** edit your signature (below).

`outlook_send` sends only when the user asks for it explicitly. Mail the agent
sends carries the footer `sent by omp agent` right after its own body (and
signature), above any quoted original, so a reply never stacks its footer under
someone else's mail. Mail you send from `/outlook` carries no footer. The quoted
original's header gives `Sent` in local time and leaves out `Cc` when there was none.
Recipient and @mention addresses come from `outlook_people`
or from the mail being answered; the tool descriptions forbid guessing one.

### Signature

`/outlook signature` opens an editor on your signature, in the same Markdown
dialect as a mail body; saving it empty removes it. It is stored in
`~/.pi/agent/outlook-signature.md`, which you can also edit directly: Graph
exposes no Outlook signature, so the one set in Outlook itself is not used.
It is read at every send, so a change applies to the next message.

Every message gets it — agent-sent and drafted mail, and mail you write in
`/outlook`, where it shows dimmed under the body. It goes after the body and
above the quoted original, as Outlook places it; the agent footer follows it.
The tool descriptions tell the agent not to sign mail itself.

### Folders

`outlook_folders` lists every folder with its unread and total counts,
subfolders included, so the folders mail rules file into (`Inbox/dri-devel`,
say) are reachable. `outlook_list` takes a well-known name (`inbox`, `archive`,
`sentitems`, `drafts`, `deleteditems`), a full path, or a folder's own name; a
name two folders share is an error that lists both paths. `skip` pages further
back.

### Pictures

A picture in a mail body reads as `[image N: file name]`. `outlook_read` attaches
the first four pictures to its result, so the model sees them; a picture of a
type the model cannot read, or over 3.75 MB, is named as not attached with the
reason. Exchange labels inline images `Content-Disposition: attachment`, so any
part the HTML cites by `cid:` counts as inline. The pager shows a model-written
description after each label, cached on disk by content hash, and lists
attachments the body does not show, a picture among them with its description.

Pictures are described, not drawn: showing them in tty7 was tried and the layout
came out wrong (see `../teams/README.md`, Pictures).

### Attachments and linked files

Nothing is saved unless you ask. `outlook_read` lists the attachments and the
SharePoint/OneDrive files the body links to (ordinary web links are not files).
`outlook_download` saves one of them — an attachment by name, or a linked file
by its URL through Graph's `/shares` — and its description tells the agent to
call it only when you ask. In the pager, `s` lists the same and Enter saves the
highlighted one. Saves go to `~/Downloads` under the file's own name and never
overwrite: a taken name becomes `name (1).ext`. Protected (`rpmsg`) mail and
meeting invites are attachments like any other; Graph cannot decrypt the former.

## Keys

The `/outlook` overlay uses this key set. In the three-pane layout, ← / → / Tab
move between panes: ← or `c` from messages to folders, → or Tab back; Enter, →
or Tab from messages to the reading pane, ← / Esc / `q` back; Tab from the
reading pane to folders. The folders pane is the folder picker below.

In a Tern pane the same keys apply; a click selects a message or folder, a
double-click opens it, and the Send?/Discard? prompts also have Yes/No buttons.

### Index

| Key | Action |
| --- | --- |
| `j` / `k` / ↓ / ↑ | Next / previous message; past the last row the next 50 load |
| PgDn / PgUp | One screen down / up |
| Enter / → | Open in the pager (marks it read) |
| `/` | Search |
| `c` | Folder picker |
| `m` | New mail |
| `r` / `g` / `f` | Reply / reply all / forward |
| `a` | Archive |
| `d` | Delete (moves to Deleted Items) |
| `N` | Toggle read / unread |
| `q` / Esc | Close |

### Search prompt

Type the query, then Enter runs it. Esc cancels and reloads the folder.

### Folder picker

Every mail folder, subfolders indented under their parent with their unread
count. It opens on the folder listed now.

| Key | Action |
| --- | --- |
| `j` / `k` / ↓ / ↑ | Down / up |
| PgDn / PgUp | One screen down / up |
| Enter | Open the folder |
| `q` / Esc | Cancel |

### Pager

| Key | Action |
| --- | --- |
| `j` / `k` / ↓ / ↑ | One line down / up |
| Space / PgDn, PgUp | One screen down / up |
| `s` | Save an attachment or a linked file (Enter saves, Esc back) |
| `r` / `g` / `f` | Reply / reply all / forward, as in the index |
| `q` / Esc / ← | Back to the index |

### Compose

The fields are To, Cc, Subject and Body.

| Key | Action |
| --- | --- |
| Tab | Next field |
| Ctrl+S | Send. Asks `Send? (y/n)` |
| Ctrl+P | Save to Drafts |
| Esc | Leave. Asks `Discard draft? (y/n)` when anything was typed |
| Enter | New line in Body; nothing in the other fields |

### Prompts

`y` answers yes; `n` or Esc answers no.

## Markdown dialect

Colour is semantic. You name a meaning and the palette supplies the colour;
Markdown never carries a hex value. The palette lives in `render.ts`, and
`convert.ts` maps the same styles back to Markdown when it reads mail.

- **Tone spans** `[text]{.ok}`, `{.bad}`, `{.warn}`, `{.muted}` or `{.info}`.
  A span stays on one line. Any other tone, such as `{.pink}`, is not a span
  and stays as written.
- **Callouts** are quotes that open with `[!SUMMARY]`, `[!NOTE]`, `[!TIP]`,
  `[!WARNING]` or `[!CAUTION]`. The kind is uppercase only: `[!note]` is an
  ordinary quote.
- **Key/value sheets** are two-column tables with a blank header row. Their keys
  are shaded.
- **Mentions** `@[Name](address)` become Outlook @mention anchors
  (`<a id="OWAAM…Z" href="mailto:…">@Name</a>`). As in Outlook, a mentioned
  person not already in To or Cc is added to To. Recipients come from the same
  parse the renderer draws, so an example in code or an escaped `\@[…](…)` adds
  nobody. Received mentions read back in the same syntax. The Teams extension
  takes the same syntax.
- **Other tables** are GFM tables with a header row.
- **Raw HTML** is shown as text, never as markup, so the writer cannot inject a
  colour, a class or a `<style>` element.

## Replies and forwards

- A reply goes to the sender. Reply-all goes to the sender and everyone on the
  original To line, and copies the original Cc line. An address in both lists
  stays in To. A forward starts with no recipients and keeps all attachments;
  a reply keeps only inline ones.
- Your own addresses are dropped from every list. The one exception: a reply to
  mail you sent yourself goes back to you, because nobody else is addressed.
- `Reply-To` is ignored.
- Graph does not quote the original, so the message carries its own quote: an
  Outlook-style block (From, Sent, To, Cc, Subject), then the original. The text
  copy quotes it with `> `.

## Live scripts

These send and delete real mail. Read [`tests/LIVE-TEST-RULES.md`](tests/LIVE-TEST-RULES.md)
first.

- `node tests/live-seed.mjs` sends `tests/fixtures/seed-report.eml` to your own
  address, so you can check the rendering in Outlook on the web. It refuses to
  run if any recipient is someone else.
- `node tests/live-cleanup.mjs` moves every `[omp outlook e2e]` and
  `[omp outlook probe]` message in Inbox, Archive, Sent Items and Drafts to
  Deleted Items, then deletes every such message in Deleted Items. It prints a
  count per folder.
- Both take `--dry-run`. It prints the requests and changes nothing; it never
  reaches the network or the token cache.

Both scripts use the sign-in from `/teams init`.

## Tests

```sh
npm test    # node tests/run.mjs
```

The offline suites need no sign-in and no network. They use fake transports and
load the modules through jiti, as pi does. Each suite also runs on its own, for
example `node tests/mime.test.mjs`.
