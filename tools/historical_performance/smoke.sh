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
python3 docs/historical-performance/test-scores/expand_native_to_18.py \
    src/engraving/tests/automation/data/tempo_relative.mscx "$tmp_dir/18-parts.mscx"
# The checked-in native regression must be exactly the generator output.
cmp "$tmp_dir/18-parts.mscx" src/engraving/tests/automation/data/tempo_relative_18_parts.mscx
python3 docs/historical-performance/test-scores/expand_expressive_to_18.py \
    src/engraving/tests/automation/data/tempo_relative.mscx "$tmp_dir/18-expressive.mscx"
cmp "$tmp_dir/18-expressive.mscx" src/engraving/tests/automation/data/tempo_relative_18_expressive.mscx
python3 - "$tmp_dir/18-parts.musicxml" "$tmp_dir/18-parts.mscx" "$tmp_dir/18-expressive.mscx" <<'PY'
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
native = ET.parse(Path(sys.argv[2])).getroot().find('Score')
assert len(native.findall('Part')) == len(native.findall('Staff')) == 18
assert len(list(native.iter('Tempo'))) == 4  # never duplicate the global markings
assert len(native.findall('./SpannerMap/GradualTempoChange')) == 1
assert len(native.findall('.//Fermata')) == 1
ids = [element.text for element in native.iter('eid')]
assert len(ids) == len(set(ids))
for index, staff in enumerate(native.findall('Staff')):
    measures = staff.findall('Measure')
    assert len(measures) == 6
    assert all((m.find('eid') is not None) == (index == 0) for m in measures)
    assert (measures[-1].find('endRepeat') is not None) == (index == 0)
    assert all(len(m.findall('./voice/Chord/Note')) == 1 for m in measures)
expressive = ET.parse(Path(sys.argv[3])).getroot().find('Score')
from importlib.util import spec_from_file_location, module_from_spec
sys.path.insert(0, 'docs/historical-performance/test-scores')
spec = spec_from_file_location('expressive', 'docs/historical-performance/test-scores/expand_expressive_to_18.py')
module = module_from_spec(spec)
spec.loader.exec_module(module)
staves = expressive.findall('Staff')
assert len(staves) == len(module.RHYTHMS) == 18
assert len(set(module.RHYTHMS)) == 18
for index, staff in enumerate(staves):
    for measure in staff.findall('Measure'):
        chords = measure.findall('./voice/Chord')
        assert len(chords) == len(module.RHYTHMS[index])
        assert sum({'eighth': 1, 'quarter': 2, 'half': 4, 'whole': 8}[c.findtext('durationType')] for c in chords) == 8
        assert all(c.find('./Articulation/subtype') is not None for c in chords)
    assert len(staff.findall('./Measure/voice/Dynamic')) == 1
assert len({element.text for element in expressive.iter('eid')}) == len(list(expressive.iter('eid')))
print('XML fixture checks: relative tempo, 18 independent rhythms/dynamics/articulations and shared timing')
PY
git diff --check
