#!/usr/bin/env python3
"""Collect visual-synthesis output observations for blind image review."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


CASES = {
    "describe",
    "ocr",
    "compare",
    "pixel-noise",
    "semantic-change",
    "hidden-channel",
    "missing-image",
    "multi-no-compare",
}


def load_output(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text.strip()
    if isinstance(data, dict) and isinstance(data.get("result"), str):
        return data["result"].strip()
    return text.strip()


def require(text: str, findings: list[str], *needles: str) -> None:
    lowered = text.casefold()
    for needle in needles:
        if needle.casefold() not in lowered:
            findings.append(f"missing required evidence: {needle!r}")


def require_any(text: str, findings: list[str], label: str, choices: tuple[str, ...]) -> None:
    lowered = text.casefold()
    if not any(choice.casefold() in lowered for choice in choices):
        findings.append(f"missing {label}; expected one of {choices!r}")


def first_heading(text: str, choices: tuple[str, ...]) -> int:
    for match in re.finditer(r"(?m)^#{1,6}\s+(.+?)\s*$", text):
        heading = match.group(1).casefold()
        if any(choice.casefold() in heading for choice in choices):
            return match.start()
    return -1


def heading_count(text: str, choices: tuple[str, ...]) -> int:
    count = 0
    for match in re.finditer(r"(?m)^#{1,6}\s+(.+?)\s*$", text):
        heading = match.group(1).casefold()
        if any(choice.casefold() in heading for choice in choices):
            count += 1
    return count


def reject_comparison_heading(text: str, findings: list[str]) -> None:
    if first_heading(text, ("comparison", "compare", "比较", "对比", "diff")) >= 0:
        findings.append("non-compare task emitted a comparison")


def check_ledger_first(text: str, findings: list[str]) -> None:
    ledger = first_heading(text, ("visual element ledger", "视觉元素台账", "视觉元素账本"))
    synthesis = first_heading(
        text,
        ("synthesis", "综合解读", "综合描述", "综合分类", "综合结论", "核心结论", "总结", "结论"),
    )
    if ledger < 0:
        findings.append("missing Visual Element Ledger")
    if synthesis < 0:
        findings.append("missing synthesis derived from the ledger")
    if ledger >= 0 and synthesis >= 0 and ledger > synthesis:
        findings.append("synthesis appears before the Visual Element Ledger")
    require_any(text, findings, "coverage", ("coverage", "覆盖"))
    require_any(text, findings, "regions", ("regions", "区域"))
    require_any(text, findings, "elements", ("elements", "元素"))
    require_any(
        text,
        findings,
        "text ledger",
        ("## Text", "### Text", "## 文本", "### 文本", "文字台账", "文字账本", "文本台账", "文本账本", "可见文字"),
    )


def has_unapproved_verdict(text: str) -> bool:
    return bool(
        re.search(
            r"(?im)^\s*(?:verdict|result|结论|结果)\s*[:：]\s*(?:pass|fail|通过|失败)\b",
            text,
        )
    )


def check_two_levels(text: str, findings: list[str]) -> None:
    require_any(text, findings, "pixel level", ("level 1", "level-1", "pixel", "像素比较", "字节与像素"))
    require_any(
        text,
        findings,
        "ledger level",
        (
            "level 2",
            "level-2",
            "ledger comparison",
            "ledger-level comparison",
            "ledger diff",
            "ledger 比较",
            "账本比较",
        ),
    )


def validate_text(text: str, case: str) -> list[str]:
    findings: list[str] = []
    if not text.strip():
        return ["agent produced no user-visible output"]

    if case == "describe":
        check_ledger_first(text, findings)
        reject_comparison_heading(text, findings)
        require(
            text,
            findings,
            "Fleet Console",
            "Region: us-east-2",
            "Healthy",
            "Warning",
            "Offline",
            "Queue depth",
            "edge-01",
            "edge-02",
            "Draining",
            "Deploy",
        )
        require_any(text, findings, "semantic equivalent", ("semantic equivalent", "语义等价"))
        require_any(text, findings, "chart contract", ("x_axis", "x axis", "x-axis", "x 轴", "x轴"))
        require_any(text, findings, "table contract", ("columns", "column count", "column_count", "列", "列数"))
        require_any(text, findings, "relationship evidence", ("relationship", "contains", "containment", "关系", "包含"))
        require_any(text, findings, "targetable structures", ("targetable", "可定位结构", "目标结构"))
    elif case == "ocr":
        check_ledger_first(text, findings)
        reject_comparison_heading(text, findings)
        lines = (
            "RELEASE NOTES v2.7.0",
            "Owner: R&D / QA",
            "Window: 09:30-10:15 UTC",
            '1. Keep "Retry-After" unchanged.',
            "2. Error code: E_CONN_042.",
            "Rollback if p95 > 250 ms.",
            "DO NOT TRANSLATE.",
        )
        require(text, findings, *lines)
        positions = [text.find(line) for line in lines]
        if all(position >= 0 for position in positions) and positions != sorted(positions):
            findings.append("OCR transcript does not preserve reading order")
        require_any(text, findings, "semantic equivalent", ("semantic equivalent", "语义等价"))
        require_any(text, findings, "document semantic equivalent", ("document", "text-block", "text block", "文档", "文本块"))
    elif case == "compare":
        check_two_levels(text, findings)
        require_any(text, findings, "golden baseline", ("golden", "权威基准"))
        require_any(text, findings, "byte tolerance", ("byte", "字节"))
        require_any(text, findings, "hash evidence", ("hash", "哈希", "MD5", "SHA-256"))
        require_any(
            text,
            findings,
            "exact equality",
            ("byte-identical", "byte identical", "hash match", "hashes match", "精确字节一致", "逐字节一致"),
        )
        require_any(text, findings, "approved PASS verdict", ("PASS", "通过"))
        if re.search(r"(?i)level\s*2.{0,40}(?:not run|skipped)|(?:not run|skipped).{0,40}level\s*2", text, re.DOTALL):
            findings.append("byte-identical case skipped required Level 2")
        require_any(
            text,
            findings,
            "ledger equality",
            (
                "0/0",
                "unchanged",
                "no semantic",
                "identical VEL",
                "all facets",
                "no ledger delta",
                "zero ledger delta",
                "全部分面",
                "均匹配",
            ),
        )
        check_compare_facets(text, findings)
    elif case == "pixel-noise":
        check_two_levels(text, findings)
        require(text, findings, "120", "1", "sub-lsb-blend-noise", "Render Stable")
        require_any(text, findings, "changed pixel metric", ("changed px", "changed_px", "changed pixels", "变化像素"))
        require_any(
            text,
            findings,
            "no semantic delta",
            (
                "no semantic",
                "unchanged",
                "0 added",
                "0 removed",
                "完全一致",
                "均匹配",
                "无语义",
                "semantically identical",
                "every VEL facet matches",
                "no added/removed/changed",
            ),
        )
        check_compare_facets(text, findings)
        if has_unapproved_verdict(text):
            findings.append("no-verdict case emitted an unapproved pass/fail verdict")
    elif case == "semantic-change":
        check_two_levels(text, findings)
        require(text, findings, "READY", "FAILED", "Deploy", "Retry", "real-change")
        require_any(text, findings, "pixel support", ("changed px", "changed_px", "pixel", "变化像素", "像素"))
        require_any(text, findings, "ledger delta", ("text", "element", "semantic equivalent", "文字", "文本", "元素", "语义等价"))
        check_compare_facets(text, findings)
        if has_unapproved_verdict(text):
            findings.append("no-verdict case emitted an unapproved pass/fail verdict")
    elif case == "hidden-channel":
        check_ledger_first(text, findings)
        require(text, findings, "SECRET 42", "LSB MARK")
        require_any(text, findings, "alpha-channel evidence", ("alpha", "channel A", "A channel"))
        require_any(text, findings, "bit-plane evidence", ("bit-plane", "bit plane", "bit0", "bit 0", "LSB"))
        require_any(
            text,
            findings,
            "hidden-content classification",
            ("hidden", "invisible", "composite", "隐藏", "不可见", "合成"),
        )
        require_any(
            text,
            findings,
            "probe evidence",
            ("channel_probe", "channel probe", "per-channel", "通道探测", "通道检查", "通道探针"),
        )
        require_any(
            text,
            findings,
            "hidden-signal probe evidence",
            (
                "hidden_probe",
                "hidden-signal",
                "hidden signal",
                "bit-plane",
                "LSB probe",
                "位平面探测",
                "隐藏信号",
                "位平面检查",
            ),
        )
        require(text, findings, "DCT/DWT")
        require_any(text, findings, "deep watermark limitation", ("deep/generative", "deep or generative", "SynthID"))
    elif case == "missing-image":
        require_any(
            text,
            findings,
            "loud missing-image error",
            ("not found", "does not exist", "missing", "cannot inspect", "找不到", "不存在", "缺失", "无法检查", "无法读取"),
        )
        if re.search(r"(?i)coverage\s*[:：]?\s*complete|覆盖.{0,8}完整", text):
            findings.append("missing-image response fabricated complete coverage")
        require_any(text, findings, "blocked status", ("blocked", "受阻", "无法读取", "无法检查"))
        if re.search(r"\bR\d+(?:\.[ET]\d+)?\b", text):
            findings.append("missing-image response fabricated observed ledger refs")
    elif case == "multi-no-compare":
        reject_comparison_heading(text, findings)
        ledgers = heading_count(text, ("visual element ledger", "视觉元素台账", "视觉元素账本"))
        if ledgers < 2:
            findings.append(f"expected one VEL per image; found={ledgers}")
        require(text, findings, "Fleet Console", "RELEASE NOTES v2.7.0")
        require_any(text, findings, "per-image coverage", ("coverage", "覆盖"))
    else:
        findings.append(f"unknown case: {case}")
    return findings


def check_compare_facets(text: str, findings: list[str]) -> None:
    facets = {
        "regions": ("regions", "区域"),
        "elements": ("elements", "元素"),
        "text": ("text", "文字", "文本"),
        "targetable structures": ("targetable", "可定位结构", "目标结构"),
        "groups": ("groups", "分组", "重复组"),
        "semantic equivalents": ("semantic equivalent", "语义等价"),
        "relationships": ("relationships", "关系"),
        "quality issues": ("quality issues", "质量问题", "质量"),
        "channel diff": ("channel-diff", "channel diff", "channel probe", "通道差异", "通道比较", "通道探针"),
        "hidden signal": ("hidden-signal", "hidden signal", "隐藏信号", "位平面"),
    }
    lowered = text.casefold()
    for label, choices in facets.items():
        if not any(choice.casefold() in lowered for choice in choices):
            findings.append(f"Level 2 omits facet: {label}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("--case", choices=sorted(CASES), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not (args.workspace / "images").is_dir():
        result = {
            "trial_validity": "invalid",
            "semantic_verdict": "AI_REVIEW_REQUIRED",
            "case": args.case,
            "observations": ["trial workspace has no generated images"],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    try:
        output = load_output(args.output)
    except (OSError, json.JSONDecodeError) as error:
        findings = [f"no readable agent result: {type(error).__name__}"]
    else:
        findings = validate_text(output, args.case)
    result = {
        "trial_validity": "observed",
        "semantic_verdict": "AI_REVIEW_REQUIRED",
        "case": args.case,
        "observations": findings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
