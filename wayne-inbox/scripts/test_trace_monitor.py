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

LINKS = monitor.Links("https://trace.example.com", "https://jira.example.com")
GROUP = "19:test@thread.v2"
ENV = {"TRACE_MONITOR_PROD_CMD": "prod-runner", "TRACE_MONITOR_TRACE_URL": LINKS.trace,
       "TRACE_MONITOR_JIRA_URL": LINKS.jira, "TRACE_MONITOR_GROUP_CHAT": GROUP}


def set_env(monkeypatch, **extra):
    for key, value in {**ENV, **extra}.items():
        monkeypatch.setenv(key, value)


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
    findings, count = monitor.confusing_replies([row], judge, {}, LINKS)
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
    findings, count = monitor.confusing_replies(rows, judge, {}, LINKS)
    assert findings == [] and count == 3 and len(judge.cases) == 3
    assert all(row["answer"] in case for _, case in judge.cases)


def test_short_misleading_reply():
    row = monitor.calibration_cases()[2]
    judge = FakeJudge(True)
    findings, _ = monitor.confusing_replies([row], judge, {}, LINKS)
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
    findings, kept = monitor.trace_failures(rows, judge, {}, LINKS)
    assert kept == 2 and len(findings) == 3
    assert {f.key for f in findings} == {"trace_failure:run:1", "trace_failure:run:2",
                                          "trace_failure:review_error:" + monitor.sha("same first line")}
    assert "×2" in findings[-1].title


def silent_row(text, *, days=8, kind="personal", answered=False):
    asked = datetime(2026, 11, 5, tzinfo=timezone.utc) - timedelta(days=days)
    return {"conversation_id": "abc", "conversation_type": kind, "user_name": "Alex Example",
            "asked_at": asked.isoformat(), "question": "What is my next step?", "answered": answered,
            "captain_after": [{"at": asked.isoformat(), "text": text}]}


def test_silent_services():
    now = datetime(2026, 11, 5, tzinfo=timezone.utc)
    ping = "\u23f3 Working on that \u2014 I'll post the answer here in a moment."
    notice = "\u26a0\ufe0f PROJ-1003 is blocked / needs attention."
    for text in (ping, notice):
        findings = monitor.silent_services([silent_row(text)], now)
        assert len(findings) == 1
        assert findings[0].title == "Alex Example" and "What is my next step?" in findings[0].reason
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
    assert len(monitor.confusing_attention([row], judge, {}, LINKS)) == 1
    assert monitor.confusing_attention([row], judge, {}, LINKS) == []
    assert "please retry" in judge.cases[0][1] and "cannot confirm" in judge.cases[0][1]


def configure_main(monkeypatch, tmp_path, rows):
    monkeypatch.setattr(monitor, "VERDICTS", tmp_path / "trace-monitor.verdicts.json")
    monkeypatch.setattr(monitor, "POSTED", tmp_path / "trace-monitor.posted.json")
    monkeypatch.setattr(monitor, "query_json", lambda sql, since, until, runner: rows.get(sql, []))
    set_env(monkeypatch)
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
    lone = monitor.Finding("silent_service:abc", "7 \u5929\u672a\u56de\u590d", "Alex Example", None, "asked", None, None)
    digest = monitor.render_digest([*replies, attention, *runs, lone], now, 3, 2, 2, 1, 1)
    lines = digest.splitlines()
    assert lines[0] == "TRACE monitor 11-05 17:24 \u00b7 7 new"
    assert lines[1] == f"- PROJ-1001 {url} \u2014 [Captain \u56de\u590d \u00d73] reason 0 \uff5c [needs_attention] attention reason"
    assert lines[2] == "- PROJ-1002 https://trace.example.com/tasks/00000000-0000-4000-8000-000000000002 \u2014 [TRACE \u5931\u8d25 #16 #17] run 16"
    assert lines[3] == "- [7 \u5929\u672a\u56de\u590d] Alex Example \u2014 asked"
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
    first, _ = monitor.confusing_replies([row], judge, cache, LINKS)
    second, _ = monitor.confusing_replies([row], judge, cache, LINKS)
    assert first == second and len(judge.cases) == 1
    assert next(iter(cache)).startswith(first[0].key + ":")


def test_query_decodes_exact_single_payload(monkeypatch):
    encoded = base64.b64encode(b'[{"id": 1}]').decode()
    monkeypatch.setattr(monitor, "prod", lambda runner, cmd: f"BEGIN\n{encoded}\nROLLBACK\n")
    now = datetime.now(timezone.utc)
    assert monitor.query_json("select null where :S < :U", now, now, "prod-runner") == [{"id": 1}]
    monkeypatch.setattr(monitor, "prod", lambda runner, cmd: f"BEGIN\n{encoded}\n{encoded}\nROLLBACK\n")
    with pytest.raises(click.ClickException, match="unexpected prod query output"):
        monitor.query_json("select null where :S < :U", now, now, "prod-runner")


@pytest.mark.parametrize("rule", ["S1", "S13", "uncovered"])
def test_parse_plan_uncovered_drops_model_steps(rule):
    raw = json.dumps({"rule": rule, "steps": [{"step": "重跑", "approval": False}]})
    assert monitor.parse_plan(raw) == monitor.Plan(rule, ())


def test_parse_plan_normalizes_steps_and_forces_approval():
    raw = json.dumps({"rule": "R2", "steps": [
        {"step": "  只读  检查\n日志  ", "approval": False},
        {"step": "重跑任务", "approval": False},
        {"step": "Jira requeue", "approval": False},
    ]}, ensure_ascii=False)
    assert monitor.parse_plan(f"```json\n{raw}\n```") == monitor.Plan(
        "R2", (("只读 检查 日志", False), ("重跑任务", True), ("Jira requeue", True)))
    long_step = monitor.parse_plan(json.dumps({"rule": "R1", "steps": [{"step": "a" * 100, "approval": False}]}))
    assert long_step.steps[0][0] == "a" * 79 + "\u2026"
    raw = json.dumps({"rule": "R1", "steps": [{"step": "a" * 80 + " 重跑", "approval": False}]})
    assert monitor.parse_plan(raw).steps == (("a" * 79 + "\u2026", True),)


@pytest.mark.parametrize("action", ["rerun", "re-run", "retry", "requeue", "Jira", "comment", "message", "notify",
                                    "deploy", "PR", "重跑", "重试", "入队", "评论", "消息", "通知", "部署", "@"])
def test_parse_plan_forces_approval_for_each_action(action):
    raw = json.dumps({"rule": "R1", "steps": [{"step": action, "approval": False}]}, ensure_ascii=False)
    assert monitor.parse_plan(raw).steps == ((action, True),)


@pytest.mark.parametrize("step", ["只读查 prod 日志", "检查 problem 原因", "approve 前先看 PRD"])
def test_parse_plan_keeps_read_only_steps_unapproved(step):
    raw = json.dumps({"rule": "R1", "steps": [{"step": step, "approval": False}]}, ensure_ascii=False)
    assert monitor.parse_plan(raw).steps == ((step, False),)


@pytest.mark.parametrize("rule", ["R6", "S14", ""])
def test_parse_plan_rejects_invalid_rule(rule):
    with pytest.raises(ValueError, match="not allowed"):
        monitor.parse_plan(json.dumps({"rule": rule, "steps": []}))


@pytest.mark.parametrize("steps, cause", [([], "1–3 steps"), ([{"step": "read", "approval": False}] * 4, "1–3 steps"),
                                          ([{"step": "  ", "approval": False}], "empty plan step"),
                                          ([{"step": "read", "approval": "false"}], "invalid step fields")])
def test_parse_plan_rejects_invalid_r_steps(steps, cause):
    with pytest.raises(ValueError, match=cause):
        monitor.parse_plan(json.dumps({"rule": "R1", "steps": steps}))


def test_task_model_reads_magpie_role_and_effort(monkeypatch):
    run = Mock(return_value=subprocess.CompletedProcess([], 0, stdout=json.dumps(
        {"value": {"task": "magpie/group/small-model:xhigh"}})))
    monkeypatch.setattr(monitor.subprocess, "run", run)
    assert monitor.task_model() == ("group/small-model", "xhigh")
    run.assert_called_once_with(["omp", "config", "get", "modelRoles", "--json"],
                                check=True, capture_output=True, text=True, timeout=30)
    run.return_value.stdout = json.dumps({"value": {"task": "magpie/example"}})
    assert monitor.task_model() == ("example", None)
    run.return_value.stdout = json.dumps({"value": {"task": "other-provider/model"}})
    with pytest.raises(click.ClickException, match="other-provider/model"):
        monitor.task_model()


@pytest.mark.parametrize("failure", [OSError("missing omp"), subprocess.CalledProcessError(7, "omp"),
                                     subprocess.TimeoutExpired("omp", 30)])
def test_task_model_reports_command_errors(monkeypatch, failure):
    monkeypatch.setattr(monitor.subprocess, "run", Mock(side_effect=failure))
    with pytest.raises(click.ClickException) as error:
        monitor.task_model()
    assert type(failure).__name__ in error.value.message and str(failure) in error.value.message


@pytest.mark.parametrize("raw, cause", [("bad JSON", "JSONDecodeError"), ("{}", "KeyError: 'value'"),
                                        ('{"value": {"task": null}}', "ValueError: task model None")])
def test_task_model_reports_invalid_config(monkeypatch, raw, cause):
    monkeypatch.setattr(monitor.subprocess, "run", Mock(return_value=subprocess.CompletedProcess([], 0, stdout=raw)))
    with pytest.raises(click.ClickException) as error:
        monitor.task_model()
    assert error.value.message.startswith("task model failed: ") and cause in error.value.message


def test_plan_reports_invalid_output_once_and_sends_effort(monkeypatch):
    response = Mock()
    response.json.return_value = {"choices": [{"message": {"content": "garbage"}}]}
    post = Mock(return_value=response)
    monkeypatch.setattr(monitor.httpx, "post", post)
    with pytest.raises(click.ClickException, match="plan output invalid: ValueError: no JSON object"):
        monitor.MagpieJudge("http://localhost/v1", "model", "xhigh").plan("system", "case")
    post.assert_called_once()
    request = post.call_args.kwargs
    assert request["timeout"] == 300 and request["json"]["max_tokens"] == 8000
    assert request["json"]["temperature"] == 0 and request["json"]["reasoning_effort"] == "xhigh"
    response.json.return_value = {"choices": [{"message": {"content": '{"rule":"S12","steps":[]}'}}]}
    assert monitor.MagpieJudge("http://localhost/v1", "model").plan("system", "case").rule == "S12"
    assert "reasoning_effort" not in post.call_args.kwargs["json"]


def test_plan_reports_transport_cause_without_retry(monkeypatch):
    post = Mock(side_effect=monitor.httpx.ConnectError("boom"))
    monkeypatch.setattr(monitor.httpx, "post", post)
    with pytest.raises(click.ClickException, match="plan transport failed: ConnectError: boom"):
        monitor.MagpieJudge("http://localhost/v1", "model").plan("system", "case")
    post.assert_called_once()


def test_finding_evidence_preserves_judged_cases():
    reply = monitor.calibration_cases()[0]
    judge = FakeJudge(True)
    findings, _ = monitor.confusing_replies([reply], judge, {}, LINKS)
    assert findings[0].evidence == judge.cases[0][1] == monitor.reply_case(reply)
    rows = [failure("1", "failed"), failure("2", "blocked", "error", 0, "image missing")]
    judge = FakeJudge(True, True)
    findings, _ = monitor.trace_failures(rows, judge, {}, LINKS)
    assert findings[0].evidence == judge.cases[0][1]
    assert findings[1].evidence.startswith(judge.cases[1][1] + "\n")
    assert "PROJ-1004 #6 blocked None" in findings[1].evidence
    row = silent_row("⏳ working")
    row["question"] = "Q" * 100
    evidence = monitor.silent_services([row], datetime(2026, 11, 5, tzinfo=timezone.utc))[0].evidence
    assert row["user_name"] in evidence and row["asked_at"] in evidence and row["question"] in evidence
    attention = {"task_id": "task", "ticket_id": "SWDEV-1", "status_detail": "problem"}
    judge = FakeJudge(True)
    assert monitor.confusing_attention([attention], judge, {}, LINKS)[0].evidence == judge.cases[0][1]


def test_plan_findings_isolates_errors_preserves_order_and_inputs():
    findings = [monitor.Finding(str(i), "tag", f"title {i}", "link", "reason", evidence=f"evidence {i}")
                for i in range(3)]
    calls = []

    class Planner:
        def plan(self, system, case):
            calls.append((system, case))
            if "title 1" in case:
                raise click.ClickException("plan transport failed: ConnectError: boom")
            return monitor.Plan("R3", (("检查", False),))

    warnings = []
    sink = monitor.logger.add(lambda message: warnings.append(str(message)), level="WARNING")
    try:
        plans = monitor.plan_findings(findings, Planner(), "rules")
    finally:
        monitor.logger.remove(sink)
    assert len(warnings) == 1 and "preprocess plan failed for 1: plan transport failed: ConnectError: boom" in warnings[0]
    assert plans == [monitor.Plan("R3", (("检查", False),)),
                     "plan transport failed: ConnectError: boom", monitor.Plan("R3", (("检查", False),))]
    assert len(calls) == 3
    assert all(system == "rules" for system, _ in calls)
    assert all(any(value in case for _, case in calls) for value in ("tag", "link", "reason", "evidence 2"))

    class BadPlanner:
        def plan(self, system, case):
            raise RuntimeError("unexpected")

    with pytest.raises(RuntimeError, match="unexpected"):
        monitor.plan_findings(findings, BadPlanner(), "rules")


def test_render_digest_keeps_each_distinct_proposal_in_a_group():
    now = datetime(2026, 11, 5, 17, 24, tzinfo=monitor.TZ)
    findings = [monitor.Finding(key, tag, title, "https://trace/task", "reason", "task", "SWDEV-1")
                for key, tag, title in (("a", "one", "SWDEV-1 #1"), ("b", "two", "SWDEV-1"), ("c", "one", "SWDEV-1 #2"),
                                        ("d", "one", "SWDEV-1 #3"), ("e", "three", "SWDEV-1"), ("f", "four", "SWDEV-1"))]
    plans = [monitor.Plan("R2", (("合并 run 1", False),)), monitor.Plan("S1", ()),
             monitor.Plan("R2", (("合并 run 1", False),)), monitor.Plan("R2", (("重跑 run 3", True),)),
             "plan transport failed: ConnectError: boom", "plan output invalid: ValueError: rule 'R6' not allowed"]
    lines = monitor.render_digest(findings, now, 3, 0, 0, 0, 0, plans).splitlines()
    assert lines[0] == "以下「建议」是模型按处理规则草稿生成的预处理方案，仅供参考，没有执行任何操作。"
    assert lines[3] == "  - [one #1, one #2] 建议 [R2] ×2: 1) 合并 run 1"
    assert lines[4] == "  - [two] 建议 [S1]: no handling record; needs investigation（无处理记录，需调查）"
    assert lines[5] == "  - [one #3] 建议 [R2]: 1) 重跑 run 3（需批准）"
    assert lines[6] == "  - [three] 建议: 方案生成失败（plan transport failed: ConnectError: boom）"
    assert lines[7] == "  - [four] 建议: 方案生成失败（plan output invalid: ValueError: rule 'R6' not allowed）"
    assert len(lines) == 9 and lines[-1].startswith("judged:")


def test_render_labels_same_tag_findings_apart():
    now = datetime(2026, 11, 5, tzinfo=timezone.utc)
    findings = [monitor.Finding(key, "Captain 回复", "SWDEV-1", "https://trace/task", "reason", "task", "SWDEV-1")
                for key in ("a", "b", "c")]
    plans = [monitor.Plan("R4", (("RCA a", False),)), monitor.Plan("R4", (("RCA b", False),)),
             monitor.Plan("R4", (("RCA a", False),))]
    lines = monitor.render_digest(findings, now, 3, 0, 0, 0, 0, plans).splitlines()
    assert lines[3:5] == ["  - [Captain 回复 1, Captain 回复 3] 建议 [R4] ×2: 1) RCA a",
                          "  - [Captain 回复 2] 建议 [R4]: 1) RCA b"]


def test_render_uncovered_and_failed_proposals():
    now = datetime(2026, 11, 5, tzinfo=timezone.utc)
    findings = [monitor.Finding("a", "one", "A", None, "reason"),
                monitor.Finding("b", "two", "B", None, "reason")]
    digest = monitor.render_digest(findings, now, 0, 0, 0, 0, 0,
                                   [monitor.Plan("uncovered", ()), "ConnectError: boom"])
    assert "建议 [uncovered]: no handling record; needs investigation（无处理记录，需调查）" in digest
    assert "建议: 方案生成失败（ConnectError: boom）" in digest


def configure_preprocess(monkeypatch, tmp_path, rows):
    run = configure_main(monkeypatch, tmp_path, rows)
    judge = monitor.MagpieJudge("unused", "unused")
    rules = tmp_path / "rules.md"
    rules.write_text("RULES TEXT\n## 回放：答案\nREPLAY SECRET\n")
    monkeypatch.setenv("TRACE_MONITOR_RULES", str(rules))
    monkeypatch.setattr(monitor, "task_model", lambda: ("task-model", "xhigh"))
    calls = []

    class Planner:
        def plan(self, system, case):
            calls.append((system, case))
            if "SWDEV-FAIL" in case:
                raise click.ClickException("plan transport failed: ConnectError: boom")
            return monitor.Plan("R3", (("只读检查", False),))

    planner = Planner()
    monkeypatch.setattr(monitor, "MagpieJudge", lambda *args: planner if args[1] == "task-model" else judge)
    return run, calls


def test_main_preprocess_isolates_failure_and_excludes_replay(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    other = {**row, "id": "other", "truths": [{**row["truths"][0], "ticket_id": "SWDEV-FAIL", "task_id": "other"}]}
    run, calls = configure_preprocess(monkeypatch, tmp_path, {monitor.REPLY_SQL: [row, other]})
    result = CliRunner().invoke(monitor.main, ["--preprocess"])
    assert result.exit_code == 0, result.output
    assert result.stdout.splitlines()[0] == "以下「建议」是模型按处理规则草稿生成的预处理方案，仅供参考，没有执行任何操作。"
    assert "PROJ-1001" in result.stdout and "SWDEV-FAIL" in result.stdout
    assert "[R3]" in result.stdout and "方案生成失败" in result.stdout and "ConnectError: boom" in result.stdout
    assert len(calls) == 2 and all("RULES TEXT" in system and "REPLAY SECRET" not in system
                                   and "## 回放" not in system for system, _ in calls)
    run.assert_not_called()


def test_preprocess_envvar_enables_planning(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    run, calls = configure_preprocess(monkeypatch, tmp_path, {monitor.REPLY_SQL: [row]})
    result = CliRunner().invoke(monitor.main, [], env={"TRACE_MONITOR_PREPROCESS": "1"})
    assert result.exit_code == 0, result.output
    assert result.stdout.startswith("以下「建议」") and len(calls) == 1
    run.assert_not_called()


def test_main_preprocess_missing_rules_fails_before_prod_query(monkeypatch, tmp_path):
    missing = tmp_path / "missing-rules.md"
    query = Mock(side_effect=AssertionError("prod queried"))
    set_env(monkeypatch, TRACE_MONITOR_RULES=str(missing))
    monkeypatch.setattr(monitor, "query_json", query)
    monkeypatch.setattr(monitor, "task_model", lambda: ("task-model", None))
    result = CliRunner().invoke(monitor.main, ["--preprocess"])
    assert result.exit_code != 0 and str(missing) in result.output
    query.assert_not_called()


def test_main_without_preprocess_never_loads_rules_or_task_model(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    run = configure_main(monkeypatch, tmp_path, {monitor.REPLY_SQL: [row]})
    monkeypatch.setenv("TRACE_MONITOR_RULES", str(tmp_path / "missing-rules.md"))
    task = Mock(side_effect=AssertionError("task model called"))
    monkeypatch.setattr(monitor, "task_model", task)
    result = CliRunner().invoke(monitor.main, [])
    assert result.exit_code == 0, result.output
    assert result.stdout.startswith("TRACE monitor") and "建议" not in result.stdout
    task.assert_not_called()
    run.assert_not_called()


def test_preprocess_post_advances_only_after_verified_send(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    run, calls = configure_preprocess(monkeypatch, tmp_path, {monitor.REPLY_SQL: [row]})
    fixed = datetime(2026, 11, 5, 17, 24, tzinfo=monitor.TZ)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed

    monkeypatch.setattr(monitor, "datetime", FrozenDateTime)
    sent = []

    def fake_send(command, **kwargs):
        assert not monitor.POSTED.exists()
        message = command[-1].split("\n\n", 1)[1].strip()
        sent.append(message)
        return send_jsonl(message, error="Graph 403" if len(sent) == 1 else None)

    run.side_effect = fake_send
    result = CliRunner().invoke(monitor.main, ["--post", "--preprocess", "--target", "self"])
    assert result.exit_code != 0 and not monitor.POSTED.exists()
    result = CliRunner().invoke(monitor.main, ["--post", "--preprocess", "--target", "self"])
    assert result.exit_code == 0, result.output
    findings, judged = monitor.confusing_replies([row], FakeJudge(True), {}, LINKS)
    expected = monitor.render_digest(findings, fixed, judged, 0, 0, 0, 0,
                                     [monitor.Plan("R3", (("只读检查", False),))])
    assert sent == [expected, expected] and expected.startswith("以下「建议」")
    assert json.loads(monitor.POSTED.read_text()) == ["confusing_reply:" + row["id"]]
    assert len(calls) == 2


@pytest.mark.parametrize("unset, args, message", [
    ("TRACE_MONITOR_PROD_CMD", [], "--prod-cmd"),
    ("TRACE_MONITOR_TRACE_URL", [], "--trace-url"),
    ("TRACE_MONITOR_JIRA_URL", [], "--jira-url"),
    ("TRACE_MONITOR_GROUP_CHAT", ["--post"], "TRACE_MONITOR_GROUP_CHAT"),
    ("TRACE_MONITOR_RULES", ["--preprocess"], "TRACE_MONITOR_RULES"),
])
def test_missing_config_fails_before_prod_query(monkeypatch, tmp_path, unset, args, message):
    configure_main(monkeypatch, tmp_path, {})
    monkeypatch.delenv("TRACE_MONITOR_RULES", raising=False)
    monkeypatch.delenv(unset, raising=False)
    query = Mock(side_effect=AssertionError("prod queried"))
    monkeypatch.setattr(monitor, "query_json", query)
    result = CliRunner().invoke(monitor.main, args)
    assert result.exit_code == 2 and message in result.output
    query.assert_not_called()


def test_group_post_targets_configured_chat(monkeypatch, tmp_path):
    row = monitor.calibration_cases()[0]
    run = configure_main(monkeypatch, tmp_path, {monitor.REPLY_SQL: [row]})

    def send(command, **kwargs):
        message = command[-1].split("\n\n", 1)[1].strip()
        start = {"type": "tool_execution_start", "toolCallId": "c", "toolName": "teams_send",
                 "args": {"target": "chat", "chat_id": GROUP, "message": message}}
        end = {"type": "tool_execution_end", "toolCallId": "c", "toolName": "teams_send",
               "result": {"content": [{"type": "text", "text": f"Sent to chat {GROUP}."}]}}
        return subprocess.CompletedProcess([], 0, stdout="\n".join(json.dumps(e) for e in (start, end)))

    run.side_effect = send
    result = CliRunner().invoke(monitor.main, ["--post"])
    assert result.exit_code == 0, result.output
    assert f"`chat_id` `{GROUP}`" in run.call_args.args[0][-1]
    assert json.loads(monitor.POSTED.read_text()) == ["confusing_reply:" + row["id"]]


def test_prod_pipes_script_to_runner(monkeypatch):
    run = Mock(return_value=subprocess.CompletedProcess([], 0, stdout="out"))
    monkeypatch.setattr(monitor.subprocess, "run", run)
    assert monitor.prod("runner --flag 'a b'", "echo hi") == "out"
    assert run.call_args.args[0] == ["runner", "--flag", "a b"] and run.call_args.kwargs["input"] == "echo hi"
    run.return_value = subprocess.CompletedProcess([], 3, stderr="denied")
    with pytest.raises(click.ClickException, match="prod runner exited 3: denied"):
        monitor.prod("runner", "echo hi")
