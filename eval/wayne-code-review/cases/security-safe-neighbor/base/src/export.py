"""Safe report export helper."""

import shutil
from pathlib import Path


def export_report(report_path: Path, destination: Path) -> None:
    """Copy a report to an explicitly selected destination."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(report_path, destination)
