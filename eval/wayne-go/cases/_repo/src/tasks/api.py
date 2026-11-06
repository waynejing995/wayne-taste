from pathlib import Path

from tasks.store import Store

STORE = Store(Path("tasks.json"))


def add(title: str, due: str) -> dict:
    tasks = STORE.load()
    task = {"title": title, "due": due, "done": False}
    tasks.append(task)
    STORE.save(tasks)
    return task
