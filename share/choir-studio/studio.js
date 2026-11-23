/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Browser-only UI: no network calls, no model download, no accounts.
 */
(() => {
    'use strict';
    const $ = id => document.getElementById(id), names = ['Soprano', 'Alto', 'Tenor', 'Bass'];
    const rate = 24000, recordings = [], assignments = [], Studio = window.ChoirStudio;
    let score, context, mediaRecorder, micStream, processedUrl, recordPending = false, renderPending = false;
    async function audio() { if (!context) context = new AudioContext({ sampleRate: rate }); await context.resume(); return context; }
    const status = text => { $('status').textContent = text; };
    const warning = text => { $('warning').textContent = text; };
    async function addRecording(blob, name) {
        const ctx = await audio();
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
        if (buffer.duration < 0.06 || buffer.duration > 90) throw Error('Recording must be between 60 ms and 90 seconds');
        const samples = new Float32Array(buffer.length);
        for (let c = 0; c < buffer.numberOfChannels; ++c) {
            const channel = buffer.getChannelData(c);
            for (let i = 0; i < samples.length; ++i) samples[i] += channel[i] / buffer.numberOfChannels;
        }
        // Never overwrite or re-encode the original capture. The PCM working
        // buffer is separate from the user's original Blob.
        const saved = blob;
        const index = recordings.push({ name, samples, blob: saved, url: URL.createObjectURL(saved) }) - 1;
        const choice = document.createElement('option'); choice.value = String(index); choice.textContent = name; $('originalChoice').append(choice);
        $('sources').textContent = recordings.map((r, i) => `${i + 1}. ${r.name} (${(r.samples.length / rate).toFixed(1)} s)`).join(' · ');
        refresh(); status('Source ready. Select a voiced vowel region; pitch detection can be overridden in Hz.');
    }
    $('wav').onchange = async event => {
        const first = recordings.length;
        for (const file of event.target.files) {
            try {
                const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
                if (String.fromCharCode(...head.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...head.slice(8, 12)) !== 'WAVE') throw Error('Choose a RIFF WAV file');
                await addRecording(file, file.name);
            } catch (err) { warning(`${file.name}: ${err.message}`); }
        }
        if (first === 0 && recordings.length >= 4) {
            assignments.forEach((part, i) => { part.recording = i; });
            refresh();
            status('Assigned imported sources in file order. Check each part’s source before rendering.');
        }
    };
    $('record').onclick = async () => {
        if (recordPending || mediaRecorder) return;
        recordPending = true;
        $('record').disabled = true;
        let stream;
        try {
            if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error('Microphone unavailable. Open this local file in a secure browser context or import WAV.');
            status('Requesting microphone permission…');
            stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false }, video: false });
            const chunks = [], recorder = new MediaRecorder(stream);
            micStream = stream;
            mediaRecorder = recorder;
            recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
            recorder.onerror = event => {
                warning(event.error?.message || 'Microphone capture failed');
                if (recorder.state === 'recording') recorder.stop();
            };
            recorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                if (micStream === stream) micStream = undefined;
                if (mediaRecorder === recorder) mediaRecorder = undefined;
                $('record').disabled = false; $('stop').disabled = true;
                try { if (chunks.length) await addRecording(new Blob(chunks, { type: recorder.mimeType }), `Microphone ${new Date().toLocaleTimeString()}`); }
                catch (err) { warning(err.message); }
            };
            recorder.start(); $('stop').disabled = false; status('Recording locally. Sing a steady vowel; stop to keep the original.');
        } catch (err) {
            warning(err.message); stream?.getTracks().forEach(track => track.stop());
            if (micStream === stream) micStream = undefined;
            mediaRecorder = undefined; $('record').disabled = false; $('stop').disabled = true;
        } finally { recordPending = false; }
    };
    $('stop').onclick = () => { if (mediaRecorder?.state === 'recording') { $('stop').disabled = true; mediaRecorder.stop(); } };
    window.addEventListener('pagehide', () => {
        if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
        micStream?.getTracks().forEach(track => track.stop());
    });
    $('playOriginal').onclick = async () => {
        const source = recordings[Number($('originalChoice').value)]; if (!source) return warning('Import or record first');
        $('player').pause(); $('player').src = source.url; await $('player').play(); status('Playing unchanged original');
    };
    $('saveOriginal').onclick = () => {
        const source = recordings[Number($('originalChoice').value)]; if (!source) return warning('Import or record first');
        const link = document.createElement('a'); link.href = source.url;
        const name = source.name.replace(/[^a-z0-9._-]/gi, '_');
        link.download = /\.(wav|webm|ogg)$/i.test(name) ? name : name + (source.blob.type.includes('ogg') ? '.ogg' : '.webm');
        link.click();
    };
    $('saveWav').onclick = () => {
        const source = recordings[Number($('originalChoice').value)]; if (!source) return warning('Import or record first');
        const url = URL.createObjectURL(new Blob([Studio.wav([source.samples], rate)], { type: 'audio/wav' }));
        const link = document.createElement('a'); link.href = url;
        link.download = source.name.replace(/[^a-z0-9._-]/gi, '_').replace(/\.[^.]*$/, '') + '-reimport.wav';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    };
    $('midi').onchange = async event => {
        try {
            score = Studio.parseMidi(await event.target.files[0].arrayBuffer());
            const available = Studio.noteTrackIndices(score);
            // A tempo-only conductor track must not duplicate Soprano/Alto.
            assignments.forEach((part, i) => { part.track = available[i] ?? -1; });
            $('scoreInfo').textContent = `${score.tracks.length} MIDI tracks; ${available.length} contain notes. Map four distinct tracks below. Tempo changes and rests follow this exported file.`;
            if (available.length < 4) warning('This MIDI contains fewer than four note tracks; export the four-part score first.');
            else warning('');
            refresh();
        } catch (err) { score = undefined; warning(err.message); }
    };
    function makeSlider(label, key, min, max, step, value) {
        const wrapper = document.createElement('label'), input = document.createElement('input'), display = document.createElement('span');
        input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value; input.dataset.field = key;
        display.textContent = `${label}: ${value}`; input.oninput = () => { display.textContent = `${label}: ${input.value}`; };
        wrapper.append(display, input); return wrapper;
    }
    function refresh() {
        const parent = $('parts'); parent.replaceChildren();
        names.forEach((name, index) => {
            const part = assignments[index] || { name, preset: name, track: index, recording: 0, volume: 0.7, pan: 0,
                correction: 1, ...Studio.defaults[name], cropStart: 0, cropEnd: 0, sourceHz: 0, variation: false, mute: false, solo: false };
            assignments[index] = part;
            const card = document.createElement('article'), heading = document.createElement('h3'); heading.textContent = name; card.append(heading);
            const labeled = (title, element) => { const label = document.createElement('label'); label.textContent = title; label.append(element); card.append(label); return element; };
            const track = document.createElement('select'); track.dataset.field = 'track';
            (score?.tracks || []).forEach((t, i) => { if (t.notes.length) { const option = document.createElement('option'); option.value = i; option.textContent = `${i + 1}: ${t.name} (${t.notes.length} notes)`; track.append(option); } });
            if (score && !score.tracks[part.track]?.notes.length) part.track = Number(track.options[index]?.value ?? -1);
            track.value = part.track; labeled('Written score track', track);
            const source = document.createElement('select'); source.dataset.field = 'recording'; recordings.forEach((r, i) => {
                const opt = document.createElement('option'); opt.value = i; opt.textContent = r.name; source.append(opt);
            }); source.value = part.recording; labeled('Vocal source', source);
            const preset = document.createElement('select'); preset.dataset.field = 'preset';
            names.forEach(n => { const opt = document.createElement('option'); opt.value = n; opt.textContent = n + ' starting character'; preset.append(opt); });
            preset.value = part.preset; labeled('Timbre preset', preset);
            card.append(makeSlider('Volume', 'volume', 0, 1, 0.01, part.volume), makeSlider('Pan', 'pan', -1, 1, 0.01, part.pan),
                makeSlider('Pitch correction', 'correction', 0, 1, 0.01, part.correction), makeSlider('Formant', 'formant', 0.7, 1.3, 0.01, part.formant));
            for (const key of ['brightness', 'warmth', 'breathiness', 'resonance', 'strength']) card.append(makeSlider(key, key, 0, 1, 0.01, part[key]));
            for (const [label, key] of [['Source Hz (0 = detect)', 'sourceHz'], ['Vowel start (seconds)', 'cropStart'], ['Vowel end (0 = end)', 'cropEnd']]) {
                const input = document.createElement('input'); input.type = 'number'; input.min = 0; input.step = 0.01; input.value = part[key]; input.dataset.field = key; input.style.width = '95px'; labeled(label, input);
            }
            for (const key of ['variation', 'solo', 'mute']) {
                const input = document.createElement('input'); input.type = 'checkbox'; input.checked = part[key]; input.dataset.field = key; labeled(key, input);
            }
            card.onchange = event => {
                const { field } = event.target.dataset; if (!field) return;
                if (field === 'preset') {
                    part.preset = event.target.value;
                    Object.assign(part, Studio.defaults[part.preset]); refresh();
                } else part[field] = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
            };
            parent.append(card);
        });
    }
    refresh();
    $('render').onclick = async () => {
        if (renderPending) return;
        renderPending = true; $('render').disabled = true;
        try {
            if (!score || recordings.length === 0) throw Error('Load both MIDI and a WAV or microphone recording first');
            if (assignments.some(p => !score.tracks[p.track]?.notes.length)
                || new Set(assignments.map(p => p.track)).size !== 4) throw Error('Choose four different written-note tracks');
            status('Rendering locally…'); warning(''); await new Promise(resolve => setTimeout(resolve, 20));
            const partSnapshot = assignments.map(part => ({ ...part }));
            const mix = await Studio.renderAsync(score, partSnapshot, recordings.slice(), rate, 240,
                step => status(`Rendering locally… ${step.completed}/${step.total} notes`));
            if (mix.peak < 0.001) throw Error('Rendered silence; choose an audible voiced source and non-muted tracks');
            if (processedUrl) URL.revokeObjectURL(processedUrl);
            processedUrl = URL.createObjectURL(new Blob([Studio.wav([mix.left, mix.right], rate)], { type: 'audio/wav' }));
            $('listen').disabled = $('download').disabled = false;
            status(`Rendered ${(mix.left.length / rate).toFixed(2)} seconds; peak ${mix.peak.toFixed(3)}. Original source unchanged.`);
            warning(mix.warnings.slice(0, 8).join('\n') || 'Experimental vowel rendering: audition for artifacts; no convincing choir-timbre claim.');
        } catch (err) { status('Render failed'); warning(err.message); }
        finally { renderPending = false; $('render').disabled = false; }
    };
    $('listen').onclick = async () => { $('player').pause(); $('player').src = processedUrl; await $('player').play(); status('Playing processed mix'); };
    $('download').onclick = () => { const a = document.createElement('a'); a.href = processedUrl; a.download = 'personal-voice-choir-experimental.wav'; a.click(); };
})();