#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "click>=8.1",
#   "loguru>=0.7",
# ]
# ///
"""codex_goal_driver.py — drive a goal through the REAL codex goal subsystem.

Unlike `codex exec` (a single autonomous turn following a prompt), this speaks
the app-server JSON-RPC protocol and uses `thread/goal/set` — the actual goal
loop with a goals DB and a `complete` terminal status.

Protocol (newline-delimited JSON over `codex app-server` stdio):
  initialize {clientInfo}          -> (id)      handshake
  initialized {}                   -> (notify)
  thread/start {cwd, sandbox, approvalPolicy}  -> threadId
  thread/goal/set {threadId, objective, tokenBudget}
  turn/start {threadId, input}     -> streams; input is REQUIRED
  <read notifications until ThreadGoalUpdated.goal.status == "complete">

YOLO = sandbox:"danger-full-access" + approvalPolicy:"never" (params, not a flag).
This also sidesteps bwrap, which fails `RTM_NEWADDR` on some hosts.

Every protocol message is mirrored to --log as JSONL so a monitor can tail it
(push, not poll) — same event-stream contract as the exec path.
"""
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import click
from loguru import logger

CLIENT_INFO = {"name": "wayne-goal-driver", "version": "0.1.0"}
TERMINAL = {"complete", "blocked", "usageLimited", "budgetLimited"}


class AppServer:
    """Thin newline-JSON JSON-RPC client over `codex app-server` stdio."""

    def __init__(self, log_path: Path):
        self.log = log_path
        self.proc = subprocess.Popen(
            ["codex", "app-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._id = 0
        self._pending: dict[int, dict] = {}
        self._notifications: list[dict] = []
        self._lock = threading.Lock()
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def _emit(self, direction: str, msg: dict) -> None:
        with self.log.open("a") as fh:
            fh.write(json.dumps({"dir": direction, **msg}) + "\n")

    def _read_loop(self) -> None:
        for line in self.proc.stdout:  # type: ignore[union-attr]
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                logger.warning("unparseable line: {}", line[:120])
                continue
            self._emit("recv", msg)
            if "id" in msg and ("result" in msg or "error" in msg):
                with self._lock:
                    self._pending[msg["id"]] = msg
            elif msg.get("method"):
                with self._lock:
                    self._notifications.append(msg)

    def _send(self, msg: dict) -> None:
        self._emit("send", msg)
        self.proc.stdin.write(json.dumps(msg) + "\n")  # type: ignore[union-attr]
        self.proc.stdin.flush()  # type: ignore[union-attr]

    def request(self, method: str, params: dict, timeout: float = 120.0) -> dict:
        self._id += 1
        rid = self._id
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self._lock:
                if rid in self._pending:
                    resp = self._pending.pop(rid)
                    if "error" in resp:
                        raise RuntimeError(f"{method} failed: {resp['error']}")
                    return resp.get("result", {})
            if self.proc.poll() is not None:
                raise RuntimeError(f"app-server exited (code {self.proc.returncode}) during {method}")
            time.sleep(0.05)
        raise TimeoutError(f"{method} timed out after {timeout}s")

    def notify(self, method: str, params: dict) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def drain_notifications(self) -> list[dict]:
        with self._lock:
            out = self._notifications[:]
            self._notifications.clear()
        return out

    def alive(self) -> bool:
        return self.proc.poll() is None


def _goal_status(note: dict) -> str | None:
    """Extract goal.status from a thread/goal/updated notification, else None."""
    if note.get("method") != "thread/goal/updated":
        return None
    return note.get("params", {}).get("goal", {}).get("status")


def _drain_inbox(srv: "AppServer", thread_id: str, inbox) -> None:
    """Inject any *.txt dropped in the inbox into the LIVE thread, then mark sent.

    This is the mid-run message channel exec mode cannot offer: while the goal
    loop runs, a reviewer drops a message file here and it lands in the worker's
    model-visible history via thread/injectItems — no waiting for the job to stop.
    """
    for msg_file in sorted(inbox.glob("*.txt")):
        text = msg_file.read_text().strip()
        if not text:
            msg_file.rename(msg_file.with_suffix(".empty"))
            continue
        try:
            # NOTE: the live method is snake_case `thread/inject_items`; the
            # schema file is camelCase `ThreadInjectItems` (codegen artifact).
            # The camelCase `thread/injectItems` is rejected as unknown variant.
            srv.request(
                "thread/inject_items",
                {
                    "threadId": thread_id,
                    "items": [
                        {
                            "type": "message",
                            "role": "user",
                            "content": [{"type": "input_text", "text": text}],
                        }
                    ],
                },
            )
            logger.info("injected mid-run message from {}", msg_file.name)
            msg_file.rename(msg_file.with_suffix(".sent"))
        except Exception as exc:  # noqa: BLE001 — log which msg failed, keep looping
            logger.error("injectItems failed for {}: {}", msg_file.name, exc)
            msg_file.rename(msg_file.with_suffix(".failed"))


@click.command()
@click.option("--goal-file", required=True, type=click.Path(exists=True))
@click.option("--cwd", required=True, type=click.Path())
@click.option("--log", "log_path", required=True, type=click.Path())
@click.option("--token-budget", default=None, type=int, help="Optional goal token budget")
@click.option("--poll", default=3.0, help="Seconds between goal-status checks")
@click.option(
    "--inbox",
    "inbox_dir",
    default=None,
    type=click.Path(),
    help="Directory the driver watches for mid-run messages; each *.txt file "
    "dropped there is injected into the LIVE thread via thread/injectItems, "
    "then renamed *.sent. This is the app-server power exec mode lacks — feed "
    "review/instructions to the worker WHILE it runs.",
)
@click.option("-v", "--verbose", is_flag=True)
def main(goal_file, cwd, log_path, token_budget, poll, inbox_dir, verbose):
    logger.remove()
    logger.add(sys.stderr, level="DEBUG" if verbose else "INFO")

    cwd = str(Path(cwd).resolve())
    objective = Path(goal_file).read_text()
    log = Path(log_path)
    log.parent.mkdir(parents=True, exist_ok=True)
    inbox = Path(inbox_dir) if inbox_dir else None
    if inbox:
        inbox.mkdir(parents=True, exist_ok=True)
        logger.info("inbox watching {} (drop *.txt to inject mid-run)", inbox)

    logger.info("starting app-server, cwd={}", cwd)
    srv = AppServer(log)

    srv.request("initialize", {"clientInfo": CLIENT_INFO})
    srv.notify("initialized", {})
    logger.info("handshake done")

    thread = srv.request(
        "thread/start",
        {"cwd": cwd, "sandbox": "danger-full-access", "approvalPolicy": "never"},
    )
    thread_id = (
        thread.get("threadId")
        or thread.get("thread_id")
        or thread.get("thread", {}).get("id")
    )
    if not thread_id:
        logger.error("no threadId in thread/start result: {}", thread)
        sys.exit(1)
    logger.info("thread {}", thread_id)

    goal_params = {"threadId": thread_id, "objective": objective}
    if token_budget:
        goal_params["tokenBudget"] = token_budget
    srv.request("thread/goal/set", goal_params)
    logger.info("goal set (YOLO: danger-full-access + never)")

    # turn/start REQUIRES input — kick the goal loop with the objective
    srv.request(
        "turn/start",
        {"threadId": thread_id, "input": [{"type": "text", "text": objective}]},
        timeout=600,
    )
    logger.info("turn started; watching goal status")

    # watch goal status until terminal; inject inbox messages mid-run
    while True:
        if not srv.alive():
            logger.error("app-server died before goal reached a terminal status")
            sys.exit(1)
        if inbox:
            _drain_inbox(srv, thread_id, inbox)
        for note in srv.drain_notifications():
            st = _goal_status(note)
            if st:
                logger.info("goal.status = {}", st)
                if st in TERMINAL:
                    if st == "complete":
                        logger.info("GOAL COMPLETE")
                        sys.exit(0)
                    logger.error("goal ended non-complete: {}", st)
                    sys.exit(2)
        time.sleep(poll)


if __name__ == "__main__":
    main()
