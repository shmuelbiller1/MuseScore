#!/usr/bin/env python3
"""Generate a small, synthetic 18-part MusicXML timing probe offline.

Usage: python3 expand_to_18.py two-voices.musicxml /path/to/18-parts.musicxml
The score is intentionally unmusical: all 18 tracks must share note onsets.
No manuscript material, network access, third-party packages or randomization.
"""
import copy
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def main(source: Path, destination: Path) -> None:
    root = ET.parse(source).getroot()
    part_list = root.find("part-list")
    parts = root.findall("part")
    if part_list is None or len(parts) != 2 or len(part_list.findall("score-part")) != 2:
        raise ValueError("Expected the two-voice source probe")
    templates = [copy.deepcopy(part) for part in parts]
    for part in parts:
        root.remove(part)
    for child in list(part_list):
        part_list.remove(child)

    for i in range(18):
        part_id = f"P{i + 1}"
        definition = ET.SubElement(part_list, "score-part", id=part_id)
        ET.SubElement(definition, "part-name").text = f"Timing probe {i + 1:02d}"
        # Deliberately omit <midi-instrument>: this is a synchronization
        # test, not a claim about sixteen distinct voice samples/channels.
        part = copy.deepcopy(templates[i % 2])
        part.set("id", part_id)
        # Only the first staff has global tempo directions; no copies of
        # imported text should independently trigger tempo changes.
        if i:
            for measure in part.findall("measure"):
                for direction in measure.findall("direction"):
                    if direction.find("sound[@tempo]") is not None:
                        measure.remove(direction)
        root.append(part)

    ET.indent(root, space="  ")
    destination.write_bytes(b'<?xml version="1.0" encoding="utf-8"?>\n'
                            + ET.tostring(root, encoding="utf-8"))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: expand_to_18.py two-voices.musicxml output.musicxml")
    main(Path(sys.argv[1]), Path(sys.argv[2]))
