#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["click", "loguru", "httpx"]
# ///
"""Read TRACE production state and report new confusing or failed interactions."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import NamedTuple, Protocol
from zoneinfo import ZoneInfo

import click
import httpx
from loguru import logger

HERE = Path(__file__).resolve().parent
HOME = Path(os.environ.get("WAYNE_INBOX_DIR", Path.home() / ".wayne" / "inbox"))
POSTED = HOME / "cursors" / "trace-monitor.posted.json"
VERDICTS = HOME / "cursors" / "trace-monitor.verdicts.json"
TZ = ZoneInfo("Asia/Shanghai")
GROUP = "<group-chat-id>"

# SQL validated read-only against prod on 2026-11-05 by the coordinator session (v2 after replay spot-check).
REPLY_SQL = "select json_agg(x order by x.created_at) from (\n select ca.id, ca.conversation_id, ca.created_at, ca.sender, ca.route, ca.outcome, ca.question, ca.rendered_answer as answer,\n        ref.conversation_type, ref.locale,\n  (select coalesce(json_agg(tr), '[]'::json) from (\n     select k.ticket as ticket_id, t.id as task_id,\n            coalesce(ev.st->>'status', '(not recorded at reply time)') as task_status,\n            ev.st->>'detail' as status_detail, lr.run as latest_run_before_reply,\n            j.status as jira_status_now, j.observed_at as jira_observed_at,\n            v.output->>'is_valid' as is_valid, v.output->>'invalid_reason' as invalid_reason,\n            coalesce(v.output->'missing_fields', '[]'::jsonb) as missing_fields,\n            (select coalesce(json_object_agg(key, value), '{}'::json) from jsonb_each_text(coalesce(v.output->'other_information', '{}'::jsonb)) where right(key, 5) = '_note') as field_notes,\n            ri.comment as request_info_comment, jc.comments as trace_jira_comment_excerpts,\n            t.result->>'block_message' as block_message\n     from (select distinct upper(m[1]) as ticket from regexp_matches(ca.question || ' ' || ca.rendered_answer, '\\m([A-Za-z][A-Za-z0-9]+-[0-9]+)\\M', 'g') m) k\n     left join lateral (select * from tasks t where t.ticket_id = k.ticket and t.deleted_at is null order by t.created_at desc limit 1) t on true\n     left join lateral (select coalesce(\n              (select json_build_object('status', e.data->>'status', 'detail', e.data->>'detail') from trace_events e where e.task_id = t.id::text and e.type = 'task_status_changed' and e.created_at <= ca.created_at order by e.created_at desc limit 1),\n              case when t.status_entered_at <= ca.created_at then json_build_object('status', t.status, 'detail', t.status_detail) end) as st) ev on true\n     left join lateral (select json_build_object('run_number', r.run_number, 'status_now', r.status, 'started_at', r.started_at, 'finished_at', r.finished_at, 'running_at_reply_time', r.finished_at is null or r.finished_at > ca.created_at) as run from pipeline_runs r where r.task_id = t.id and r.started_at <= ca.created_at order by r.run_number desc limit 1) lr on true\n     left join lateral (select coalesce(json_agg(c.x order by c.at), '[]'::json) as comments from (select e.created_at as at, e.data->>'excerpt' as x from trace_events e where e.task_id = t.id::text and e.type = 'jira_comment_posted' and e.created_at <= ca.created_at order by e.created_at desc limit 3) c) jc on true\n     left join lateral (select s.output from pipeline_steps s join pipeline_runs r on r.id = s.run_id where r.task_id = t.id and s.step_id = 'validate' and s.status = 'completed' and s.finished_at <= ca.created_at order by s.finished_at desc limit 1) v on true\n     left join lateral (select s.input->>'comment' as comment from pipeline_steps s join pipeline_runs r on r.id = s.run_id where r.task_id = t.id and s.step_id = 'request_info' and s.finished_at <= ca.created_at order by s.finished_at desc limit 1) ri on true\n     left join jira_ticket_observations j on j.ticket_id = k.ticket\n     where t.id is not null or j.ticket_id is not null\n  ) tr) as truths\n from captain_answers ca left join teams_conversation_refs ref using (conversation_id)\n where ca.created_at >= :S and ca.created_at < :U\n) x"
FAIL_SQL = "select json_agg(x order by x.started_at) from (\n select r.id as run_id, t.id as task_id, t.ticket_id, r.run_number, r.status as run_status, r.failure_kind, r.started_at,\n        left(coalesce(r.result->>'error', r.result->>'block_message', ''), 600) as error,\n        rv.verdict as review_verdict, rv.root_cause_category as review_category, rv.trace_defect_likelihood::float as defect_likelihood,\n        left(rv.reason_detail, 600) as review_reason, left(rv.error, 400) as review_error\n from pipeline_runs r join tasks t on t.id = r.task_id\n left join lateral (select * from run_reviews x where x.run_id = r.id order by x.reviewed_at desc limit 1) rv on true\n where r.started_at >= :S and r.started_at < :U and r.status in ('failed', 'blocked')) x"
SILENT_SQL = "select json_agg(x) from (\n select h.conversation_id, ref.user_name, h.created_at as asked_at, left(h.content, 400) as question\n from (select distinct on (m.conversation_id) m.* from teams_messages m join teams_conversation_refs r using (conversation_id)\n       where r.conversation_type = 'personal' and m.author <> 'Captain' order by m.conversation_id, m.created_at desc) h\n join teams_conversation_refs ref using (conversation_id)\n where h.created_at >= :S - interval '7 days' and h.created_at < :U - interval '7 days'\n   and not exists (select 1 from captain_answers ca where ca.conversation_id = h.conversation_id and ca.created_at >= h.created_at)) x"
ATT_SQL = "select json_agg(x order by x.entered_at) from (\n select t.id as task_id, t.ticket_id, e.created_at as entered_at, e.data->>'detail' as status_detail,\n   (select left(m.content, 1500) from teams_messages m where m.author = 'Captain' and m.content like '%/tasks/' || t.id::text || '%' and m.created_at between e.created_at and e.created_at + interval '15 minutes' order by m.created_at limit 1) as notice,\n   (select s.input->>'comment' from pipeline_steps s join pipeline_runs r on r.id = s.run_id where r.task_id = t.id and s.step_id = 'request_info' and s.finished_at between e.created_at - interval '10 minutes' and e.created_at + interval '1 minute' order by s.finished_at desc limit 1) as jira_comment,\n   left(coalesce((select coalesce(r.result->>'block_message', r.result->>'error') from pipeline_runs r where r.task_id = t.id and r.started_at <= e.created_at order by r.run_number desc limit 1), case when t.status_entered_at <= e.created_at + interval '1 minute' then t.result->>'block_message' end), 2000) as dashboard_reason,\n   (select json_build_object('invalid_reason', s.output->>'invalid_reason', 'missing_fields', coalesce(s.output->'missing_fields','[]'::jsonb),\n        'field_notes', (select coalesce(json_object_agg(key, value), '{}'::json) from jsonb_each_text(coalesce(s.output->'other_information','{}'::jsonb)) where right(key,5)='_note'))\n      from pipeline_steps s join pipeline_runs r on r.id = s.run_id where r.task_id = t.id and s.step_id = 'validate' and s.status = 'completed' and s.finished_at <= e.created_at order by s.finished_at desc limit 1) as validate,\n   (select j.status from jira_ticket_observations j where j.ticket_id = t.ticket_id) as jira_status_now\n from trace_events e join tasks t on t.id::text = e.task_id\n where e.type = 'task_status_changed' and e.data->>'status' = 'needs_attention' and e.created_at >= :S and e.created_at < :U) x"

REPLY_RUBRIC = """You judge one Captain reply. Decide whether it gives the reader a correct, actionable next step consistent with the ground truth.
Flag (flag=true) if it contradicts ground truth, says nothing needs to change or validation may be wrong while validate lists missing fields, tells the reporter that fields listed in missing_fields are fine / not to change the description / that validation is probably wrong, does not answer the question asked (for example "Reached max tool call rounds."), misstates TRACE or Jira status, admits it cannot tell why and offers no path forward, gives no needed next step, uses a different language from the asker, or is unreadably long.
Ground truth is what TRACE recorded. A field the case does not show (for example a Jira comment not in the excerpts, or a status not recorded at reply time) is unknown, not false: never flag a reply for stating something the case cannot confirm or refute.
jira_status_now is today's Jira status, not the status at reply time; do not use it to call an older reply wrong.
When the asker does not ask about the ticket's state (an acknowledgement, a request to draft a message, a statement of what they will do), a correct acknowledgement or the requested text is enough; do not require a TRACE next step.
Do not flag a correct answer just because it is non-English or short. The same language as the asker's is never a finding by itself.
The reason is one short line in Simplified Chinese naming the defect concretely; for false use a short reason such as 无问题.
Output exactly one JSON object: {"flag": bool, "reason": str}."""

ATTENTION_RUBRIC = """Judge what a person was shown when a TRACE task entered needs_attention: the Captain notice, Jira comment and dashboard reason, beside the ground truth.
The Captain notice format '⚠️ <ticket> is blocked / needs attention — <reason> <link>' with a status token as reason is the standard notice; judge whether the reader, following the link and the Jira comment, gets a concrete next step. Flag the token only when neither the notice, the Jira comment nor the dashboard reason says what to do.
jira_status_now is today's status; a later Jira change does not make the text at entry time wrong.
Flag (flag=true) if the text shows a raw machine token without explaining what to do, contradicts ground truth (including missing fields or Jira status), gives no next step, or is unreadably long. Do not flag a short notice that names concrete missing fields or a concrete next step.
The reason is one short line in Simplified Chinese naming the defect concretely; for false use 无问题.
Output exactly one JSON object: {"flag": bool, "reason": str}."""

FAILURE_RUBRIC = """Write the one-line reason for an already classified TRACE-side failure using the signal, review reason and error in the case. Do not reclassify it. The reason is one line in Simplified Chinese naming what failed. Keep flag=true; the caller ignores the flag.
Output exactly one JSON object: {"flag": bool, "reason": str}."""


class Verdict(NamedTuple):
    flag: bool
    reason: str


class Finding(NamedTuple):
    key: str
    tag: str
    title: str
    link: str | None
    reason: str


class Judge(Protocol):
    def judge(self, rubric: str, case: str) -> Verdict: ...


def parse_verdict(raw: str) -> Verdict:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise ValueError("no JSON object")
    data = json.loads(match.group())
    if not isinstance(data, dict) or type(data.get("flag")) is not bool or not isinstance(data.get("reason"), str):
        raise ValueError("invalid verdict fields")
    reason = " ".join(data["reason"].split())[:120].rstrip()
    if not reason:
        raise ValueError("empty verdict reason")
    return Verdict(data["flag"], reason)


class MagpieJudge:
    def __init__(self, base_url: str, model: str):
        self.url = base_url.rstrip("/")
        if not self.url.endswith("/chat/completions"):
            self.url += "/chat/completions"
        self.model = model

    def judge(self, rubric: str, case: str) -> Verdict:
        request = {
            "model": self.model,
            "messages": [{"role": "system", "content": rubric}, {"role": "user", "content": case}],
            "temperature": 0,
            "max_tokens": 400,
        }
        for attempt in range(2):
            try:
                response = httpx.post(self.url, json=request, timeout=180)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise click.ClickException(f"judge transport failed: {type(exc).__name__}") from exc
            try:
                content = response.json()["choices"][0]["message"]["content"]
                if not isinstance(content, str):
                    raise ValueError("completion is not text")
                return parse_verdict(content)
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                logger.warning("judge returned invalid output on attempt {} ({})", attempt + 1, type(exc).__name__)
        raise click.ClickException("judge returned invalid output after retry")


def prod(cmd: str, timeout=180) -> str:
    b = base64.b64encode(cmd.encode()).decode()
    inner = ("PW=$(grep -o \"<password-ssh> -p '[^']*' ssh <prod-user>@<prod-ip>\" ~/.<credential-file> | tail -1 | sed \"s/^<password-ssh> -p '//; s/' ssh.*//\"); "
             f"<password-ssh> -p \"$PW\" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 <prod-user>@<prod-ip> \"echo {b} | base64 -d | bash\"")
    try:
        r = subprocess.run(["ssh", "-o", "BatchMode=yes", "<jump-host>", inner], capture_output=True, text=True,
                           timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise click.ClickException(f"prod ssh failed: {type(exc).__name__}") from exc
    if r.returncode:
        raise click.ClickException(f"prod ssh exited {r.returncode}: {r.stderr[-1000:]}")
    return r.stdout


def query_json(select_sql: str, since: datetime, until: datetime) -> list[dict]:
    body = select_sql.replace(':S', f"'{since.isoformat()}'::timestamptz").replace(':U', f"'{until.isoformat()}'::timestamptz")
    sql = "BEGIN READ ONLY;\n" + f"select translate(encode(convert_to(coalesce(({body})::text,'[]'),'UTF8'),'base64'), E'\\n', '');" + "\nROLLBACK;"
    b = base64.b64encode(sql.encode()).decode()
    out = prod(f"echo {b} | base64 -d | docker exec -i trace-db-1 psql -U trace -d trace -At")
    lines = [line.strip() for line in out.splitlines() if line.strip()]
    if len(lines) != 3 or lines[0] != "BEGIN" or lines[2] != "ROLLBACK":
        raise click.ClickException(f"unexpected prod query output: {out[-1000:]}")
    try:
        rows = json.loads(base64.b64decode(lines[1], validate=True))
    except (ValueError, UnicodeDecodeError) as exc:
        raise click.ClickException(f"invalid prod query payload: {out[-1000:]}") from exc
    if not isinstance(rows, list):
        raise click.ClickException("prod query payload is not an array")
    return rows


def sha(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:12]


def cached(judge: Judge, cache: dict[str, Verdict], rubric: str, case: str, key: str) -> Verdict:
    cache_key = f"{key}:{sha(case)}"
    if cache_key not in cache:
        cache[cache_key] = judge.judge(rubric, case)
    return cache[cache_key]


def link(task_id: str | None, ticket: str | None = None) -> str | None:
    if task_id:
        return f"https://trace.example.com/tasks/{task_id}"
    return f"https://example.atlassian.net/browse/{ticket}" if ticket else None


def strip_quote(answer: str) -> str:
    return re.sub(r"\A> \*\*[^*\n]+ asked:\*\*(?:\r?\n>[^\n]*)*\s*", "", answer, count=1).strip()


def reply_case(row: dict) -> str:
    answer = strip_quote(row["answer"])
    truth = []
    for item in row.get("truths") or []:
        stable = {key: value for key, value in item.items() if key != "jira_observed_at"}
        run = item.get("latest_run_before_reply")
        if isinstance(run, dict):
            stable["latest_run_before_reply"] = {key: run.get(key) for key in
                                                 ("run_number", "started_at", "running_at_reply_time")}
        truth.append(stable)
    return "\n".join([
        f"asker: {row.get('sender') or '(unknown)'}", f"reply time: {row['created_at']}",
        "question:", row["question"], "captain reply:", answer, f"reply length: {len(answer)} characters",
        "ground truth:", json.dumps(truth, ensure_ascii=False, indent=2),
    ])


def confusing_replies(rows: list[dict], judge: Judge, cache: dict[str, Verdict]) -> tuple[list[Finding], int]:
    findings = []
    for row in sorted(rows, key=lambda item: len(strip_quote(item["answer"])), reverse=True):
        key = f"confusing_reply:{row['id']}"
        verdict = cached(judge, cache, REPLY_RUBRIC, reply_case(row), key)
        if verdict.flag:
            truths = row.get("truths") or []
            ticket = truths[0].get("ticket_id") if truths else None
            task = next((truth.get("task_id") for truth in truths if truth.get("task_id")), None)
            findings.append(Finding(key, "Captain 回复", ticket or "(no ticket)", link(task, ticket), verdict.reason))
    return findings, len(rows)


def keep_failure(row: dict) -> bool:
    likelihood = row.get("defect_likelihood")
    if likelihood is not None and likelihood >= 0.5:
        return True
    if row["run_status"] == "failed":
        return not (row.get("review_verdict") in {"failed", "blocked"}
                    and likelihood is not None and likelihood < 0.5)
    return False


def trace_failures(rows: list[dict], judge: Judge, cache: dict[str, Verdict]) -> tuple[list[Finding], int]:
    findings = []
    groups = defaultdict(list)
    kept = 0
    for row in rows:
        if row.get("review_verdict") == "error":
            first_line = (row.get("review_error") or "(no reviewer error detail)").splitlines()[0]
            groups[first_line].append(row)
        if keep_failure(row):
            kept += 1
            key = f"trace_failure:run:{row['run_id']}"
            case = json.dumps(row, ensure_ascii=False, indent=2)
            verdict = cached(judge, cache, FAILURE_RUBRIC, case, key)
            title = f"{row.get('ticket_id') or '(no ticket)'} #{row['run_number']}"
            findings.append(Finding(key, "TRACE 失败", title, link(row.get("task_id"), row.get("ticket_id")),
                                    verdict.reason))
    for first_line, grouped in groups.items():
        key = f"trace_failure:review_error:{sha(first_line)}"
        case = f"reviewer error, occurrences: {len(grouped)}\nerror:\n{grouped[0].get('review_error') or first_line}"
        verdict = cached(judge, cache, FAILURE_RUBRIC, case, key)
        findings.append(Finding(key, "TRACE 失败", f"reviewer error ×{len(grouped)}", None, verdict.reason))
    return findings, kept


def silent_services(rows: list[dict]) -> list[Finding]:
    findings = []
    for row in rows:
        name = row.get("user_name") or "(unknown)"
        question = " ".join(row["question"].split())[:60]
        key = f"silent_service:{row['conversation_id']}:{row['asked_at']}"
        findings.append(Finding(key, "7 天未回复", name, None, f"{name} 提问 7 天无 Captain 回答：{question}"))
    return findings


def confusing_attention(rows: list[dict], judge: Judge, cache: dict[str, Verdict]) -> list[Finding]:
    findings = []
    for row in rows:
        key = f"confusing_attention:{row['task_id']}:{row.get('status_detail')}"
        case = json.dumps(row, ensure_ascii=False, indent=2)
        verdict = cached(judge, cache, ATTENTION_RUBRIC, case, key)
        if verdict.flag:
            findings.append(Finding(key, "needs_attention", row.get("ticket_id") or "(no ticket)",
                                    link(row["task_id"], row.get("ticket_id")), verdict.reason))
    return findings


def calibration_cases() -> list[dict]:
    truth = {
        "ticket_id": "PROJ-1001", "task_id": "00000000-0000-4000-8000-000000000001",
        "task_status": "needs_attention", "status_detail": "ticket_invalid",
        "latest_run_before_reply": None, "jira_status_now": "Assessed", "jira_observed_at": None,
        "is_valid": "false", "invalid_reason": "missing_fields", "missing_fields": ["host_os", "vf_num", "failed_log"],
        "field_notes": {
            "vf_num_note": "Ticket states 'VF Num: N/A (reproduced with all / any VF count)'; no specific per-PF VF count given",
            "host_os_note": "Only 'Windows' given; no Windows Server version stated",
            "failed_log_note": "Ticket states 'Failed Log: N/A (host unclean reboot / no failure log generated)'; no crash dump, event log, or WPP trace attached",
        },
        "trace_jira_comment_excerpts": [],
        "request_info_comment": "[TRACE AI] TRACE automated fix cannot proceed. Reason: missing_fields\nMissing fields: - host_os\n- vf_num\n- failed_log\nIf fields are missing, please edit the ticket description to include the missing details (not as a comment). Once updated, click Retry on the TRACE dashboard to re-run.",
        "block_message": None,
    }
    row = {
        "id": "00000000-0000-4000-8000-000000000004", "created_at": "2026-11-05T05:25:37.285079+00:00",
        "sender": "Petrovic, Marko", "route": "agentkit", "outcome": "answer", "conversation_type": "personal",
        "locale": "en-US", "truths": [truth],
        "question": "pitanje je za ovaj task: https://example.atlassian.net/browse/PROJ-1001\nTRACE kaze missing_fields: host_os, vf_num, failed_log. If fields are missing, edit the ticket description and click Retry.\na meni u opisu tiketa stoji: Windows host unclean reboot. Host OS: Windows. VF Num: N/A (reproduced with all / any VF count). Failed Log: N/A (host unclean reboot / no failure log generated). znaci postoje te informacije",
        "answer": "> **Petrovic, Marko asked:**\n> pitanje je za ovaj task PROJ-1001\n\nMarko, u pravu si. Proverio sam trenutni opis **PROJ-1001**: u njemu već stoje **Host OS: Windows**, **VF Num: N/A** uz objašnjenje da se problem reprodukuje sa bilo kojim brojem VF-ova, i **Failed Log: N/A** uz objašnjenje da log nije generisan. Tip tiketa je **Defect**, tako da ni to nije problem koji treba da ispraviš.\n\nTRACE ipak vodi task kao **needs_attention / ticket_invalid**, bez PR-a. Ne mogu iz dostupnog statusa da utvrdim zašto je provera prijavila sva tri polja kao nedostajuća. Moguće je da ne prepoznaje format ili vrednosti `N/A`, ali to ne bih tvrdio bez uvida u samu proveru. Takođe, poruka u komentaru kaže da tiket ostaje *Opened*, dok je njegov trenutni JIRA status **Assessed** — taj deo poruke više ne odražava trenutno stanje.\n\n**Ne bih menjao opis samo da ponoviš informacije koje već postoje.** Ako želiš, mogu da pokrenem ponovni pokušaj TRACE taska; ako ponovo prijavi ista polja, to bi bio jasan signal da treba ispraviti validaciju, a ne sadržaj tiketa.",
    }
    correct = {**row, "id": "calibration-correct", "question": "Koja polja nedostaju i šta da radim?",
               "answer": "Dodaj tačnu verziju Windows Servera i broj VF-ova u opis, priloži log greške, a zatim klikni Retry."}
    short = {**row, "id": "calibration-short", "question": "Is my ticket ok?",
             "answer": "Looks fine, no action needed."}
    return [row, correct, short]


def read_json(path: Path, default):
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def render_digest(findings: list[Finding], now: datetime, replies: int, failures: int, kept: int,
                  attention: int, silent: int) -> str:
    lines = [f"TRACE monitor {now.astimezone(TZ):%m-%d %H:%M} · {len(findings)} new"]
    for finding in findings:
        target = f"{finding.title} {finding.link}" if finding.link else finding.title
        lines.append(f"- [{finding.tag}] {target} — {finding.reason}")
    lines.append(f"judged: {replies} Captain answers · {failures} failed/blocked runs ({kept} kept) · "
                 f"{attention} needs_attention · {silent} silent")
    return "\n".join(lines)


def post_digest(target: str, digest: str) -> None:
    destination = (f"`target: chat` with `chat_id` `{GROUP}`" if target == "group" else "`target: self`")
    prompt = (HERE / "trace-monitor.prompt.md").read_text().replace("{{DESTINATION}}", destination)
    prompt = prompt.replace("{{DIGEST}}", digest)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["omp", "-p", "--no-session", "--no-title", "--max-time", "10m", "--tools", "teams_send", prompt],
                           check=True, stdout=subprocess.DEVNULL, cwd=tmp)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise click.ClickException(f"omp post failed: {type(exc).__name__}") from exc


@click.command()
@click.option("--days", default=2, type=click.IntRange(min=1), show_default=True)
@click.option("--post", is_flag=True)
@click.option("--target", type=click.Choice(["group", "self"]), default="group", show_default=True)
@click.option("--model", envvar="TRACE_MONITOR_MODEL", default="group/small-model", show_default=True)
@click.option("--judge-url", envvar="TRACE_MONITOR_JUDGE_URL", default="http://127.0.0.1:3425/v1", show_default=True)
@click.option("--calibrate", is_flag=True)
@click.option("-v", "--verbose", is_flag=True)
def main(days: int, post: bool, target: str, model: str, judge_url: str, calibrate: bool, verbose: bool) -> None:
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")
    judge = MagpieJudge(judge_url, model)
    if calibrate:
        matches = True
        for name, row, expected in zip(("PROJ-1001", "Serbian correct", "short misleading"),
                                       calibration_cases(), (True, False, True)):
            verdict = judge.judge(REPLY_RUBRIC, reply_case(row))
            click.echo(f"{name}: expected={expected} actual={verdict.flag} reason={verdict.reason}")
            matches &= verdict.flag == expected
        if not matches:
            raise click.ClickException("calibration mismatch")
        return
    now = datetime.now(TZ)
    since = now - timedelta(days=days)
    logger.info("reading TRACE production window {} to {}", since.isoformat(), now.isoformat())
    replies = query_json(REPLY_SQL, since, now)
    failures = query_json(FAIL_SQL, since, now)
    silent = query_json(SILENT_SQL, since, now)
    attention = query_json(ATT_SQL, since, now)
    cache = {key: Verdict(**value) for key, value in read_json(VERDICTS, {}).items()}
    reply_findings, judged = confusing_replies(replies, judge, cache)
    failure_findings, kept = trace_failures(failures, judge, cache)
    attention_findings = confusing_attention(attention, judge, cache)
    write_json(VERDICTS, {key: verdict._asdict() for key, verdict in cache.items()})
    posted = set(read_json(POSTED, []))
    new = []
    for finding in reply_findings + failure_findings + silent_services(silent) + attention_findings:
        if finding.key not in posted:
            new.append(finding)
            posted.add(finding.key)
    if not new:
        click.echo("no new findings")
        return
    digest = render_digest(new, now, judged, len(failures), kept, len(attention), len(silent))
    if post:
        post_digest(target, digest)
        write_json(POSTED, sorted(posted))
    else:
        click.echo(digest)


if __name__ == "__main__":
    main()
