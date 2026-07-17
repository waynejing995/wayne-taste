from pathlib import Path
import sys


def main() -> None:
    source, destination = map(Path, sys.argv[1:3])
    value = source.read_text(encoding="utf-8").strip().upper()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(value, encoding="utf-8")
    print(f"CONVERT_OK value={value}")


if __name__ == "__main__":
    main()
