from collections.abc import Sequence


def render(rows: Sequence[dict[str, str]]) -> str:
    """Render rows as CSV text."""
    if not rows:
        return ""
    header = list(rows[0])
    lines = [",".join(header)]
    for row in rows:
        lines.append(",".join(row[key] for key in header))
    return "\n".join(lines)
