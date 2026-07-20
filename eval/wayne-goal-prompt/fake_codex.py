#!/usr/bin/env python3
"""Deterministic `codex app-server` fake for dispatch failure/resume evals."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


MODE = os.environ.get("FAKE_CODEX_MODE", "complete")
TRACE = Path(os.environ["FAKE_CODEX_TRACE"])
THREAD_ID = "thread-fixture"


def emit(message: dict) -> None:
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def record(message: dict) -> None:
    with TRACE.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(message, separators=(",", ":")) + "\n")


def goal(status: str) -> dict:
    return {"threadId": THREAD_ID, "objective": "fixture", "status": status}


def main() -> int:
    if sys.argv[1:] != ["app-server"]:
        return 2
    TRACE.parent.mkdir(parents=True, exist_ok=True)
    for line in sys.stdin:
        request = json.loads(line)
        record(request)
        method = request.get("method")
        request_id = request.get("id")
        params = request.get("params", {})
        if request_id is None:
            continue
        if method == "initialize" and MODE == "initialize-fail":
            emit(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32000, "message": "fixture provider unavailable"},
                }
            )
            return 1
        if method == "turn/start" and MODE == "turn-start-fail":
            emit(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32001, "message": "fixture turn startup failed"},
                }
            )
            return 1
        if method == "initialize":
            result: dict = {}
        elif method == "thread/start":
            result = {"threadId": THREAD_ID}
        elif method == "thread/goal/set":
            status = params.get("status") or "active"
            result = {"goal": goal(status)}
        elif method == "turn/start":
            result = {}
        elif method == "thread/inject_items":
            result = {}
        else:
            result = {}
        emit({"jsonrpc": "2.0", "id": request_id, "result": result})
        if method == "turn/start":
            terminal = "blocked" if MODE == "blocked-resume" else "complete"
            emit(
                {
                    "jsonrpc": "2.0",
                    "method": "thread/goal/updated",
                    "params": {"threadId": THREAD_ID, "goal": goal(terminal)},
                }
            )
        if method == "thread/goal/set" and params.get("status") == "active":
            emit(
                {
                    "jsonrpc": "2.0",
                    "method": "thread/goal/updated",
                    "params": {"threadId": THREAD_ID, "goal": goal("complete")},
                }
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
