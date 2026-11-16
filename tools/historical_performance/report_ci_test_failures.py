#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# MuseScore-Studio-CLA-applies
"""Surface CTest failures as GitHub annotations when runner logs are inaccessible."""

import os
import re
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

    # CTest's verbose log preserves assertion context (including expected and
    # actual values). GoogleTest names can contain "Failure" even on a passing
    # [ RUN ]/[ OK ] line; match actual failure records, not that substring.
    ansi = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
    lines = [ansi.sub("", line) for line in details.splitlines()]
    diagnostic_lines = []
    markers = ("[  FAILED  ]", "CMake Error", "AddressSanitizer", "Segmentation fault",
               "Subprocess aborted", "terminate called", "core dumped", "SIGABRT")
    for index, line in enumerate(lines):
        if "[ RUN " in line or "[       OK ]" in line:
            continue
        if line.rstrip().endswith(": Failure"):
            # Include the next few lines with the values printed by EXPECT_NEAR.
            context = " ".join(part.strip() for part in lines[index:index + 7] if part.strip())
            diagnostic_lines.append(context)
        elif any(marker in line for marker in markers):
            diagnostic_lines.append(line)
    for line in diagnostic_lines[:20]:
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
