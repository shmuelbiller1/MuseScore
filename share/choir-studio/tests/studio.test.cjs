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
const Project = require('../project.js');
const { midi } = require('../examples/fixtures.cjs');
const code = fs.readFileSync(path.join(__dirname, '../studio.js'), 'utf8');

function page(mimeType = 'audio/webm', decodedSamples) {
    const nodes = new Map(), downloads = [], streams = [], urls = [], events = {};
    class Element {
        constructor(tag) { this.tag = tag; this.dataset = {}; this.style = {}; this.children = []; this.disabled = false; this.checked = false; this.value = ''; this.textContent = ''; }
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
    const source = decodedSamples || Float32Array.from({ length: 24000 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 220 * i / 24000));
    class AudioContext {
        constructor(config) { assert.equal(config.sampleRate, 24000); }
        async resume() {}
        async decodeAudioData() {
            return { duration: source.length / 24000, length: source.length, numberOfChannels: 1, getChannelData: () => source };
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
    const window = { ChoirStudio: Studio, ChoirProject: Project, MediaRecorder, addEventListener: (name, callback) => { events[name] = callback; } };
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

function findByTagField(root, field) {
    if (root.dataset?.tagField === field) return root;
    for (const node of root.children || []) {
        const found = findByTagField(node, field);
        if (found) return found;
    }
    return undefined;
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

test('long sung take is auto-voiced; changing a part source resets recording-specific analysis', async () => {
    const samples = new Float32Array(24000 * 2);
    for (let i = 12000; i < 31200; i++) samples[i] = 0.2 * Math.sin(2 * Math.PI * 220 * i / 24000);
    const ui = page('audio/webm', samples);
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => midi() }] } });
    const files = ['voice-1.wav', 'voice-2.wav'].map(name => {
        const file = new Blob([Studio.wav([samples], 24000)], { type: 'audio/wav' });
        Object.assign(file, { name }); return file;
    });
    await ui.$('wav').onchange({ target: { files } });
    assert.match(ui.$('sources').textContent, /auto vowel/);
    assert.match(ui.$('status').textContent, /Automatically selected/);
    const card = ui.$('parts').children[3];
    for (const [field, value] of [['sourceHz', '110'], ['cropStart', '1'], ['cropEnd', '1.4']]) {
        const input = findByField(card, field); input.value = value; card.onchange({ target: input });
    }
    const sourcePicker = findByField(card, 'recording'); sourcePicker.value = '1'; card.onchange({ target: sourcePicker });
    const updated = ui.$('parts').children[3];
    for (const field of ['sourceHz', 'cropStart', 'cropEnd']) assert.equal(findByField(updated, field).value, 0);
    assert.equal(findByField(updated, 'recording').value, 1);
    ui.$('commonSource').value = '0'; ui.$('assignAll').onclick();
    for (const field of ['sourceHz', 'cropStart', 'cropEnd']) assert.equal(findByField(ui.$('parts').children[3], field).value, 0);
    ui.$('arrangementMode').value = 'choir';
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false, ui.$('warning').textContent);
});

test('manual Hz and crop edited after switching shared source are used in solo and unison', async () => {
    const ui = page();
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => midi() }] } });
    const files = ['first.wav', 'second.wav'].map(name => {
        const file = new Blob([Studio.wav([new Float32Array(24000)], 24000)], { type: 'audio/wav' });
        Object.assign(file, { name }); return file;
    });
    await ui.$('wav').onchange({ target: { files } });
    const common = ui.$('commonSource'); common.value = '1'; common.onchange();
    const card = ui.$('parts').children[0];
    assert.equal(findByField(card, 'sourceHz').value, 0);
    for (const [field, value] of [['sourceHz', '220'], ['cropStart', '0.1'], ['cropEnd', '0.5']]) {
        const input = findByField(card, field); input.value = value; card.onchange({ target: input });
    }
    assert.equal(findByField(card, 'recording').value, 1);
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false, ui.$('warning').textContent);
    const mode = ui.$('arrangementMode'); mode.value = 'unison'; mode.onchange();
    assert.equal(findByField(ui.$('parts').children[0], 'cropStart').value, 0.1);
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false, ui.$('warning').textContent);
});

test('editing a voice or arrangement invalidates stale audio and changes during render cannot publish it', async () => {
    const ui = page();
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => midi() }] } });
    const file = new Blob([Studio.wav([new Float32Array(24000)], 24000)], { type: 'audio/wav' });
    Object.assign(file, { name: 'voice.wav' });
    await ui.$('wav').onchange({ target: { files: [file] } });
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false);
    ui.$('listen').onclick();
    const mode = ui.$('arrangementMode'); mode.value = 'unison'; mode.onchange();
    assert.equal(ui.$('listen').disabled, true);
    assert.equal(ui.$('download').disabled, true);
    assert.equal(ui.$('player').src, '');
    const rendering = ui.$('render').onclick();
    const volume = findByField(ui.$('parts').children[0], 'volume'); volume.value = '0.3'; volume.oninput();
    await rendering;
    assert.match(ui.$('warning').textContent, /Settings changed during render/);
    assert.equal(ui.$('listen').disabled, true);
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false);
    const card = ui.$('parts').children[0];
    const preset = findByField(card, 'preset'); preset.value = 'Bass'; card.onchange({ target: preset });
    assert.equal(ui.$('listen').disabled, true);
});

test('tagged singing mode maps source ranges to notes and saves a self-contained reloadable session', async () => {
    const ui = page();
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => midi() }] } });
    const original = new Blob([Studio.wav([new Float32Array(24000)], 24000)], { type: 'audio/wav' });
    Object.assign(original, { name: 'my voice.wav' });
    await ui.$('wav').onchange({ target: { files: [original] } });
    ui.$('phraseMode').checked = true; ui.$('phraseMode').onchange();
    await ui.$('render').onclick();
    assert.match(ui.$('warning').textContent, /tag every written note/);
    ui.$('fillTags').onclick();
    assert.match(ui.$('tagInfo').textContent, /0 untagged/);
    const firstRow = ui.$('tagRows').children[0];
    const begin = findByTagField(firstRow, 'start'); begin.value = '0.02'; firstRow.onchange();
    assert.equal(findByTagField(ui.$('tagRows').children[0], 'start').value, 0.02);
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false, ui.$('warning').textContent);
    ui.$('download').onclick();
    const firstMix = ui.urls.find(u => u.url === ui.downloads.at(-1).url).blob;
    await ui.$('saveProject').onclick();
    assert.match(ui.$('status').textContent, /Saved original recordings/, ui.$('warning').textContent);
    const session = ui.urls.find(u => u.url === ui.downloads.at(-1).url).blob;
    assert.equal(ui.downloads.at(-1).name, 'personal-voice-choir.choir.json');
    assert.equal(session.type, 'application/json');
    const restored = page();
    await restored.$('openProject').onchange({ target: { files: [session] } });
    assert.match(restored.$('status').textContent, /Session restored locally/);
    assert.equal(restored.$('phraseMode').checked, true);
    assert.equal(restored.$('melodyTrack').value, '1');
    assert.equal(findByTagField(restored.$('tagRows').children[0], 'start').value, 0.02);
    restored.$('saveOriginal').onclick();
    const restoredOriginal = restored.urls.find(u => u.url === restored.downloads.at(-1).url).blob;
    assert.deepEqual(Buffer.from(await restoredOriginal.arrayBuffer()), Buffer.from(await original.arrayBuffer()));
    await restored.$('render').onclick();
    assert.equal(restored.$('listen').disabled, false, restored.$('warning').textContent);
    restored.$('download').onclick();
    const secondMix = restored.urls.find(u => u.url === restored.downloads.at(-1).url).blob;
    assert.deepEqual(Buffer.from(await firstMix.arrayBuffer()), Buffer.from(await secondMix.arrayBuffer()));
    await restored.$('openProject').onchange({ target: { files: [new Blob(['{bad'])] } });
    assert.match(restored.$('warning').textContent, /existing session retained/);
    assert.equal(restored.$('phraseMode').checked, true);
    const corrupted = JSON.parse(await session.text()); corrupted.tags[0][1].pop();
    await restored.$('openProject').onchange({ target: { files: [new Blob([JSON.stringify(corrupted)])] } });
    assert.match(restored.$('warning').textContent, /tags do not match the score/);
    assert.equal(findByTagField(restored.$('tagRows').children[0], 'start').value, 0.02);
});

test('waveform drag and move controls place a source segment under the selected written note', async () => {
    const ui = page();
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => midi() }] } });
    const file = new Blob([Studio.wav([new Float32Array(24000)], 24000)], { type: 'audio/wav' });
    Object.assign(file, { name: 'take.wav' });
    await ui.$('wav').onchange({ target: { files: [file] } });
    ui.$('waveStart').value = '0'; ui.$('waveEnd').value = '1';
    const wave = ui.$('tagWave'); wave.getBoundingClientRect = () => ({ left: 0, width: 900 });
    wave.onpointerdown({ clientX: 180, pointerId: 1 });
    wave.onpointerup({ clientX: 360, pointerId: 1 });
    assert.equal(findByTagField(ui.$('tagRows').children[0], 'start').value, 0.2);
    assert.equal(findByTagField(ui.$('tagRows').children[0], 'end').value, 0.4);
    const row = ui.$('tagRows').children[0];
    row.children.find(child => child.textContent === '50 ms →').onclick();
    assert.equal(findByTagField(ui.$('tagRows').children[0], 'start').value, 0.25);
    const preview = ui.$('tagRows').children[0].children.find(child => child.textContent === 'Hear tagged source');
    await preview.onclick();
    assert.equal(ui.$('tagPlayer').currentTime, 0.25);
});

test('one imported take can be tagged separately for all four independent SATB score tracks', async () => {
    const ui = page();
    await ui.$('midi').onchange({ target: { files: [{ arrayBuffer: async () => midi() }] } });
    const file = new Blob([Studio.wav([new Float32Array(24000)], 24000)], { type: 'audio/wav' });
    Object.assign(file, { name: 'one-take.wav' });
    await ui.$('wav').onchange({ target: { files: [file] } });
    const mode = ui.$('arrangementMode'); mode.value = 'choir'; mode.onchange();
    ui.$('phraseMode').checked = true; ui.$('phraseMode').onchange();
    for (let i = 0; i < 4; i++) {
        ui.$('tagVoice').value = String(i); ui.$('tagVoice').onchange();
        assert.match(ui.$('tagInfo').textContent, new RegExp(['Soprano', 'Alto', 'Tenor', 'Bass'][i]));
        ui.$('fillTags').onclick();
        assert.match(ui.$('tagInfo').textContent, /0 untagged/);
    }
    await ui.$('render').onclick();
    assert.equal(ui.$('listen').disabled, false, ui.$('warning').textContent);
    assert.match(ui.$('status').textContent, /Rendered/);
    await ui.$('saveProject').onclick();
    const session = ui.urls.find(u => u.url === ui.downloads.at(-1).url).blob;
    const restored = page();
    await restored.$('openProject').onchange({ target: { files: [session] } });
    assert.equal(restored.$('arrangementMode').value, 'choir');
    await restored.$('render').onclick();
    assert.equal(restored.$('listen').disabled, false, restored.$('warning').textContent);
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
