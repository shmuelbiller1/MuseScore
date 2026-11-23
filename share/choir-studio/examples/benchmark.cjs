/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Optional local resource probe, not a Windows benchmark or quality test.
 */
const Studio = require('../choir.js');
const { midi, source } = require('./fixtures.cjs');
const rate = 24000, repetitions = 120;
const score = Studio.parseMidi(midi());
score.tracks.forEach(track => {
    const notes = track.notes;
    track.notes = Array.from({ length: repetitions }, (_, iteration) => notes.map(note => ({ ...note,
        tick: note.tick + iteration * 960, startSeconds: note.startSeconds + iteration,
        endSeconds: note.endSeconds + iteration }))).flat();
});
const parts = ['Soprano', 'Alto', 'Tenor', 'Bass'].map((name, index) => ({ name, track: index + 1,
    recording: 0, sourceHz: 220, correction: 1, ...Studio.defaults[name] }));
const start = process.hrtime.bigint(), rssBefore = process.memoryUsage().rss;
const mix = Studio.render(score, parts, [{ samples: source() }], rate, 240);
const seconds = Number(process.hrtime.bigint() - start) / 1e9;
console.log(JSON.stringify({ platform: process.platform, runtime: process.version, cpu: process.arch,
    noteEvents: score.tracks.reduce((sum, track) => sum + track.notes.length, 0),
    outputSeconds: mix.left.length / rate, outputSamplesPerChannel: mix.left.length,
    runtimeSeconds: +seconds.toFixed(3), rssBeforeMB: +(rssBefore / 1048576).toFixed(1),
    rssAfterMB: +(process.memoryUsage().rss / 1048576).toFixed(1),
    peak: +mix.peak.toFixed(3), limitation: 'synthetic source, Node on this host only; not a Windows portable result' }, null, 2));
