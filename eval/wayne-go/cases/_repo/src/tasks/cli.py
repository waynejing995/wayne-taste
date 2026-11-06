import sys
from pathlib import Path

from tasks.format import render
from tasks.store import Store


def main() -> int:
    store = Store(Path("tasks.json"))
    if sys.argv[1:2] == ["list"]:
        for task in store.load():
            print(render(task))
        return 0
    print("usage: python -m tasks.cli list")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
