"""Scheduled jobs: register, fire into the ledger, judge, remove.

Runs against a throwaway WAYNE_INBOX_DIR. Nothing here touches ~/.wayne/inbox.
"""

import json
import os
from datetime import datetime
from pathlib import Path
import pytest
import yaml
from click.testing import CliRunner

import inbox  # noqa: E402
import schedule_jobs as jobs  # noqa: E402


runner = CliRunner()


@pytest.fixture(autouse=True)
def clean_home(tmp_path, monkeypatch):
    home = tmp_path / "inbox"
    home.mkdir()
    (home / "rules.yaml").write_text("github:\n  acme:\n    - when: {review: requested}\n      action: notify\n      tag: pr\n")
    monkeypatch.setattr(inbox, "HOME", home)
    monkeypatch.setattr(inbox, "RULES", home / "rules.yaml")
    monkeypatch.setattr(inbox, "LEDGER", home / "ledger.tsv")
    monkeypatch.setattr(inbox, "ARCHIVE", home / "archive.tsv")
    monkeypatch.setattr(inbox, "LOCK", home / ".ledger.lock")
    monkeypatch.setattr(inbox, "RULES_LOCK", home / "rules.yaml.lock")
    monkeypatch.setenv("WAYNE_INBOX_DIR", str(home))
    yield home


def run(*args):
    result = runner.invoke(inbox.cli, args)
    assert result.exit_code == 0, result.output or result.exception
    return result.output


def at(text):
    return datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=inbox.TZ)


def test_register_list_remove(clean_home):
    out = run("schedule", "add", "minute", "--every", "1", "--kind", "prompt", "--action", "hello")
    assert out.startswith("added minute next ")
    listed = run("schedule", "ls")
    assert "minute  every 1m" in listed and "last never" in listed and "prompt hello" in listed
    rules = (clean_home / "rules.yaml").read_text()
    assert rules.startswith("github:\n")  # the schedule block does not disturb the rules above it
    assert "acme" in rules
    run("schedule", "rm", "minute")
    assert run("schedule", "ls").strip() == "(no scheduled jobs)"


def test_shell_job_writes_one_ledger_row(clean_home):
    run("schedule", "add", "echo", "--every", "1", "--kind", "shell", "--action", '["echo", "pong"]')
    lines = jobs.run_due(at("2026-11-10 12:00"), session=False)
    assert lines == []  # not due yet: the first fire is one interval from registration
    job = jobs.read_jobs()[0]
    job["next_fire"] = "2026-11-10 12:00"
    jobs.write_jobs(jobs.read_jobs()[:0] + [job] if False else [job])
    lines = jobs.run_due(at("2026-11-10 12:00"), session=False)
    assert lines[0].startswith("ok echo 2026-11-10T1200")
    rows = inbox.read_tsv(clean_home / "ledger.tsv")
    assert len(rows) == 1
    assert rows[0]["key"] == "schedule:echo:2026-11-10T1200"
    assert rows[0]["action"] == "notify"
    assert "pong" in rows[0]["note"]
    again = jobs.run_due(at("2026-11-10 12:00"), session=False)
    assert again == []  # the fire advanced next_fire, so the same minute does not write a second row
    assert len(inbox.read_tsv(clean_home / "ledger.tsv")) == 1


def test_timer_leaves_a_tool_job_due(clean_home):
    run("schedule", "add", "peek", "--every", "1", "--kind", "tool",
        "--action", '{"name": "teams_read", "args": {"target": "self"}}')
    job = jobs.read_jobs()[0]
    job["next_fire"] = "2026-11-10 12:00"
    jobs.write_jobs([job])
    lines = jobs.run_due(at("2026-11-10 12:00"), session=False)
    assert lines == ["skip peek: needs a live omp session"]
    assert jobs.read_jobs()[0]["next_fire"] == "2026-11-10 12:00"  # still due
    pending = run("schedule", "pending")
    assert pending.startswith("peek\tsession\t")


def test_session_finish_records_a_tool_result(clean_home):
    run("schedule", "add", "peek", "--every", "1", "--kind", "tool",
        "--action", '{"name": "teams_read", "args": {"target": "self"}}')
    job = jobs.read_jobs()[0]
    job["next_fire"] = "2026-11-10 12:00"
    jobs.write_jobs([job])
    out = run("schedule", "finish", "peek", "--output", "self-chat — 2 message(s)")
    assert out.startswith("ok peek 2026-11-10T1200")
    row = inbox.read_tsv(clean_home / "ledger.tsv")[0]
    assert row["action"] == "notify"
    assert "2 message(s)" in row["note"]


def test_judge_skip_is_recorded_not_pushed(clean_home):
    run("schedule", "add", "triage", "--every", "1", "--kind", "prompt", "--action", "noise",
        "--judge", "on", "--judge-prompt", "inject only outages")
    job = jobs.read_jobs()[0]
    job["next_fire"] = "2026-11-10 12:00"
    jobs.write_jobs([job])
    assert jobs.run_due(at("2026-11-10 12:00"), session=False) == ["skip triage: needs a live omp session"]

    def judge(prompt, output):
        assert prompt == "inject only outages" and output == "noise"
        return "SKIP", "nothing to report"

    lines = jobs.run_due(at("2026-11-10 12:00"), session=True, judge=judge)
    assert lines[0].startswith("skip triage")
    row = inbox.read_tsv(clean_home / "ledger.tsv")[0]
    assert row["action"] == "log"  # recorded, and the extension does not inject `log`
    assert jobs.read_jobs()[0]["last"]["status"] == "skip"
    assert "last skip" in run("schedule", "widget")


def test_judge_inject_can_summarize(clean_home):
    run("schedule", "add", "triage", "--every", "1", "--kind", "prompt", "--action", "disk full on host b",
        "--judge", "on", "--judge-prompt", "inject only outages")
    job = jobs.read_jobs()[0]
    job["next_fire"] = "2026-11-10 12:01"
    jobs.write_jobs([job])
    lines = jobs.run_due(at("2026-11-10 12:01"), session=True, judge=lambda _p, _o: ("INJECT", "host b is full"))
    assert lines[0].startswith("ok triage")
    row = inbox.read_tsv(clean_home / "ledger.tsv")[0]
    assert row["action"] == "notify"
    assert row["note"].startswith("host b is full")


def test_failed_shell_records_a_fail(clean_home):
    run("schedule", "add", "bad", "--every", "1", "--kind", "shell", "--action", '["false"]')
    job = jobs.read_jobs()[0]
    job["next_fire"] = "2026-11-10 12:00"
    jobs.write_jobs([job])
    lines = jobs.run_due(at("2026-11-10 12:00"), session=False)
    assert lines[0].startswith("fail bad")
    assert jobs.read_jobs()[0]["last"]["status"] == "fail"
    assert inbox.read_tsv(clean_home / "ledger.tsv")[0]["subject"].endswith("FAILED")

def test_registered_owner_is_kept_on_the_row(clean_home):
    run("schedule", "add", "ping", "--every", "1", "--kind", "prompt", "--action", "hi",
        "--owner", "lin")
    job = jobs.read_jobs()[0]
    job["next_fire"] = "2026-11-10 12:00"
    jobs.write_jobs([job])
    jobs.run_due(at("2026-11-10 12:00"), session=False)
    row = inbox.read_tsv(clean_home / "ledger.tsv")[0]
    assert row["owner"] == "lin"
    assert row["action"] == "notify"

def test_failed_verdict_records_a_row_and_advances(clean_home):
    run("schedule", "add", "boom", "--every", "1", "--kind", "tool",
        "--action", '{"name": "teams_read", "args": {"target": "self"}}')
    job = jobs.read_jobs()[0]
    job["next_fire"] = "2026-11-10 12:00"
    jobs.write_jobs([job])
    out = run("schedule", "finish", "boom", "--output", "teams down", "--verdict", "FAIL", "--summary", "teams down")
    assert out.startswith("fail boom")
    assert jobs.read_jobs()[0]["last"]["status"] == "fail"
    assert jobs.read_jobs()[0]["next_fire"] != "2026-11-10 12:00"
    row = inbox.read_tsv(clean_home / "ledger.tsv")[0]
    assert row["action"] == "notify" and row["note"] == "teams down"

def test_card_verdict_records_one_row_and_advances(clean_home):
    run("schedule", "add", "reader", "--every", "1", "--kind", "tool",
        "--action", '{"name": "read", "args": {"path": "/etc/hostname"}}')
    job = jobs.read_jobs()[0]
    job["next_fire"] = "2026-11-11 01:14"
    jobs.write_jobs([job])
    prompt = 'call the tool read with {"path": "/etc/hostname"}'
    out = run("schedule", "finish", "reader", "--output", prompt, "--verdict", "DISPATCHED", "--summary", prompt)
    assert out.startswith("dispatched reader")
    assert jobs.read_jobs()[0]["next_fire"] != "2026-11-11 01:14"
    rows = inbox.read_tsv(clean_home / "ledger.tsv")
    assert len(rows) == 1 and rows[0]["action"] == "do" and rows[0]["note"] == prompt

def test_judged_foreign_tool_is_rejected(clean_home):
    result = runner.invoke(inbox.cli, ["schedule", "add", "reader", "--every", "1", "--kind", "tool",
        "--action", '{"name": "read", "args": {}}', "--judge", "on", "--judge-prompt", "rule"])
    assert result.exit_code != 0
    assert "cannot be judged" in result.output


def test_cron_field_steps_and_ranges():
    assert jobs.cron_matches("*/15 * * * *", at("2026-11-10 12:45"))
    assert not jobs.cron_matches("*/15 * * * *", at("2026-11-10 12:46"))
    assert jobs.cron_matches("0 9 * * 1-5", at("2026-11-09 09:00"))  # Monday
    assert not jobs.cron_matches("0 9 * * 1-5", at("2026-11-08 09:00"))  # Sunday
    nxt = jobs.next_fire({"cron": "0 9 * * 1"}, at("2026-11-10 12:00"))
    assert jobs.stamp(nxt) == "2026-11-16 09:00"

def test_day_fields_are_or_when_both_are_restricted():
    # 2026-12-01 is a Tuesday and the 1st; 2026-11-16 is a Monday and not the 1st.
    assert jobs.cron_matches("0 9 1 * 1", at("2026-12-01 09:00"))
    assert jobs.cron_matches("0 9 1 * 1", at("2026-11-16 09:00"))
    assert not jobs.cron_matches("0 9 1 * 1", at("2026-11-17 09:00"))
    # Only the day-of-week is restricted, so it stays AND: Mondays only.
    assert jobs.cron_matches("0 9 * * 1", at("2026-11-16 09:00"))
    assert not jobs.cron_matches("0 9 * * 1", at("2026-12-01 09:00"))
    # cronie treats a leading `*` as a star, so `*/1` is unrestricted and the two fields stay AND.
    assert jobs.cron_matches("0 9 */1 * 1", at("2026-11-16 09:00"))
    assert not jobs.cron_matches("0 9 */1 * 1", at("2026-11-17 09:00"))
    assert jobs.cron_matches("0 9 1 * */1", at("2026-12-01 09:00"))
    assert not jobs.cron_matches("0 9 1 * */1", at("2026-11-17 09:00"))


def test_bad_input_is_an_error():
    result = runner.invoke(inbox.cli, ["schedule", "add", "Bad", "--every", "1", "--kind", "prompt", "--action", "x"])
    assert result.exit_code != 0 and "job name" in result.output
    result = runner.invoke(inbox.cli, ["schedule", "add", "both", "--every", "1", "--cron", "* * * * *",
                                        "--kind", "prompt", "--action", "x"])
    assert result.exit_code != 0 and "exactly one" in result.output
    result = runner.invoke(inbox.cli, ["schedule", "add", "nope", "--every", "1", "--kind", "tool", "--action", "nope"])
    assert result.exit_code != 0


def test_show_roundtrips_the_tool_spec(clean_home):
    run("schedule", "add", "peek", "--cron", "*/5 * * * *", "--kind", "tool",
        "--action", '{"name": "teams_read", "args": {"target": "self", "limit": 5}}', "--owner", "wayne")
    spec = json.loads(run("schedule", "show", "peek"))
    assert spec["action"] == {"kind": "tool", "name": "teams_read", "args": {"target": "self", "limit": 5}}
    assert spec["owner"] == "wayne"
    assert yaml.safe_load((clean_home / "rules.yaml").read_text())["schedule"][0]["name"] == "peek"
