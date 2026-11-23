/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Real VocalSet *longer* excerpt study. Pitch metrics are not a listening test.
 */
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const { decodeWav } = require('./evaluate-real.cjs');
const { midi } = require('./fixtures.cjs');
const rate = 24000, pitches = [69, 64, 60, 45];
const names = ['Soprano', 'Alto', 'Tenor', 'Bass'];
const files = ['soprano-f1-long-a.wav', 'alto-f5-long-a.wav', 'tenor-m2-long-a.wav', 'bass-m8-long-a.wav'];
function evaluate(write = false) {
    const recordings = files.map(file => ({ samples: decodeWav(fs.readFileSync(path.join(__dirname, 'vocalset', file))) }));
    const score = Studio.parseMidi(midi(pitches));
    const parts = names.map((name, i) => ({ name, track: i + 1, recording: i,
        cropStart: 0.015, cropEnd: 0.75, correction: 1, volume: 0.65, pan: i / 2 - 0.75, ...Studio.defaults[name] }));
    const measurements = [];
    for (let i = 0; i < 4; ++i) {
        const note = score.tracks[i + 1].notes[0], target = Studio.hz(note.pitch);
        const source = Studio.estimatePitch(recordings[i].samples, rate, 0.015, 0, 0.75);
        const isolated = Studio.render(score, parts.map((part, n) => ({ ...part, solo: i === n })), recordings, rate, 3);
        const observed = Studio.estimatePitch(isolated.left, rate, note.startSeconds + 0.055);
        measurements.push({ part: names[i], singer: files[i], sourceHz: +source.toFixed(2),
            midiPitch: note.pitch, targetHz: +target.toFixed(2), measuredHz: +observed.toFixed(2),
            errorCents: +(1200 * Math.log2(observed / target)).toFixed(1),
            noteStartSeconds: note.startSeconds, noteEndSeconds: note.endSeconds, peak: +isolated.peak.toFixed(3) });
    }
    const mix = Studio.render(score, parts, recordings, rate, 3);
    if (write) {
        const soprano = Studio.shape(Studio.vowelNote(recordings[0].samples, rate,
            measurements[0].sourceHz, Studio.hz(69), Math.round(rate * 0.5), parts[0]), rate, parts[0]);
        fs.writeFileSync(path.join(__dirname, 'after-long-soprano-A4.wav'),
            Buffer.from(Studio.wav([soprano], rate)));
        fs.writeFileSync(path.join(__dirname, 'four-part-long-vowel-mix.wav'),
            Buffer.from(Studio.wav([mix.left, mix.right], rate)));
        fs.writeFileSync(path.join(__dirname, 'four-independent-real-registers.mid'), Buffer.from(midi(pitches)));
        fs.writeFileSync(path.join(__dirname, 'long-vowel-metrics.json'), JSON.stringify({
            methodology: 'objective F0 for four short notes from distinct ~0.8s CC BY 4.0 human vowels; not perceived realism',
            source: 'VocalSet 1.2, CC BY 4.0 (see vocalset/ATTRIBUTION.md)',
            sampleRate: rate, durationSeconds: mix.left.length / rate, warnings: mix.warnings, measurements
        }, null, 2) + '\n');
    }
    return { mix, measurements, warnings: mix.warnings };
}
if (require.main === module) {
    const result = evaluate(true);
    console.log('Longer real vowel excerpts; objective F0 only, NOT realism:');
    console.table(result.measurements);
    console.log('Warnings:', result.warnings);
}
module.exports = { evaluate };
