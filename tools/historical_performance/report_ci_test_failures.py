#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# MuseScore-Studio-CLA-applies
"""Surface CTest failures as GitHub annotations when runner logs are inaccessible."""

import os
import sys
from pathlib import Path


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def annotate(title: str, message: str) -> None:
    # Workflow-command lines may not contain raw newlines or control characters.
    line = " ".join(message.split())[:900].replace("::", ": ")
    print(f"::error title={title}::{line}")


def report(build_dir: Path) -> None:
    temporary = build_dir / "Testing" / "Temporary"
    failed = read(temporary / "LastTestsFailed.log")
    details = read(temporary / "LastTest.log")

    suites = failed.splitlines()[:50]
    for suite in suites:
        annotate("Failed CTest suite", suite)

    # CTest's verbose log preserves GoogleTest assertion messages. Avoid
    # recursively parsing every XML file in the build tree: many are not test
    # results, and malformed/unrelated XML can break the diagnostic step.
    markers = ("[  FAILED  ]", "Failure", "CMake Error", "AddressSanitizer", "Segmentation fault")
    diagnostic_lines = [line for line in details.splitlines() if any(marker in line for marker in markers)]
    for line in diagnostic_lines[:30]:
        annotate("Unit-test detail", line)

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        try:
            with open(summary, "a", encoding="utf-8") as out:
                out.write("## Failed unit tests\n\n")
                out.write("```\n" + (failed[:10000] or "No CTest failure list found.") + "\n```\n")
                out.write("### CTest log tail\n\n```\n" + details[-20000:] + "\n```\n")
        except OSError as error:
            print(f"::warning::Could not write failure summary: {error}")
    if not suites and not diagnostic_lines:
        print("::warning::CTest failed but produced no readable failure report")


if __name__ == "__main__":
    try:
        report(Path(sys.argv[1] if len(sys.argv) > 1 else "build.debug"))
    except Exception as error:  # diagnostics must never hide the real test failure
        print(f"::warning::Could not summarize CTest failures: {error}")
