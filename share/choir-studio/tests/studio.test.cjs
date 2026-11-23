/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Browser event tests with a small DOM stand-in; no network or browser install.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Studio = require('../choir.js');
const { midi } = require('../examples/fixtures.cjs');
const code = fs.readFileSync(path.join(__dirname, '../studio.js'), 'utf8');

function page(mimeType = 'audio/webm') {
    const nodes = new Map(), downloads = [], streams = [], urls = [], events = {};
    class Element {
        constructor(tag) { this.tag = tag; this.dataset = {}; this.style = {}; this.children = []; this.disabled = false; this.value = ''; this.textContent = ''; }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.children = [...children]; }
        get options() { return this.children.filter(child => child.tag === 'option'); }
        click() { downloads.push({ url: this.href, name: this.download }); }
        pause() {}
        async play() {}
    }
    const document = {
        getElementById: id => { if (!nodes.has(id)) nodes.set(id, new Element(id)); return nodes.get(id); },
        createElement: tag => new Element(tag),
        querySelectorAll: selector => {
            const field = selector.match(/^#parts select\[data-field="(track|recording)"\]$/)?.[1];
            assert.ok(field, `unexpected selector: ${selector}`);
            return nodes.get('parts').children.map(card => findByField(card, field));
        }
    };
    document.getElementById('arrangementMode').value = 'solo';
    const source = Float32Array.from({ length: 24000 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 220 * i / 24000));
    class AudioContext {
        constructor(config) { assert.equal(config.sampleRate, 24000); }
        async resume() {}
        async decodeAudioData() {
            return { duration: 1, length: source.length, numberOfChannels: 1, getChannelData: () => source };
        }
    }
    let requests = 0, releasePermission;
    const getUserMedia = () => {
        ++requests;
        return new Promise(resolve => {
            releasePermission = () => {
                const track = { stopped: false, stop() { this.stopped = true; } };
                const stream = { getTracks: () => [track], track };
                streams.push(stream); resolve(stream);
            };
        });
    };
    class MediaRecorder {
        constructor(stream) { this.stream = stream; this.mimeType = mimeType; this.state = 'inactive'; }
        start() { this.state = 'recording'; }
        stop() {
            this.state = 'inactive';
            this.ondataavailable({ data: new Blob(['capture'], { type: this.mimeType }) });
            this.onstop();
        }
    }
    const window = { ChoirStudio: Studio, MediaRecorder, addEventListener: (name, callback) => { events[name] = callback; } };
    const URL = {
        createObjectURL: blob => { const url = `blob:local-${urls.length}`; urls.push({ url, blob }); return url; },
        revokeObjectURL: () => {}
    };
    vm.runInNewContext(code, { document, window, navigator: { mediaDevices: { getUserMedia } },
        AudioContext, MediaRecorder, Blob, URL,
        setTimeout: (callback, ms) => { const timer = setTimeout(callback, ms); if (ms > 5000) timer.unref(); return timer; }, console });
    const $ = document.getElementById;
    return { $, streams, downloads, urls, events, get requests() { return requests; },
        get releasePermission() { return releasePermission; } };
}

function onePartMidi() {
    const bytes = midi();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const firstNote = 14 + 8 + view.getUint32(18);
    const end = firstNote + 8 + view.getUint32(firstNote + 4);
    const reduced = bytes.slice(0, end);
    reduced[10] = 0; reduced[11] = 2; // conductor + one written part
    return reduced;
}

function findByField(root, field) {
    if (root.dataset?.field === field) return root;
    for (const node of root.children || []) {
        const found = findByField(node, field);
        if (found) return found;
    }
    return undefined;
}

test('loading conductor MIDI selects four distinct note tracks and can render immediately', async () => {
    const ui = page();
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => midi() }] } });
    const tracks = ui.$('parts').children.map(card => Number(findByField(card, 'track').value));
    assert.deepEqual(tracks, [1, 2, 3, 4]);
    const wav = new Blob([Studio.wav([new Float32Array(24000)], 24000)], { type: 'audio/wav' });
    Object.assign(wav, { name: 'vowel.wav' });
    await ui.$('wav').onchange({ target: { files: [wav] } });
    assert.equal(ui.$('sources').textContent.includes('vowel.wav'), true);
    // Default solo follows one selected score track and source.
    assert.equal(ui.$('melodyTrack').value, '1');
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false);
    assert.equal(ui.$('warning').textContent.includes('Choose four different'), false);
});

test('solo renders a MIDI with only one written part; SATB refuses to invent the rest', async () => {
    const ui = page();
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => onePartMidi() }] } });
    assert.equal(ui.$('melodyTrack').options.length, 1);
    assert.equal(ui.$('melodyTrack').value, '1');
    const file = new Blob([Studio.wav([new Float32Array(24000)], 24000)], { type: 'audio/wav' });
    Object.assign(file, { name: 'solo.wav' });
    await ui.$('wav').onchange({ target: { files: [file] } });
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false, ui.$('warning').textContent);
    ui.$('arrangementMode').value = 'choir';
    await ui.$('render').onclick();
    assert.match(ui.$('warning').textContent, /four different written-note tracks/);
});

test('solo/choir/unison picker switches track editing and rejects duplicate SATB mapping', async () => {
    const ui = page();
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => midi() }] } });
    const file = new Blob([Studio.wav([new Float32Array(24000)], 24000)], { type: 'audio/wav' });
    Object.assign(file, { name: 'voice.wav' });
    await ui.$('wav').onchange({ target: { files: [file] } });
    const mode = ui.$('arrangementMode');
    assert.equal(findByField(ui.$('parts').children[0], 'track').disabled, true);
    mode.value = 'choir'; mode.onchange();
    assert.equal(findByField(ui.$('parts').children[0], 'track').disabled, false);
    const bassCard = ui.$('parts').children[3];
    const bassTrack = findByField(bassCard, 'track'); bassTrack.value = '1';
    bassCard.onchange({ target: bassTrack });
    await ui.$('render').onclick();
    assert.match(ui.$('warning').textContent, /four different written-note tracks/);
    mode.value = 'unison'; mode.onchange();
    assert.match(ui.$('modeInfo').textContent, /not SATB harmony/);
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false);
});

test('four imported source files map one-to-one in picker order', async () => {
    const ui = page();
    const files = [1, 2, 3, 4].map(i => {
        const file = new Blob([Studio.wav([new Float32Array(24000)], 24000)], { type: 'audio/wav' });
        Object.assign(file, { name: `source-${i}.wav` });
        return file;
    });
    await ui.$('wav').onchange({ target: { files } });
    const sources = ui.$('parts').children.map(card => Number(findByField(card, 'recording').value));
    assert.deepEqual(sources, [0, 1, 2, 3]);
    assert.ok(ui.$('status').textContent.includes('Check each part'));
    ui.$('commonSource').value = '2';
    ui.$('assignAll').onclick();
    assert.deepEqual(ui.$('parts').children.map(card => Number(findByField(card, 'recording').value)),
        [2, 2, 2, 2]);
    assert.match(ui.$('status').textContent, /all four voice characters/);
});
test('switching timbre preset retains selected label and changes tone, not MIDI track', async () => {
    const ui = page();
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => midi() }] } });
    const card = ui.$('parts').children[0], preset = findByField(card, 'preset');
    preset.value = 'Bass';
    card.onchange({ target: preset });
    const updated = ui.$('parts').children[0];
    assert.equal(findByField(updated, 'preset').value, 'Bass');
    assert.equal(findByField(updated, 'track').value, 1);
    assert.equal(findByField(updated, 'formant').value, Studio.defaults.Bass.formant);
});
test('Safari MP4 microphone captures keep the correct extension and exact original bytes', async () => {
    const ui = page('audio/mp4');
    const recording = ui.$('record').onclick();
    ui.releasePermission();
    await recording;
    ui.$('stop').onclick();
    await new Promise(resolve => setImmediate(resolve));
    ui.$('saveOriginal').onclick();
    const saved = ui.downloads.at(-1);
    assert.ok(saved.name.endsWith('.m4a'), saved.name);
    assert.equal(ui.urls.find(item => item.url === saved.url).blob.type, 'audio/mp4');
    assert.equal(ui.streams[0].track.stopped, true);
});
test('repeated record clicks while permission is pending cannot leak a second microphone', async () => {
    const ui = page();
    const first = ui.$('record').onclick();
    const second = ui.$('record').onclick();
    assert.equal(ui.requests, 1);
    assert.equal(ui.$('record').disabled, true);
    ui.releasePermission();
    await Promise.all([first, second]);
    assert.equal(ui.streams.length, 1);
    assert.equal(ui.$('stop').disabled, false);
    ui.$('stop').onclick();
    assert.equal(ui.streams[0].track.stopped, true);
    assert.equal(ui.$('stop').disabled, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.$('record').disabled, false);
    assert.equal(ui.$('sources').textContent.includes('Microphone'), true);
    ui.$('saveWav').onclick();
    const saved = ui.downloads.at(-1);
    assert.ok(saved.name.endsWith('-reimport.wav'));
    assert.equal(ui.urls.find(item => item.url === saved.url).blob.type, 'audio/wav');
});
