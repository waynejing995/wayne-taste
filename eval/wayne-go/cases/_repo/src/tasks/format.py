from datetime import datetime


def render(task: dict) -> str:
    due = datetime.fromisoformat(task["due"]).strftime("%d/%m/%Y")
    return f"[{'x' if task['done'] else ' '}] {task['title']} (due {due})"
