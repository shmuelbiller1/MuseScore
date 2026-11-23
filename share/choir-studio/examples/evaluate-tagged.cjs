/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Real singer source aligned by two manual tags to two written notes.
 * This vowel has no lyric consonants; F0 is not a listening-quality score.
 */
const fs = require('node:fs');
const path = require('node:path');
const Studio = require('../choir.js');
const Project = require('../project.js');
const { decodeWav } = require('./evaluate-real.cjs');
const { midi, rate } = require('./fixtures.cjs');
const sourceFile = 'vocalset/tenor-m2-long-a.wav';
const tags = [{ start: 0.02, end: 0.35, hz: 0 }, { start: 0.4, end: 0.63, hz: 0 }];
function evaluate(write = false) {
    const samples = decodeWav(fs.readFileSync(path.join(__dirname, sourceFile)));
    const score = Studio.parseMidi(midi([69, 64, 60, 45]));
    const part = { name: 'Tenor', track: 3, recording: 0, volume: 0.7, correction: 1,
        ...Studio.defaults.Tenor, noteTags: tags };
    const mix = Studio.render(score, [part], [{ samples }], rate, 3);
    const measurements = score.tracks[3].notes.map((note, i) => {
        const target = Studio.hz(note.pitch);
        const measured = Studio.estimatePitch(mix.left, rate, note.startSeconds + 0.055);
        return { note: i + 1, midiPitch: note.pitch, scoreStart: note.startSeconds,
            scoreEnd: note.endSeconds, sourceStart: tags[i].start, sourceEnd: tags[i].end,
            targetHz: +target.toFixed(2), measuredHz: +measured.toFixed(2),
            errorCents: +(1200 * Math.log2(measured / target)).toFixed(1) };
    });
    if (write) {
        fs.writeFileSync(path.join(__dirname, 'after-tagged-real-tenor.wav'),
            Buffer.from(Studio.wav([mix.left, mix.right], rate)));
        fs.writeFileSync(path.join(__dirname, 'tagged-real-tenor-metrics.json'), JSON.stringify({
            methodology: 'one real ~0.8s licensed tenor vowel manually tagged to two score notes; objective F0 only, NOT word preservation or realism',
            source: `VocalSet 1.2 CC BY 4.0: ${sourceFile}; see vocalset/ATTRIBUTION.md`,
            warnings: mix.warnings, measurements
        }, null, 2) + '\n');
    }
    return { mix, measurements, warnings: mix.warnings };
}
async function saveSession() {
    const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, i) => ({ name, preset: name,
        track: i + 1, recording: 0, volume: 0.7, pan: 0, correction: 1,
        ...Studio.defaults[name], cropStart: 0, cropEnd: 0, sourceHz: 0,
        variation: false, mute: false, solo: false }));
    const blob = new Blob([fs.readFileSync(path.join(__dirname, sourceFile))], { type: 'audio/wav' });
    const text = await Project.encodeProject({ midiBytes: midi([69, 64, 60, 45]),
        recordings: [{ name: 'tenor-m2-long-a.wav', blob }], parts, tags: [['3:0', tags]],
        controls: { mode: 'solo', melodyTrack: 3, commonSource: 0, soloVoice: 2, tagVoice: 2, phraseMode: true } });
    fs.writeFileSync(path.join(__dirname, 'tagged-real-tenor.choir.json'), text + '\n');
}
if (require.main === module) {
    const result = evaluate(true);
    console.table(result.measurements);
    console.log('Warnings:', result.warnings);
    saveSession().catch(err => { console.error(err); process.exitCode = 1; });
}
module.exports = { evaluate, saveSession };
