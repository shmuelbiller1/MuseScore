/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * One human vowel reused for solo bass, unison, and written SATB.
 * Objective F0 only; this does not measure convincing singers or words.
 */
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const { decodeWav } = require('./evaluate-real.cjs');
const { midi } = require('./fixtures.cjs');
const rate = 24000, pitches = [69, 64, 60, 45];
const names = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const filename = 'tenor-m2-long-a.wav';
function evaluate(write = false) {
    const recordings = [{ samples: decodeWav(fs.readFileSync(path.join(__dirname, 'vocalset', filename))) }];
    const score = Studio.parseMidi(midi(pitches));
    const parts = names.map((name, i) => ({ name, track: i + 1, recording: 0,
        cropStart: 0.015, cropEnd: 0.75, correction: 1, volume: 0.65,
        pan: i / 2 - 0.75, ...Studio.defaults[name] }));
    const sourceHz = Studio.estimatePitch(recordings[0].samples, rate, 0.015, 0, 0.75);
    const soloParts = Studio.arrangeParts('solo', score, parts, 0, 4, 3);
    const unisonParts = Studio.arrangeParts('unison', score, parts, 0, 1);
    const harmonyParts = Studio.arrangeParts('choir', score, parts, 0, 1);
    const solo = Studio.render(score, soloParts, recordings, rate, 3);
    const unison = Studio.render(score, unisonParts, recordings, rate, 3);
    const harmony = Studio.render(score, harmonyParts, recordings, rate, 3);
    const measurements = harmonyParts.map((part, i) => {
        const isolated = Studio.render(score, harmonyParts.map((p, j) => ({ ...p, solo: i === j })), recordings, rate, 3);
        const note = score.tracks[part.track].notes[0], target = Studio.hz(note.pitch);
        const measured = Studio.estimatePitch(isolated.left, rate, note.startSeconds + 0.055);
        return { part: part.name, writtenPitch: note.pitch, noteStartSeconds: note.startSeconds,
            noteEndSeconds: note.endSeconds, sourceHz: +sourceHz.toFixed(2),
            targetHz: +target.toFixed(2), measuredHz: +measured.toFixed(2),
            errorCents: +(1200 * Math.log2(measured / target)).toFixed(1),
            peak: +isolated.peak.toFixed(3), warnings: isolated.warnings };
    });
    if (write) {
        const save = (name, mix) => fs.writeFileSync(path.join(__dirname, name),
            Buffer.from(Studio.wav([mix.left, mix.right], rate)));
        save('single-source-solo-bass.wav', solo);
        save('single-source-unison.wav', unison);
        save('single-source-four-written-parts.wav', harmony);
        fs.writeFileSync(path.join(__dirname, 'single-source-metrics.json'), JSON.stringify({
            methodology: 'One ~0.8s human vowel repeatedly synthesized; objective isolated first-note F0 only, NOT realism or four distinct singers',
            source: `VocalSet 1.2, CC BY 4.0: vocalset/${filename}; see vocalset/ATTRIBUTION.md`,
            sampleRate: rate, pitches, warnings: harmony.warnings, measurements
        }, null, 2) + '\n');
    }
    return { solo, unison, harmony, measurements };
}
if (require.main === module) {
    const result = evaluate(true);
    console.table(result.measurements.map(({ part, writtenPitch, errorCents, warnings }) =>
        ({ part, writtenPitch, errorCents, warnings: warnings.length })));
    console.log('Warnings:', result.harmony.warnings);
}
module.exports = { evaluate };
