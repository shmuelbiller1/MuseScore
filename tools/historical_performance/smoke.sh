#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-only
# MuseScore-Studio-CLA-applies
# Run from anywhere. Structural/source-level checks only; not playback tests.
set -euo pipefail
cd "$(dirname "$0")/../.."
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

g++ -std=c++20 -I muse/framework -I muse/framework/global -I muse/framework/thirdparty \
    tools/historical_performance/ease_probe.cpp -o "$tmp_dir/ease_probe"
"$tmp_dir/ease_probe"
python3 docs/historical-performance/test-scores/expand_to_18.py \
    docs/historical-performance/test-scores/two-voices.musicxml "$tmp_dir/18-parts.musicxml"
python3 - "$tmp_dir/18-parts.musicxml" <<'PY'
from pathlib import Path
import sys
from xml.etree import ElementTree as ET

score = ET.parse('src/engraving/tests/automation/data/tempo_relative.mscx').getroot()
texts = [element for element in score.iter('Tempo') if element.findtext('text') == 'Meno mosso']
assert len(texts) == 1 and texts[0].findtext('tempoChangeFactor') == '0.9'
spanners = list(score.iter('GradualTempoChange'))
assert len(spanners) == 1
assert spanners[0].findtext('tempoEasingMethod') == 'ease-in'
assert spanners[0].findtext('tempoChangeFactor') == '0.5'
xml = ET.parse(Path(sys.argv[1])).getroot()
assert len(xml.findall('part')) == 18
for part in xml.findall('part'):
    assert len(part.findall('measure')) == 3
print('XML fixture checks: one relative marking, one eased ramp, 18 parts with three measures each')
PY
git diff --check
