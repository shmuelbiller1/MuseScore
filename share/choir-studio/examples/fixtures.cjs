/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Deterministic synthetic test fixtures, not real singers.
 */
const rate = 24000;
function source(frequency = 220, length = 0.65) {
    return Float32Array.from({ length: Math.floor(rate * length) }, (_, i) => {
        const t = i / rate, phase = 2 * Math.PI * frequency * t;
        return 0.22 * (Math.sin(phase) + 0.32 * Math.sin(2 * phase) + 0.18 * Math.sin(3 * phase));
    });
}
function v(n) { const bytes = [n & 127]; while ((n >>= 7)) bytes.unshift((n & 127) | 128); return bytes; }
function be(n, width) { return Array.from({ length: width }, (_, i) => (n >>> (8 * (width - i - 1))) & 255); }
function chunk(label, bytes) { return [...Buffer.from(label), ...be(bytes.length, 4), ...bytes]; }
function midi(pitches = [69, 64, 60, 57]) {
    const header = [...Buffer.from('MThd'), ...be(6, 4), ...be(1, 2), ...be(5, 2), ...be(480, 2)];
    const tempo = [0, 255, 81, 3, 7, 161, 32, ...v(480), 255, 81, 3, 3, 208, 144, 0, 255, 47, 0];
    const tracks = [chunk('MTrk', tempo)];
    // Distinct pitches, different onsets, independent note gates and rests.
    for (let part = 0; part < 4; ++part) {
        const start = part * 120, pitch = pitches[part];
        const name = Buffer.from(['Soprano', 'Alto', 'Tenor', 'Bass'][part]);
        const bytes = [0, 255, 3, name.length, ...name,
            ...v(start), 144, pitch, 85 - part * 8,
            ...v(240), 128, pitch, 0,
            ...v(480), 144, pitch + 2, 91,
            ...v(240), 128, pitch + 2, 0,
            0, 255, 47, 0];
        tracks.push(chunk('MTrk', bytes));
    }
    return Uint8Array.from([...header, ...tracks.flat()]);
}
module.exports = { rate, source, midi };
