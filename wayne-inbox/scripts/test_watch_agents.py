import base64
import gzip
import hashlib
import importlib.util
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from click.testing import CliRunner

SPEC = importlib.util.spec_from_file_location("watch_agents", Path(__file__).with_name("watch-agents.py"))
wa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(wa)

T0 = int(datetime(2026, 11, 6, 14, 0, tzinfo=timezone.utc).timestamp())
HHMM = datetime.fromtimestamp(T0).strftime("%H:%M")
SELF_RECEIPT = "Sent to self-chat (48:notes)."


def jsonl(*objs):
    return "\n".join(json.dumps(obj, separators=(",", ":"), ensure_ascii=False) for obj in objs)


def assistant(*items):
    return {"type": "message", "message": {"role": "assistant", "content": list(items), "stopReason": "stop"}}


def tool_turn():
    call = {"type": "toolCall", "name": "bash", "arguments": {"command": "ls"}}
    return {"type": "message", "message": {"role": "assistant", "content": [call], "stopReason": "toolUse"}}


def text_item(value):
    return {"type": "text", "text": value}


def todo_result(*tasks):
    """`tasks`: (content, status) pairs, all in one phase."""
    phase = {"name": "Wave 1", "tasks": [{"content": c, "status": s} for c, s in tasks]}
    return {"type": "message", "message": {"role": "toolResult", "toolName": "todo",
                                           "details": {"op": "update", "phases": [phase]}}}


def tail_of(value, kind):
    return {"kind": kind, "tail": base64.b64encode(gzip.compress(value.encode())).decode()}


def decode_tail(probe_result):
    return gzip.decompress(base64.b64decode(probe_result["tail"])).decode()


def test_latest_line_takes_newest_text_turn_and_skips_tool_turns():
    body = jsonl(
        assistant(text_item("older answer")),
        tool_turn(),
        {"type": "message", "message": {"role": "toolResult", "toolName": "bash", "content": []}},
        assistant(text_item("newest  answer\n  across lines")),
        tool_turn(),
    )
    assert wa.latest_line(body) == "newest answer across lines"


def test_latest_line_falls_back_to_last_text_when_tail_is_tool_calls_only():
    body = jsonl(assistant(text_item("the real status")), tool_turn(), tool_turn())
    assert wa.latest_line(body) == "the real status"


def test_latest_line_ignores_empty_text_items():
    body = jsonl(assistant(text_item("real")), assistant(text_item("")))
    assert wa.latest_line(body) == "real"


def test_latest_line_clips_long_text_to_300_chars_with_leading_ellipsis():
    result = wa.latest_line(jsonl(assistant(text_item("a" * 400 + " tail-marker"))))
    assert len(result) <= 300
    assert result.startswith("\u2026")
    assert result.endswith("tail-marker")


def test_latest_line_empty_session():
    assert wa.latest_line("") == "no text"


def test_latest_line_todo_suffix_counts_the_latest_todo_result():
    body = jsonl(
        todo_result(("Plan", "completed"), ("Build", "in_progress")),
        assistant(text_item("working")),
        todo_result(("Plan", "completed"), ("Build", "completed"), ("Wire probe", "in_progress"), ("Test", "pending")),
        assistant(text_item("wiring the probe")),
    )
    assert wa.latest_line(body) == "wiring the probe [todo 2/4, now: Wire probe]"


def test_latest_line_todo_without_in_progress_and_no_text():
    body = jsonl(todo_result(("Plan", "completed"), ("Ship", "pending")))
    assert wa.latest_line(body) == "no text [todo 1/2]"


def test_latest_line_skips_partial_first_line_of_a_cut():
    body = '"role":"assistant","content":[{"type":"text","te\n' + jsonl(assistant(text_item("ok")))
    assert wa.latest_line(body) == "ok"


def test_pane_line_last_non_empty_line_whitespace_collapsed():
    assert wa.pane_line("first\n  the   last   line  \n\n\n") == "the last line"


def test_pane_line_empty_or_blank_is_no_text():
    assert wa.pane_line("") == "no text"
    assert wa.pane_line("  \n\n ") == "no text"


def test_pane_line_clips_to_300_chars():
    result = wa.pane_line("y" * 400)
    assert len(result) <= 300 and result.startswith("\u2026")


OMP_TAIL = jsonl(assistant(text_item("older")), tool_turn(), assistant(text_item("tail latest answer")))


def live(tail, kind):
    def probe_live(now, want):
        p = {"alive": True, "agent": "omp", "state": "", "session": "/s.jsonl", "smtime": now, "waiting": False,
             "text": "pane-hash", "rmtime": 0, "rstatus": "", "now": now}
        if want:
            p.update(tail_of(tail, kind))
        return p
    return probe_live


omp_live = live(OMP_TAIL, "jsonl")
pane_live = live("older\nlast pane line\n\n", "pane")


def finished(now, want):
    p = omp_live(now, want)
    p.update(rmtime=now, rstatus="done")
    return p


def dead(now, want):
    return {"alive": False, "agent": "", "state": "", "session": "", "smtime": 0, "waiting": False,
            "text": "", "rmtime": 0, "rstatus": "", "now": now}


def broken(now, want):
    raise RuntimeError("ssh: connect refused")


def teams_stdout(command, *, receipt=SELF_RECEIPT, error=None, message=None):
    """The omp --mode json stream of one teams_send call; `message` defaults to the digest the prompt carries."""
    digest = message if message is not None else command[-1].split("\n\n", 1)[1].strip()
    start = {"type": "tool_execution_start", "toolCallId": "call-1", "toolName": "teams_send",
             "args": {"target": "self", "message": digest}}
    end = {"type": "tool_execution_end", "toolCallId": "call-1", "toolName": "teams_send",
           "result": {"content": [{"type": "text", "text": error or receipt}]}}
    if error:
        end["isError"] = True
    return subprocess.CompletedProcess(command, 0, stdout="noise\n" + "\n".join(json.dumps(e) for e in (start, end)))


def omp_exits(command):
    return subprocess.CompletedProcess(command, 1, stdout="", stderr="boom: no teams token")


def omp_missing(command):
    raise FileNotFoundError(2, "No such file or directory", "omp")


class Env:
    """Fake clock, probes and subprocess.run; every omp call and inbox call is recorded."""

    def __init__(self, monkeypatch, tmp_path):
        self.now = T0
        self.behaviour = {}
        self.probes = []
        self.calls = []
        self.omp = teams_stdout
        self.rules = tmp_path / "rules.yaml"
        self.state_file = tmp_path / "cursors" / "agent-watch.json"
        monkeypatch.setattr(wa, "RULES", self.rules)
        monkeypatch.setattr(wa, "STATE", self.state_file)
        monkeypatch.setattr(wa, "time", SimpleNamespace(time=lambda: self.now))
        monkeypatch.setattr(wa, "probe", self._probe)
        monkeypatch.setattr(wa.subprocess, "run", self._run)

    def watch(self, name, behaviour):
        self.behaviour[name] = behaviour
        rows = [{"name": n, "mux": "tern", "pane": "1", "host": "local", "result": ""} for n in self.behaviour]
        self.rules.write_text(json.dumps({"agent_watch": rows}))

    def _probe(self, a, want=False):
        self.probes.append((a["name"], want))
        return self.behaviour[a["name"]](self.now, want)

    def _run(self, command, **kwargs):
        self.calls.append(list(command))
        if command[0] == "omp":
            return self.omp(command)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    def main(self, *args):
        return CliRunner().invoke(wa.main, list(args))

    def sent(self):
        return [c[-1].split("\n\n", 1)[1].strip() for c in self.calls if c[0] == "omp"]

    def state(self):
        return json.loads(self.state_file.read_text())


@pytest.fixture
def env(monkeypatch, tmp_path):
    return Env(monkeypatch, tmp_path)


def test_first_run_sends_one_digest_and_records_its_time(env):
    env.watch("alpha", omp_live)
    result = env.main()
    assert result.exit_code == 0, result.output
    [digest] = env.sent()
    lines = digest.splitlines()
    assert lines[0] == f"agent progress {HHMM} \u00b7 1 running"
    assert lines[1] == f"- alpha \u00b7 local \u00b7 last activity {HHMM} \u00b7 tail latest answer"
    assert env.state()["_digest"]["at"] == T0


def test_run_two_minutes_later_sends_nothing(env):
    env.watch("alpha", omp_live)
    env.main()
    env.now = T0 + 120
    result = env.main()
    assert result.exit_code == 0, result.output
    assert len(env.sent()) == 1
    assert env.state()["_digest"]["at"] == T0


def test_next_digest_is_due_after_thirty_minutes(env):
    env.watch("alpha", omp_live)
    env.main()
    env.now = T0 + 30 * 60
    env.main()
    assert len(env.sent()) == 2
    assert env.state()["_digest"]["at"] == T0 + 30 * 60


def test_digest_min_zero_sends_right_after_a_digest(env):
    env.watch("alpha", omp_live)
    env.main()
    env.now = T0 + 120
    result = env.main("--digest-min", "0")
    assert result.exit_code == 0, result.output
    assert len(env.sent()) == 2


def test_one_probe_per_session_and_tail_asked_only_when_due(env):
    env.watch("alpha", omp_live)
    env.main()
    env.now = T0 + 120
    env.main()
    assert env.probes == [("alpha", True), ("alpha", False)]


def test_pane_session_line_uses_the_last_non_empty_pane_line(env):
    env.watch("beta", pane_live)
    env.main()
    [digest] = env.sent()
    assert digest.splitlines()[1] == f"- beta \u00b7 local \u00b7 last activity {HHMM} \u00b7 last pane line"


@pytest.mark.parametrize("behaviour", [dead, finished], ids=["all-dead", "finished-this-run"])
def test_nothing_running_sends_nothing(env, behaviour):
    env.watch("alpha", behaviour)
    result = env.main()
    assert result.exit_code == 0, result.output
    assert not any(c[0] == "omp" for c in env.calls)
    assert "_digest" not in env.state()


def test_no_sessions_watched_sends_nothing(env):
    result = env.main()
    assert result.exit_code == 0, result.output
    assert env.calls == []
    assert "_digest" not in env.state()


def test_finished_session_is_left_out_of_the_digest(env):
    env.watch("alpha", finished)
    env.watch("beta", omp_live)
    env.main()
    [digest] = env.sent()
    assert "- alpha" not in digest
    assert digest.splitlines()[1].startswith("- beta \u00b7 local \u00b7 last activity ")


def test_digest_never_calls_inbox(env):
    env.watch("alpha", omp_live)
    env.main()
    assert [c[0] for c in env.calls] == ["omp"]
    assert not any("inbox.py" in part for c in env.calls for part in c)


def test_failed_first_send_records_no_digest_time(env):
    env.omp = omp_exits
    env.watch("alpha", omp_live)
    result = env.main()
    assert result.exit_code == 1
    assert "boom: no teams token" in result.output
    assert "_digest" not in env.state()


@pytest.mark.parametrize("omp, cause", [
    (omp_exits, "boom: no teams token"),
    (omp_missing, "No such file or directory"),
    (lambda command: teams_stdout(command, error="Graph 403 Forbidden"), "Graph 403 Forbidden"),
    (lambda command: teams_stdout(command, receipt="Sent to chat 19:group@thread"), "Sent to chat 19:group@thread"),
    (lambda command: teams_stdout(command, message="some other text"), "teams_send"),
], ids=["omp-exit", "omp-missing", "teams-error", "receipt-mismatch", "message-mismatch"])
def test_failed_send_exits_1_keeps_the_last_digest_time_and_session_state(env, omp, cause):
    env.watch("alpha", omp_live)
    assert env.main().exit_code == 0
    env.omp = omp
    env.now = T0 + 30 * 60
    result = env.main()
    assert result.exit_code == 1, result.output
    assert cause in result.output
    assert sum(c[0] == "omp" for c in env.calls) == 2, "a failed send is not retried inside the run"
    state = env.state()
    assert state["_digest"] == {"at": T0}
    assert state["alpha"]["last_seen"] == T0 + 30 * 60


def test_probe_failure_for_one_session_still_sends_the_digest(env):
    env.watch("alpha", omp_live)
    env.watch("beta", broken)
    result = env.main()
    assert result.exit_code == 1, result.output
    [digest] = env.sent()
    lines = digest.splitlines()
    assert lines[0] == f"agent progress {HHMM} \u00b7 2 running"
    assert "- beta \u00b7 local \u00b7 probe failed: ssh: connect refused" in lines
    assert f"- alpha \u00b7 local \u00b7 last activity {HHMM} \u00b7 tail latest answer" in lines
    assert env.state()["_digest"]["at"] == T0


def test_probe_timeout_reports_the_timeout_not_the_command(monkeypatch):
    def hang(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    monkeypatch.setattr(wa.subprocess, "run", hang)
    with pytest.raises(RuntimeError) as error:
        wa.probe({"mux": "tern", "pane": "1", "host": "dev@build-host", "result": "/r.md"}, want=True)
    assert str(error.value) == "probe on dev@build-host timed out after 60 s"


def write_fake_tern(home, pid, pane):
    tern = home / ".local" / "bin" / "tern"
    tern.parent.mkdir(parents=True, exist_ok=True)
    tern.write_text('#!/bin/sh\ncase "$1" in\nprocess) echo \'{"foreground": {"pid": PID}}\' ;;\ncapture) cat PANE ;;\nesac\n'
                    .replace("PID", str(pid)).replace("PANE", str(pane)))
    tern.chmod(0o755)


@pytest.fixture
def pane_process():
    """A pane's foreground process: holds an omp session jsonl open as tern's child does, or holds nothing."""
    procs = []

    def start(session=None):
        if session is None:
            proc = subprocess.Popen(["sleep", "30"])
        else:
            proc = subprocess.Popen(["bash", "-c", f"exec 9<'{session}'; exec sleep 30"])
            fd = Path(f"/proc/{proc.pid}/fd/9")
            deadline = time.monotonic() + 5
            while not fd.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
        procs.append(proc)
        return proc.pid

    yield start
    for proc in procs:
        proc.kill()
        proc.wait()


def probe_tern(monkeypatch, tmp_path, pid, pane, want=None, result=""):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    write_fake_tern(tmp_path / "home", pid, pane)
    a = {"mux": "tern", "pane": "1", "host": "local", "result": result}
    return wa.probe(a) if want is None else wa.probe(a, want=want)


def test_probe_default_run_has_no_tail_and_hashes_the_pane_as_before(monkeypatch, tmp_path, pane_process):
    pane = tmp_path / "pane.txt"
    pane.write_text("pane one\npane two\n")
    result = probe_tern(monkeypatch, tmp_path, pane_process(), pane)
    assert result["alive"] is True
    assert "tail" not in result and "kind" not in result
    assert result["text"] == hashlib.md5(pane.read_bytes()).hexdigest()[:16]


def test_probe_want_keeps_text_and_todo_behind_more_than_1mb_of_tool_output(monkeypatch, tmp_path, pane_process):
    noise = {"type": "message", "message": {"role": "toolResult", "toolName": "bash",
                                            "content": [{"type": "text", "text": "x" * 100_000}]}}
    cut = '{"type":"message","message":{"role":"assistant","content":[{"type":"te'
    body = jsonl(assistant(text_item("old status")), assistant(text_item("still working on U1")),
                 todo_result(("Plan", "completed"), ("U1", "in_progress"), ("Ship", "pending")),
                 *[tool_turn(), noise] * 15) + "\n" + cut
    assert len(body) > 1_400_000
    session = tmp_path / "sessions" / "proj" / "s.jsonl"
    session.parent.mkdir(parents=True)
    session.write_text(body)
    pane = tmp_path / "pane.txt"
    pane.write_text("ignored capture\n")
    result = probe_tern(monkeypatch, tmp_path, pane_process(session), pane, want=True)
    assert result["kind"] == "jsonl"
    assert len(decode_tail(result)) < 10_000
    assert wa.latest_line(decode_tail(result)) == "still working on U1 [todo 1/3, now: U1]"


def test_probe_want_tails_the_pane_when_no_session_is_held(monkeypatch, tmp_path, pane_process):
    pane = tmp_path / "pane.txt"
    pane.write_text("pane one\npane two\n")
    result = probe_tern(monkeypatch, tmp_path, pane_process(), pane, want=True)
    assert result["kind"] == "pane"
    assert decode_tail(result) == "pane one\npane two\n"


@pytest.mark.parametrize("text, status", [
    ("status: done\n", "done"),
    ("## RESULT\n- status: done\n- commits: abc\n", "done"),
    ("status: in_progress\n", "in_progress"),
    ("- status: partial\n", "partial"),
    ("* status: blocked\n", "blocked"),
    ("**status:** done\n", "done"),
    ("**status**: done\n", "done"),
    ("`status`: done\n", "done"),
    ("`status:` done\n", "done"),
    ("- **status:** in_progress\n", "in_progress"),
    ("  * `status`: partial\n", "partial"),
    ("RESULT\nstatus: done | partial | blocked\ncommits: none\n", "done"),
    ("RESULT\ncommits: none\n", ""),
    ("the status: done today\n", ""),
])
def test_probe_reads_a_result_status_with_a_list_marker_or_snake_case(monkeypatch, tmp_path, pane_process, text, status):
    """The RESULT block may be bare, a list item, or bold or backticked, and status may contain `_`."""
    result_file = tmp_path / "RESULT.md"
    result_file.write_text(text)
    pane = tmp_path / "pane.txt"
    pane.write_text("pane\n")
    result = probe_tern(monkeypatch, tmp_path, pane_process(), pane, result=str(result_file))
    assert result["rstatus"] == status
    assert result["rmtime"] == int(result_file.stat().st_mtime)

