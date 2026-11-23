/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Objective pitch measurements on four licensed human singing vowels.
 * F0 accuracy does not establish a realistic or youthful vocal timbre.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Studio = require('../choir.js');
const { decodeWav, evaluate } = require('../examples/evaluate-real.cjs');
const root = path.join(__dirname, '../examples');
const singers = {
    'soprano-f1-a.wav': 'bae7ab0db7fbded865bda483ea618417b83b4138fcb382bd6499e5bb0fe2e3b3',
    'alto-f5-a.wav': '1437fdd9b67efddcb1d61a5613ebef49c35e328acb07729eccb9dd7a8f07bd79',
    'tenor-m2-a.wav': '046adf9e94e0a9e2e2e32878d6a37867f6a89bfef09cf666490bbc11e6c4c296',
    'bass-m8-a.wav': '37db645d4b2488e9b60e73436c1d6b8f279e75fd4a943b549c9cded78ff7f572'
};
test('human VocalSet input clips match attributed sources and contain audible signals', () => {
    for (const [file, expected] of Object.entries(singers)) {
        const input = fs.readFileSync(path.join(root, 'vocalset', file));
        assert.equal(createHash('sha256').update(input).digest('hex'), expected);
        const pcm = decodeWav(input);
        assert.equal(pcm.length, 1920);
        assert.ok(pcm.some(sample => Math.abs(sample) > 0.1), `${file} is silent`);
    }
});
test('real vowel outputs follow independent written F0 and the demo mix is reproducible', () => {
    const { mix, measurements, warnings } = evaluate();
    assert.equal(measurements.length, 4);
    assert.deepEqual(measurements.map(m => m.midiPitch), [69, 64, 60, 57]);
    assert.ok(measurements.every(m => Math.abs(m.errorCents) < 15 && m.peak > 0.05),
        JSON.stringify(measurements));
    assert.ok(warnings.some(w => w.includes('Alto') && w.includes('extreme')),
        'do not hide the unnatural alto source-to-note shift');
    assert.deepEqual(fs.readFileSync(path.join(root, 'four-part-real-vowel-mix.wav')),
        Buffer.from(Studio.wav([mix.left, mix.right], 24000)));
    const committed = JSON.parse(fs.readFileSync(path.join(root, 'real-vowel-metrics.json'), 'utf8'));
    assert.deepEqual(committed.measurements, measurements);
    assert.deepEqual(committed.warnings, warnings);
});
