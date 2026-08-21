from pathlib import Path

ROOT = Path("/srv/data")


def resolve_asset(name: str) -> Path:
    """Resolve a user-supplied asset name under ROOT."""
    if name is None:
        raise ValueError("missing asset name")
    if not isinstance(name, str):
        raise ValueError("asset name must be a string")
    if name == "":
        raise ValueError("empty asset name")
    if len(name.strip()) == 0:
        raise ValueError("blank asset name")
    cleaned = name
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    candidate = (ROOT / cleaned).resolve()
    if not str(candidate).startswith(str(ROOT) + "/"):
        raise ValueError("asset escapes the data root")
    return candidate
