/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Audition explicit note pitch edits and same-mode key transposition.
 * Real VocalSet vowel F0 only; neither phrase realism nor lyric quality.
 */
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const { decodeWav } = require('./evaluate-real.cjs');
const { midi, rate } = require('./fixtures.cjs');
const sourceFile = path.join(__dirname, 'vocalset/soprano-f1-long-a.wav');
function evaluate(write = false) {
    const samples = decodeWav(fs.readFileSync(sourceFile));
    const score = Studio.parseMidi(midi([69, 64, 60, 45]));
    const base = { name: 'Soprano', track: 1, recording: 0, volume: 0.7, correction: 1,
        ...Studio.defaults.Soprano, noteTags: [{ start: 0.02, end: 0.35, hz: 0 }, { start: 0.4, end: 0.63, hz: 0 }] };
    const versions = [
        { id: 'A4-to-B4', description: 'written A4 explicitly changed to B4; second written B4 unchanged',
            part: { ...base, pitchDeltas: [2, 0] } },
        { id: 'A-minor-to-G-minor', description: 'same-mode global transposition −2 semitones: A4→G4, B4→A4',
            part: { ...base, transposeSemitones: Studio.keySemitones('9:minor', '7:minor') } }
    ];
    const results = versions.map(version => {
        const mix = Studio.render(score, [version.part], [{ samples }], rate, 3);
        const measurements = score.tracks[1].notes.map((note, i) => {
            const pitch = Studio.outputPitch(note, version.part, i), target = Studio.hz(pitch);
            const measured = Studio.estimatePitch(mix.left, rate, note.startSeconds + 0.055);
            return { note: i + 1, originalMidi: note.pitch, outputMidi: pitch,
                originalName: Studio.noteName(note.pitch), outputName: Studio.noteName(pitch),
                scoreStartSeconds: note.startSeconds, targetHz: +target.toFixed(2),
                measuredHz: +measured.toFixed(2), errorCents: +(1200 * Math.log2(measured / target)).toFixed(1) };
        });
        if (write) fs.writeFileSync(path.join(__dirname, `after-tagged-${version.id}.wav`),
            Buffer.from(Studio.wav([mix.left, mix.right], rate)));
        return { id: version.id, description: version.description, mix, measurements, warnings: mix.warnings };
    });
    if (write) fs.writeFileSync(path.join(__dirname, 'pitch-edit-metrics.json'), JSON.stringify({
        methodology: 'real CC BY 4.0 soprano vowel, manually tagged to two notes; measured sustained F0, not perceived singer quality',
        source: 'vocalset/soprano-f1-long-a.wav; see vocalset/ATTRIBUTION.md',
        versions: results.map(({ id, description, measurements, warnings }) => ({ id, description, measurements, warnings }))
    }, null, 2) + '\n');
    return results;
}
if (require.main === module) for (const result of evaluate(true)) {
    console.log(result.description); console.table(result.measurements); console.log(result.warnings);
}
module.exports = { evaluate };
