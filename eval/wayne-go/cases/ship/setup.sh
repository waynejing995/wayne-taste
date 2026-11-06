#!/usr/bin/env bash
# Leave one reviewed, uncommitted change in the working tree.
set -euo pipefail
sed -i 's|%d/%m/%Y|%Y-%m-%d|' src/tasks/format.py
sed -i 's|due 30/11/2026|due 2026-11-30|' tests/test_format.py
