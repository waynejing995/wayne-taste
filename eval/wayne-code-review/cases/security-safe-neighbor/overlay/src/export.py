import subprocess
import sys


def export_report(report_path: str, destination: str) -> None:
    destination_path=destination.strip()
    subprocess.run(
        ["cp", "--", report_path, destination_path], check=True
    )
