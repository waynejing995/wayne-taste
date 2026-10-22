# Rules for live tests in this extension

Live tests reach real mail. These rules keep them from reaching anyone else's,
and from leaving their mail behind.

## 1. A live test mails only the user's own address

`live-seed.mjs` reads every recipient in the message it sends (To, Cc and Bcc,
groups expanded). Unless each one is the placeholder `self@example.invalid`, it
refuses and exits 1 before it asks for a token or builds a request. Only then is
the placeholder replaced by the signed-in account's own address, so the mail can
reach no one but the person running it, and no address is written in this
repository. The check lives in the script, so nobody has to remember it.

`live-cleanup.mjs` sends nothing. It moves and deletes mail, and only messages
whose subject carries one of the markers in rule 2.

## 2. A live test cleans up after itself

Every message a live test creates carries a subject marker: `[omp outlook e2e]`
for the seed and end-to-end runs, `[omp outlook probe]` for probes.
`live-cleanup.mjs` moves each match in Inbox, Archive, Sent Items and Drafts to
Deleted Items, then deletes every match in Deleted Items, including leftovers
from earlier runs. Run it at the end of any session that used a live script.

A new live script either uses one of these markers or cleans up its own mail.

## 3. Live output prints counts and field names, never message bodies

`live-cleanup.mjs` prints how many messages it moved or deleted in each folder.
`live-seed.mjs` prints the subject it sent and the recipient. In `--dry-run` it
also prints the header field names of the request. Neither script prints a body.

## 4. Fixtures are synthetic

`tests/fixtures/` holds invented mail only. No tenant mail is copied into the
repository, not even scrubbed.

## 5. The seed is generated, not hand-edited

`tests/fixtures/seed-report.eml` is `seed-report.md` run through `buildEml`
(`mime.ts`), with `from` and `to` set to the user's address, the subject
`[omp outlook e2e] seed report`, and no agent footer: the seed is not sent by
the agent.

The `Message-ID` and `Date` headers in the file are stale by design.
`live-seed.mjs` drops them, so Exchange stamps fresh ones and never de-duplicates
a re-send. To change the seed, change `seed-report.md` and regenerate the file
with `buildEml` and those same inputs. Do not hand-edit the `.eml`.

The seed has tone spans for `ok`, `bad`, `warn` and `muted`, a `SUMMARY` callout,
a key/value sheet, a GFM table with a header row, a fenced code block, a link and
CJK text. It has no `info` span.

## 6. Live tests are not part of the offline suite

`node tests/run.mjs` runs the suites it lists, with no sign-in and no network,
and it must stay that way. The live scripts are not in its list. Run them by
hand: `node tests/live-seed.mjs` and `node tests/live-cleanup.mjs`. They use the
sign-in from `/teams init` and never prompt for one.

## 7. `--dry-run` never reaches the network or the token cache

Both live scripts accept `--dry-run`. It prints the requests they would make,
answers them from a fake transport (`live-cleanup.mjs` uses an in-memory
mailbox), and never calls `getToken`. Use it to check a change to a live script
before running the real thing. `live-seed.mjs` still refuses a non-self recipient
in a dry run.
