#!/usr/bin/env python3
"""Expand the native tempo automation regression fixture to 18 independent parts.

Keeps one copy of system-level tempo markings/fermata/ramp on part 1; all
other parts contain their own distinct pitched notes and independent staff,
part, measure and note identities. Synthetic timing probe, not choir audio.
"""

import copy
import hashlib
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
TPC_BY_PITCH_CLASS = (14, 21, 16, 23, 18, 13, 20, 15, 22, 17, 24, 19)


def eid(label: str) -> str:
    digest = hashlib.sha256(label.encode("utf-8")).digest()
    halves = (int.from_bytes(digest[:8], "little"), int.from_bytes(digest[8:16], "little"))

    def base64_number(n: int) -> str:
        result = ""
        while True:
            result += ALPHABET[n % 64]
            n //= 64
            if n == 0:
                return result

    return "_".join(map(base64_number, halves))


def expand(source: Path, destination: Path) -> None:
    tree = ET.parse(source)
    root = tree.getroot()
    score = root.find("Score")
    if score is None:
        raise ValueError("Expected a native score")
    part = score.find("Part")
    staff = score.find("Staff")
    if part is None or staff is None or len(score.findall("Part")) != 1:
        raise ValueError("Expected the single-part native tempo fixture")
    original_part = copy.deepcopy(part)
    original_staff = copy.deepcopy(staff)
    score.remove(part)
    score.remove(staff)

    # Native scores list all Parts before all Staff measure contents.
    for index in range(18):
        p = copy.deepcopy(original_part)
        p.set("id", str(index + 1))
        for el in p.iter("eid"):
            el.text = eid(f"part:{index}:{el.text}")
        p_staff = p.find("Staff")
        if p_staff is None:
            raise ValueError("Missing part staff")
        for bracket in p_staff.findall("BracketItem"):
            p_staff.remove(bracket)
        for clef in p.findall("./Instrument/clef"):
            p.find("Instrument").remove(clef)
        for path, value in (("./Instrument/InstrumentLabel/longName", f"Part {index + 1:02}"),
                            ("./Instrument/InstrumentLabel/shortName", f"P{index + 1:02}"),
                            ("./Instrument/trackName", f"Part {index + 1:02}")):
            element = p.find(path)
            if element is not None:
                element.text = value
        score.insert(index + list(score).index(score.find("Order")) + 1, p)

    insertion = list(score).index(score.find("SpannerMap"))
    for index in range(18):
        s = copy.deepcopy(original_staff)
        s.set("id", str(index + 1))
        for measure_number, measure in enumerate(s.findall("Measure")):
            if index != 0:
                # Measures are one shared object across staves, not per-staff
                # objects. Only staff 1 may serialize their EID and repeat
                # metadata; setting another EID on the same Measure asserts in
                # EIDRegister::registerItemEID during a native score load.
                for tag in ("eid", "startRepeat", "endRepeat"):
                    element = measure.find(tag)
                    if element is not None:
                        measure.remove(element)
                voice = measure.find("voice")
                if voice is None:
                    raise ValueError("Missing voice")
                for item in list(voice):
                    if item.tag not in ("Chord", "KeySig", "TimeSig"):
                        voice.remove(item)
            for note in measure.iter("Note"):
                pitch = 48 + index + measure_number % 3
                note.find("pitch").text = str(pitch)
                note.find("tpc").text = str(TPC_BY_PITCH_CLASS[pitch % 12])
        for element in s.iter("eid"):
            element.text = eid(f"staff:{index}:{element.text}")
        score.insert(insertion + index, s)

    destination.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(tree, space="  ")
    tree.write(destination, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: expand_native_to_18.py source.mscx destination.mscx")
    expand(Path(sys.argv[1]), Path(sys.argv[2]))
