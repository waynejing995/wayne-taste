import base64
import importlib.util
import json
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock

import click
import pytest
from click.testing import CliRunner

SPEC = importlib.util.spec_from_file_location("trace_monitor", Path(__file__).with_name("trace-monitor.py"))
monitor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(monitor)


class FakeJudge:
    def __init__(self, *flags):
        self.flags = iter(flags)
        self.cases = []

    def judge(self, rubric, case):
        self.cases.append((rubric, case))
        return monitor.Verdict(next(self.flags), "与基于规则的 validate 结果矛盾，告诉报告人无需修改")


def test_calibration_reply_case():
    row = monitor.calibration_cases()[0]
    judge = FakeJudge(True)
    findings, count = monitor.confusing_replies([row], judge, {})
    case = judge.cases[0][1]
    assert row["question"] in case
    assert "u pravu si" in case and "Ne bih menjao opis" in case
    for value in ("host_os", "vf_num", "failed_log", "Only 'Windows' given; no Windows Server version stated"):
        assert value in case
    assert count == 1 and len(findings) == 1
    assert findings[0].key == "confusing_reply:00000000-0000-4000-8000-000000000004"
    assert "PROJ-1001" in findings[0].title
    assert findings[0].link == "https://trace.example.com/tasks/00000000-0000-4000-8000-000000000001"
    assert "> **Petrovic, Marko asked:**" not in case


def test_reply_case_ignores_volatile_truth_fields():
    row = monitor.calibration_cases()[0]
    later = json.loads(json.dumps(row))
    later["truths"][0]["jira_observed_at"] = "2026-11-05T16:38:11+08:00"
    later["truths"][0]["latest_run_before_reply"] = {
        "run_number": 7, "started_at": "2026-11-05T05:00:00+00:00",
        "status_now": "failed", "finished_at": "2026-11-05T06:00:00+00:00",
        "running_at_reply_time": True,
    }
    row["truths"][0]["jira_observed_at"] = "2026-11-05T05:25:37+00:00"
    row["truths"][0]["latest_run_before_reply"] = {
        "run_number": 7, "started_at": "2026-11-05T05:00:00+00:00",
        "status_now": "running", "finished_at": None, "running_at_reply_time": True,
    }
    case = monitor.reply_case(row)
    assert case == monitor.reply_case(later)
    assert '"jira_observed_at"' not in case and '"status_now"' not in case and '"finished_at"' not in case
    assert "running_at_reply_time" in case


def test_every_reply_judged_including_serbian_correct():
    row = monitor.calibration_cases()[1]
    rows = [{**row, "id": str(i)} for i in range(3)]
    judge = FakeJudge(False, False, False)
    findings, count = monitor.confusing_replies(rows, judge, {})
    assert findings == [] and count == 3 and len(judge.cases) == 3
    assert all(row["answer"] in case for _, case in judge.cases)


def test_short_misleading_reply():
    row = monitor.calibration_cases()[2]
    judge = FakeJudge(True)
    findings, _ = monitor.confusing_replies([row], judge, {})
    assert len(findings) == 1
    assert "Looks fine, no action needed." in judge.cases[0][1]
    assert all(field in judge.cases[0][1] for field in ("host_os", "vf_num", "failed_log"))


def failure(run_id, status, verdict=None, likelihood=None, error=None):
    return {"run_id": run_id, "task_id": "00000000-0000-4000-8000-000000000003", "ticket_id": "PROJ-1004",
            "run_number": 6, "run_status": status, "failure_kind": None, "started_at": "2026-10-29T13:25:05+00:00",
            "error": "failed", "review_verdict": verdict, "review_category": None,
            "defect_likelihood": likelihood, "review_reason": None, "review_error": error}


def test_failure_selection_and_grouping():
    rows = [failure("1", "blocked", "blocked", 0.72), failure("2", "failed"),
            failure("3", "blocked", "failed", 0), failure("4", "blocked"),
            failure("5", "blocked", "error", 0, "same first line\none"),
            failure("6", "blocked", "error", 0, "same first line\ntwo")]
    assert [monitor.keep_failure(row) for row in rows] == [True, True, False, False, False, False]
    judge = FakeJudge(False, False, False)
    findings, kept = monitor.trace_failures(rows, judge, {})
    assert kept == 2 and len(findings) == 3
    assert {f.key for f in findings} == {"trace_failure:run:1", "trace_failure:run:2",
                                          "trace_failure:review_error:" + monitor.sha("same first line")}
    assert "×2" in findings[-1].title


def silent_row(text, *, days=8, kind="personal", answered=False):
    asked = datetime(2026, 11, 5, tzinfo=timezone.utc) - timedelta(days=days)
    return {"conversation_id": "abc", "conversation_type": kind, "user_name": "Saye Sashank",
            "asked_at": asked.isoformat(), "question": "What is my next step?", "answered": answered,
            "captain_after": [{"at": asked.isoformat(), "text": text}]}


def test_silent_services():
    now = datetime(2026, 11, 5, tzinfo=timezone.utc)
    ping = "\u23f3 Working on that \u2014 I'll post the answer here in a moment."
    notice = "\u26a0\ufe0f PROJ-1003 is blocked / needs attention."
    for text in (ping, notice):
        findings = monitor.silent_services([silent_row(text)], now)
        assert len(findings) == 1
        assert findings[0].title == "Saye Sashank" and "What is my next step?" in findings[0].reason
    rejected = "\u274c NABU rejected that key. Check it and try again."
    assert monitor.silent_services([silent_row(rejected)], now) == []
    assert monitor.silent_services([silent_row(ping, answered=True)], now) == []
    assert monitor.silent_services([silent_row(ping, kind="groupChat")], now) == []
    assert monitor.silent_services([silent_row(ping, days=6)], now) == []


def test_attention_positive_and_negative():
    row = {"task_id": "00000000-0000-4000-8000-000000000003", "ticket_id": "PROJ-1004",
           "entered_at": "2026-10-29T14:12:32+00:00", "status_detail": "already_fixed_unverified",
           "notice": None, "jira_comment": "please retry", "dashboard_reason": "cannot confirm", "validate": None,
           "jira_status_now": "Closed"}
    judge = FakeJudge(True, False)
    assert len(monitor.confusing_attention([row], judge, {})) == 1
    assert monitor.confusing_attention([row], judge, {}) == []
    assert "please retry" in judge.cases[0][1] and "cannot confirm" in judge.cases[0][1]


def configure_main(monkeypatch, tmp_path, rows):
    monkeypatch.setattr(monitor, "VERDICTS", tmp_path / "trace-monitor.verdicts.json")
    monkeypatch.setattr(monitor, "POSTED", tmp_path / "trace-monitor.posted.json")
    monkeypatch.setattr(monitor, "query_json", lambda sql, since, until: rows.get(sql, []))
    judge = FakeJudge(True, True, True)
    monkeypatch.setattr(monitor, "MagpieJudge", lambda *args: judge)
    run = Mock(return_value=subprocess.CompletedProcess([], 0))
    monkeypatch.setattr(monitor.subprocess, "run", run)
    return run


def test_dedup_and_no_post(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    run = configure_main(monkeypatch, tmp_path, {monitor.REPLY_SQL: [row]})
    monitor.POSTED.write_text(json.dumps(["confusing_reply:" + row["id"]]))
    result = CliRunner().invoke(monitor.main, ["--post"])
    assert result.exit_code == 0, result.output
    assert result.stdout.strip() == "no new findings"
    run.assert_not_called()


def send_jsonl(message, *, error=None, receipt=None):
    start = {"type": "tool_execution_start", "toolCallId": "call-1", "toolName": "teams_send",
             "args": {"target": "self", "message": message}}
    end = {"type": "tool_execution_end", "toolCallId": "call-1", "toolName": "teams_send",
           "result": {"content": [{"type": "text", "text": receipt or "Sent to self-chat (48:notes)."}]}}
    if error:
        end["isError"] = True
        end["result"]["content"][0]["text"] = error
    return subprocess.CompletedProcess([], 0, stdout="noise\n" + "\n".join(json.dumps(event) for event in (start, end)))


def test_post_once_and_persist_after_success(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    rows = [{**row, "id": f"answer-{i}"} for i in range(2)]
    run = configure_main(monkeypatch, tmp_path, {monitor.REPLY_SQL: rows})
    run.side_effect = lambda command, **kwargs: send_jsonl(command[-1].split("\n\n", 1)[1].strip())
    result = CliRunner().invoke(monitor.main, ["--post", "--target", "self"])
    assert result.exit_code == 0, result.output
    run.assert_called_once()
    command = run.call_args.args[0]
    assert command[:9] == ["omp", "-p", "--mode", "json", "--no-session", "--no-title", "--max-time", "10m", "--tools"]
    assert command[9] == "teams_send" and "`target: self`" in command[10]
    assert "[Captain \u56de\u590d \u00d72]" in command[10]
    assert json.loads(monitor.POSTED.read_text()) == ["confusing_reply:answer-0", "confusing_reply:answer-1"]


def test_digest_merges_findings_for_one_task():
    now = datetime(2026, 11, 5, 17, 24, tzinfo=monitor.TZ)
    task = "00000000-0000-4000-8000-000000000001"
    url = f"https://trace.example.com/tasks/{task}"
    replies = [monitor.Finding(f"confusing_reply:{i}", "Captain \u56de\u590d", "PROJ-1001", url, f"reason {i}", task, "PROJ-1001") for i in range(3)]
    attention = monitor.Finding("confusing_attention:1", "needs_attention", "PROJ-1001", url, "attention reason", task, "PROJ-1001")
    runs = [monitor.Finding(f"trace_failure:run:{n}", "TRACE \u5931\u8d25", f"PROJ-1002 #{n}", "https://trace.example.com/tasks/00000000-0000-4000-8000-000000000002", f"run {n}", "00000000-0000-4000-8000-000000000002", "PROJ-1002") for n in (16, 17)]
    lone = monitor.Finding("silent_service:abc", "7 \u5929\u672a\u56de\u590d", "Saye Sashank", None, "asked", None, None)
    digest = monitor.render_digest([*replies, attention, *runs, lone], now, 3, 2, 2, 1, 1)
    lines = digest.splitlines()
    assert lines[0] == "TRACE monitor 11-05 17:24 \u00b7 7 new"
    assert lines[1] == f"- PROJ-1001 {url} \u2014 [Captain \u56de\u590d \u00d73] reason 0 \uff5c [needs_attention] attention reason"
    assert lines[2] == "- PROJ-1002 https://trace.example.com/tasks/00000000-0000-4000-8000-000000000002 \u2014 [TRACE \u5931\u8d25 #16 #17] run 16"
    assert lines[3] == "- [7 \u5929\u672a\u56de\u590d] Saye Sashank \u2014 asked"
    single = monitor.render_digest([replies[0]], now, 1, 0, 0, 0, 0)
    assert single.splitlines()[1] == f"- [Captain \u56de\u590d] PROJ-1001 {url} \u2014 reason 0"


def test_unconfirmed_send_does_not_advance(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    outputs = [
        subprocess.CompletedProcess([], 0, stdout='{"type":"tool_execution_end","toolName":"read"}\n'),
        send_jsonl("digest", error="Graph 403"),
        send_jsonl("not the digest"),
    ]
    for output in outputs:
        run = configure_main(monkeypatch, tmp_path, {monitor.REPLY_SQL: [row]})
        run.return_value = output
        result = CliRunner().invoke(monitor.main, ["--post", "--target", "self"])
        assert result.exit_code != 0, output.stdout
        assert not monitor.POSTED.exists()


def test_dry_run_never_posts_or_writes_posted(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    run = configure_main(monkeypatch, tmp_path, {monitor.REPLY_SQL: [row]})
    result = CliRunner().invoke(monitor.main, [])
    assert result.exit_code == 0, result.output
    assert "TRACE monitor" in result.output and "PROJ-1001" in result.output
    run.assert_not_called()
    assert not monitor.POSTED.exists() and monitor.VERDICTS.exists()


def test_failed_post_does_not_advance(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    run = configure_main(monkeypatch, tmp_path, {monitor.REPLY_SQL: [row]})
    run.side_effect = subprocess.CalledProcessError(1, "omp")
    result = CliRunner().invoke(monitor.main, ["--post"])
    assert result.exit_code != 0 and not monitor.POSTED.exists()


def test_verdict_parsing_fenced_and_validation():
    assert monitor.parse_verdict('```json\n{"flag": true, "reason": "  错误  字段  "}\n```') == monitor.Verdict(True, "错误 字段")
    assert len(monitor.parse_verdict(json.dumps({"flag": True, "reason": "a" * 150})).reason) == 120
    for raw in ('{"flag": "true", "reason": "x"}', '{"flag": false, "reason": " "}', 'garbage'):
        with pytest.raises(ValueError):
            monitor.parse_verdict(raw)


def test_judge_retries_garbage(monkeypatch):
    response = Mock()
    response.json.return_value = {"choices": [{"message": {"content": "garbage"}}]}
    post = Mock(return_value=response)
    monkeypatch.setattr(monitor.httpx, "post", post)
    with pytest.raises(click.ClickException, match="invalid output after retry"):
        monitor.MagpieJudge("http://localhost/v1", "model").judge("rubric", "case")
    assert post.call_count == 2


def test_cache_reuses_verdict():
    row = monitor.calibration_cases()[0]
    judge = FakeJudge(True)
    cache = {}
    first, _ = monitor.confusing_replies([row], judge, cache)
    second, _ = monitor.confusing_replies([row], judge, cache)
    assert first == second and len(judge.cases) == 1
    assert next(iter(cache)).startswith(first[0].key + ":")


def test_query_decodes_exact_single_payload(monkeypatch):
    encoded = base64.b64encode(b'[{"id": 1}]').decode()
    monkeypatch.setattr(monitor, "prod", lambda cmd: f"BEGIN\n{encoded}\nROLLBACK\n")
    now = datetime.now(timezone.utc)
    assert monitor.query_json("select null where :S < :U", now, now) == [{"id": 1}]
    monkeypatch.setattr(monitor, "prod", lambda cmd: f"BEGIN\n{encoded}\n{encoded}\nROLLBACK\n")
    with pytest.raises(click.ClickException, match="unexpected prod query output"):
        monitor.query_json("select null where :S < :U", now, now)
