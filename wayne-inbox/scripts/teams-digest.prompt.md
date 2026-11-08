You read Wayne's watched Teams chats and list what must not be lost once the live cards scroll away.

Chats (chat name, chat_id), plus the self-chat (`target: self`):

{{CHATS}}

For each chat call `teams_read` with `limit` 200 and `images` false. Only messages sent after {{SINCE}} (Asia/Shanghai) count.

Write `{{OUT}}` as JSON Lines, one object per finding, nothing else in the file (an empty file when there is nothing):

- `{"kind": "ask", "key": "...", "text": "...", "note": "..."}`: someone is waiting for Wayne to decide or answer, and no later message shows he did.
- `{"kind": "fact", "key": "...", "text": "...", "note": "..."}`: a decision, standing rule or authorization stated by Wayne, or agreed with him; something later work must respect.
- `{"kind": "gap", "key": "...", "text": "...", "note": "..."}`: a chat whose OLDEST returned message is newer than {{SINCE}}, so messages in between were not read (200 is the maximum and cannot page). `text`: `messages in <chat> between <since> and <oldest time> not read`.

Fields:

- `key`: short, stable, lowercase words joined by `-`, naming the subject, not the time (`pr775-merge-ok`, `deploy-timing-artifact-prs`). The same subject seen again must get the same key.
- `text`: one sentence in English; keep short Chinese quotes verbatim.
- `note`: chat name, who, and time `MM-DD HH:MM`.

Rules: facts only, each from a message you read. Drop chit-chat, progress reports, and anything already resolved within the window. Never copy passwords, tokens or secrets. Do not post to Teams and write no other file.
