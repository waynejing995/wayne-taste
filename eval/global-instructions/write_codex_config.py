#!/usr/bin/env python3
"""Write the minimum provider-only Codex config needed by an isolated eval lane."""

from __future__ import annotations

import argparse
import json
import tomllib
from pathlib import Path


def value(item: object) -> str:
    if isinstance(item, str):
        return json.dumps(item)
    if isinstance(item, bool):
        return "true" if item else "false"
    if isinstance(item, int):
        return str(item)
    raise TypeError(f"unsupported TOML value: {type(item).__name__}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    config = tomllib.loads(args.source.read_text(encoding="utf-8"))
    provider_name = config.get("model_provider")
    providers = config.get("model_providers")
    if not isinstance(provider_name, str) or not isinstance(providers, dict):
        raise ValueError("source Codex config has no selected model provider")
    provider = providers.get(provider_name)
    if not isinstance(provider, dict):
        raise ValueError(f"selected provider is missing: {provider_name}")

    lines = [f"model_provider = {value(provider_name)}"]
    if "service_tier" in config:
        lines.append(f"service_tier = {value(config['service_tier'])}")
    if "model_catalog_json" in config:
        lines.append('model_catalog_json = "/root/.codex/model-catalog-1m.json"')
    lines.extend(["", f"[model_providers.{provider_name}]"])
    query = provider.get("query_params", {})
    for key, item in provider.items():
        if key == "query_params":
            continue
        lines.append(f"{key} = {value(item)}")
    if query:
        if not isinstance(query, dict):
            raise TypeError("provider query_params must be a table")
        lines.extend(["", f"[model_providers.{provider_name}.query_params]"])
        for key, item in query.items():
            lines.append(f"{key} = {value(item)}")
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
