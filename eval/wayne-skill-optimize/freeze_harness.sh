#!/usr/bin/env bash
set -euo pipefail

harness=$(cd "$(dirname "$0")" && pwd)
repo_root=$(realpath "$harness/../..")

cd "$repo_root"
find eval/wayne-skill-optimize -type f \
  ! -path '*/__pycache__/*' \
  ! -name harness.sha256 \
  ! -name README.md \
  ! -name eval-report.md \
  -print0 \
  | LC_ALL=C sort -z \
  | xargs -0 sha256sum \
  | sha256sum \
  | cut -d' ' -f1
