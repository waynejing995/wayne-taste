#!/usr/bin/env python3
"""Calibrate each independent visual-synthesis checker invariant."""

from __future__ import annotations

from check_trial import CASES, validate_text


VALID = {
    "describe": """## Visual Element Ledger
## Coverage
regions elements relationships
## Text
Fleet Console | Region: us-east-2 | Healthy 12 | Warning 2 | Offline 1
Queue depth x-axis values. edge-01 Ready, edge-02 Draining. Deploy.
semantic equivalent: chart x_axis; table columns and column_count.
Targetable structures preserve geometry.
## Synthesis
Derived from the ledger.
""",
    "ocr": '''## Visual Element Ledger
regions elements coverage
## Text
semantic equivalent: document text-block transcript
RELEASE NOTES v2.7.0
Owner: R&D / QA
Window: 09:30-10:15 UTC
1. Keep "Retry-After" unchanged.
2. Error code: E_CONN_042.
Rollback if p95 > 250 ms.
DO NOT TRANSLATE.
## Synthesis
Derived from the ledger.
''',
    "compare": """## Comparison: golden vs actual
Golden baseline; byte-identity tolerance.
### Level 1 - Pixel
Exact byte-identical; hashes match. PASS.
### Level 2 - Ledger comparison
All facets unchanged; no semantic delta; no ledger delta.
Regions Elements Text Targetable structures Groups Semantic equivalents Relationships
Quality issues Channel-diff Hidden-signal.
""",
    "pixel-noise": """## Comparison
Tolerance: no verdict
### Level 1 - Pixel
changed px: 120; max L1: 1; sub-lsb-blend-noise.
### Level 2 - Ledger diff
Render Stable unchanged; 0 added, 0 removed; no semantic delta.
Regions Elements Text Targetable structures Groups Semantic equivalents Relationships
Quality issues Channel-diff Hidden-signal.
""",
    "semantic-change": """## Comparison
Tolerance: no verdict
### Level 1 - Pixel
changed px reported with pixel support; real-change.
### Ledger-level comparison
Text and element delta: Status: READY to Status: FAILED; Deploy to Retry; semantic equivalent changed.
Regions Elements Text Targetable structures Groups Semantic equivalents Relationships
Quality issues Channel-diff Hidden-signal.
No pass/fail verdict issued.
""",
    "hidden-channel": """## Visual Element Ledger
## Coverage
regions elements
## Text
R2.E1 SECRET 42 is hidden in alpha channel A and invisible in the RGB composite.
R2.E2 LSB MARK is hidden in bit-plane bit0. channel_probe per-channel evidence and
hidden_probe hidden-signal evidence. DCT/DWT and deep/generative SynthID are not covered.
## Synthesis
Derived from the ledger.
""",
    "missing-image": "ERROR: image does not exist; cannot inspect the missing source. Status: blocked.",
    "multi-no-compare": """## Visual Element Ledger — dashboard.png
Fleet Console
## Coverage
complete
## Visual Element Ledger — release-notes.png
RELEASE NOTES v2.7.0
## Coverage
complete
""",
}

LOCALIZED = {
    "describe": """## Visual Element Ledger
### 区域
### 元素
### 文本
Fleet Console Region: us-east-2 Healthy Warning Offline Queue depth
edge-01 edge-02 Draining Deploy
## 语义等价物
折线图 X 轴；表格列；关系包含。
## 可定位结构
保留几何。
## 覆盖审计
完整
## 综合描述
台账派生总结。
""",
    "compare": """## 图像比较报告
比较类型 Golden baseline；权威基准 golden.png；精确字节一致；MD5 哈希匹配；PASS。
## 字节与像素比较
变化像素 0。
## Visual Element Ledger 比较
全部分面均匹配：Regions Elements Text Targetable structures Groups Semantic equivalents
Relationships Quality issues Channel probe Hidden-signal probe。
""",
    "pixel-noise": """## Level 1：像素比较
变化像素 120；最大 L1 1；sub-lsb-blend-noise；Render Stable。
## Level 2：Ledger 比较
全部可见内容完全一致。区域 元素 文字 可定位结构 重复组 语义等价 关系
质量问题 通道差异 隐藏信号。No pass/fail verdict issued.
""",
    "semantic-change": """## Level 1：像素比较
变化像素有明确像素支持；real-change。
## Level 2：Ledger 比较
文字和元素：Status: READY 到 Status: FAILED；Deploy 到 Retry。
区域 元素 文字 可定位结构 重复组 语义等价 关系 质量问题 通道差异 隐藏信号。
No pass/fail verdict issued.
""",
    "hidden-channel": """## Visual Element Ledger
### 区域
### 元素
## 可见文字台账
SECRET 42 位于 Alpha 通道；LSB MARK 位于 bit 0 位平面。
通道探测与位平面探测确认隐藏内容。
DCT/DWT 与 deep/generative SynthID 不在覆盖范围。
## 覆盖审计
完整
## 综合结论
总结派生自台账。
""",
}


def assert_valid(case: str, text: str) -> None:
    findings = validate_text(text, case)
    if findings:
        raise AssertionError(f"valid {case} failed: {findings}")


def assert_mutation(case: str, text: str, needle: str) -> None:
    findings = validate_text(text, case)
    if not any(needle in finding for finding in findings):
        raise AssertionError(f"{case} mutation missed {needle!r}: {findings}")


def main() -> int:
    if set(VALID) != CASES:
        raise AssertionError("calibration cases drifted from checker cases")
    for case, text in VALID.items():
        assert_valid(case, text)
    for case, text in LOCALIZED.items():
        assert_valid(case, text)

    assert_mutation("describe", VALID["describe"].replace("semantic equivalent", "carrier"), "semantic equivalent")
    assert_mutation("describe", VALID["describe"].replace("Targetable structures", "Objects"), "targetable")
    reversed_report = "## Synthesis\nPremature summary.\n" + VALID["describe"]
    assert_mutation("describe", reversed_report, "synthesis appears before")
    assert_mutation("ocr", VALID["ocr"].replace("E_CONN_042", "E-CONN-042"), "E_CONN_042")
    assert_mutation(
        "compare",
        VALID["compare"].replace("Exact byte-identical; hashes match.", "Visually similar."),
        "exact equality",
    )
    assert_mutation("compare", VALID["compare"] + "\nLevel 2 not run.\n", "skipped required Level 2")
    assert_mutation("compare", VALID["compare"].replace("Hidden-signal", "Probe"), "hidden signal")
    assert_mutation("pixel-noise", VALID["pixel-noise"].replace("120", "119"), "120")
    assert_mutation("pixel-noise", VALID["pixel-noise"] + "\nVerdict: PASS\n", "unapproved")
    assert_mutation("semantic-change", VALID["semantic-change"].replace("FAILED", "READY"), "FAILED")
    assert_mutation("hidden-channel", VALID["hidden-channel"].replace("SECRET 42", "unknown"), "SECRET 42")
    assert_mutation("hidden-channel", VALID["hidden-channel"].replace("LSB MARK", "unknown"), "LSB MARK")
    assert_mutation(
        "hidden-channel",
        VALID["hidden-channel"].replace(
            "R2.E2 LSB MARK is hidden in bit-plane bit0. channel_probe per-channel evidence and\n"
            "hidden_probe hidden-signal evidence.",
            "R2.E2 LSB MARK is hidden in a payload. channel_probe per-channel evidence.",
        ),
        "hidden-signal probe",
    )
    assert_mutation("hidden-channel", VALID["hidden-channel"].replace("DCT/DWT", "watermarks"), "DCT/DWT")
    assert_mutation("missing-image", "## Visual Element Ledger\nCoverage: complete\n", "loud missing-image")
    assert_mutation(
        "missing-image",
        "ERROR: missing source. Status: blocked.\nR1.E1 invented object\n",
        "fabricated observed ledger refs",
    )
    assert_mutation(
        "multi-no-compare",
        VALID["multi-no-compare"].replace("## Visual Element Ledger — release-notes.png", "## release-notes.png"),
        "one VEL per image",
    )
    assert_mutation("multi-no-compare", VALID["multi-no-compare"] + "\n## Comparison\n", "emitted a comparison")
    print(
        f"PASS: observations cover {len(CASES)} cases and 18 mutations; "
        "semantic verdict remains AI_REVIEW_REQUIRED"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
