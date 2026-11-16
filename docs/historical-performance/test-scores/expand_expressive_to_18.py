#!/usr/bin/env python3
"""Build a native 18-part timing probe with different rhythms and articulations.

Every part is a separate staff/instrument; system tempo and fermata are kept
only once. This is a synthetic MIDI/playback test, not an ensemble recording.
"""

import copy
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from expand_native_to_18 import eid, expand

# Durations in eighth notes. Each part has a distinct, complete 4/4 bar.
RHYTHMS = (
    (8,), (4, 4), (2, 2, 2, 2), (1, 1, 2, 4), (4, 2, 2),
    (2, 4, 2), (2, 2, 4), (4, 1, 1, 2), (2, 1, 1, 4),
    (1, 2, 1, 4), (1, 1, 1, 1, 4), (4, 1, 2, 1),
    (1, 4, 1, 2), (1, 2, 4, 1), (1, 1, 4, 2),
    (2, 4, 1, 1), (1, 4, 2, 1), (1, 1, 2, 1, 1, 2),
)
DURATION = {1: "eighth", 2: "quarter", 4: "half", 8: "whole"}
DYNAMIC = (("p", "49"), ("mf", "80"), ("f", "96"))
ARTICULATION = ("articTenutoAbove", "articStaccatoAbove", "articAccentAbove")


def generate(source: Path, output: Path) -> None:
    if len(RHYTHMS) != 18 or len(set(RHYTHMS)) != 18 or any(sum(r) != 8 for r in RHYTHMS):
        raise ValueError("Each of the 18 parts needs a unique full 4/4 rhythm")
    expand(source, output)
    tree = ET.parse(output)
    score = tree.getroot().find("Score")
    for staff_index, staff in enumerate(score.findall("Staff")):
        for measure_index, measure in enumerate(staff.findall("Measure")):
            voice = measure.find("voice")
            chord = voice.find("Chord")
            if chord is None:
                raise ValueError("Missing original pitched voice")
            insertion = list(voice).index(chord)
            voice.remove(chord)
            if measure_index == 0:
                dynamic = ET.Element("Dynamic")
                ET.SubElement(dynamic, "subtype").text = DYNAMIC[staff_index % 3][0]
                ET.SubElement(dynamic, "velocity").text = DYNAMIC[staff_index % 3][1]
                ET.SubElement(dynamic, "eid").text = eid(f"dynamic:{staff_index}")
                voice.insert(insertion, dynamic)
                insertion += 1
            for note_index, units in enumerate(RHYTHMS[staff_index]):
                item = copy.deepcopy(chord)
                for value in item.iter("eid"):
                    value.text = eid(f"expressive:{staff_index}:{measure_index}:{note_index}:{value.text}")
                item.find("durationType").text = DURATION[units]
                # Musically different note lengths and attacks, not text-only
                # annotations. The rendering and MIDI tests inspect the events.
                articulation = ET.Element("Articulation")
                ET.SubElement(articulation, "subtype").text = ARTICULATION[staff_index % 3]
                ET.SubElement(articulation, "eid").text = eid(f"artic:{staff_index}:{measure_index}:{note_index}")
                item.insert(list(item).index(item.find("Note")), articulation)
                voice.insert(insertion + note_index, item)
    ET.indent(tree, space="  ")
    tree.write(output, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: expand_expressive_to_18.py source.mscx destination.mscx")
    generate(Path(sys.argv[1]), Path(sys.argv[2]))
