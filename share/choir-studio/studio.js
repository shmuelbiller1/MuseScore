/* SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 * Browser-only UI: no network calls, no model download, no accounts.
 */
(() => {
    'use strict';
    const $ = id => document.getElementById(id), names = ['Soprano', 'Alto', 'Tenor', 'Bass'];
    const rate = 24000, recordings = [], assignments = [], Studio = window.ChoirStudio, Project = window.ChoirProject;
    const tags = Object.create(null), pitchEdits = Object.create(null);
    let score, midiBytes, context, mediaRecorder, micStream, processedUrl, previewUrl;
    let recordPending = false, renderPending = false, revision = 0;
    let tagPage = 0, selectedNote = 0, waveDrag = null, projectPending = false, previewPending = false;
    const keyNames = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
    for (const selector of ['keyFrom', 'keyTo']) {
        for (const mode of ['major', 'minor']) for (let tonic = 0; tonic < 12; ++tonic) {
            const opt = document.createElement('option'); opt.value = `${tonic}:${mode}`;
            opt.textContent = `${keyNames[tonic]} ${mode}`; $(selector).append(opt);
        }
        $(selector).value = '0:major';
    }
    function invalidateProcessed() {
        ++revision;
        if (processedUrl) {
            if ($('player').src === processedUrl) { $('player').pause(); $('player').src = ''; }
            URL.revokeObjectURL(processedUrl); processedUrl = undefined;
        }
        $('listen').disabled = $('download').disabled = true;
        if (previewUrl) {
            $('processedTagPlayer').pause(); $('processedTagPlayer').src = '';
            URL.revokeObjectURL(previewUrl); previewUrl = undefined;
        }
    }
    async function audio() { if (!context) context = new AudioContext({ sampleRate: rate }); await context.resume(); return context; }
    const status = text => { $('status').textContent = text; };
    const warning = text => { $('warning').textContent = text; };
    async function decodeRecording(blob, name) {
        const ctx = await audio();
        const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
        if (buffer.duration < 0.06 || buffer.duration > 90) throw Error('Recording must be between 60 ms and 90 seconds');
        const samples = new Float32Array(buffer.length);
        for (let c = 0; c < buffer.numberOfChannels; ++c) {
            const channel = buffer.getChannelData(c);
            for (let i = 0; i < samples.length; ++i) samples[i] += channel[i] / buffer.numberOfChannels;
        }
        // Keep the exact original Blob. The mono PCM is only for processing.
        const suggestion = buffer.duration > 1.2 ? Studio.suggestVowel(samples, rate) : null;
        return { name, samples, blob, suggestion };
    }
    function registerRecording(record) {
        const index = recordings.push({ ...record, url: URL.createObjectURL(record.blob) }) - 1;
        const { name, suggestion, samples } = record;
        for (const selector of ['originalChoice', 'commonSource']) {
            const choice = document.createElement('option'); choice.value = String(index); choice.textContent = name; $(selector).append(choice);
        }
        $('sources').textContent = recordings.map((r, i) => `${i + 1}. ${r.name} (${(r.samples.length / rate).toFixed(1)} s)`
            + (r.suggestion ? ` · auto vowel ${r.suggestion.start}–${r.suggestion.end} s (~${r.suggestion.hz} Hz)` : '')).join(' · ');
        refresh();
        status(suggestion ? `Source ready. Automatically selected a steady vowel at ${suggestion.start}–${suggestion.end} s; enter crop times to override it.`
            : 'Source ready. For singing phrases, choose a steady vowel region; pitch detection can be overridden in Hz.');
        if (samples.length / rate > 1.2 && !suggestion) warning('No reliable sustained vowel was found in the first 8 seconds. Select vowel start/end manually, or use a clear sustained take.');
        updateTags();
    }
    async function addRecording(blob, name) {
        const record = await decodeRecording(blob, name);
        invalidateProcessed();
        registerRecording(record);
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
        const type = source.blob.type;
        const extension = type.includes('ogg') ? '.ogg' : type.includes('mp4') ? '.m4a' : type.includes('wav') ? '.wav' : '.webm';
        link.download = /\.(wav|webm|ogg|m4a|mp4)$/i.test(name) ? name : name + extension;
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
            const bytes = new Uint8Array(await event.target.files[0].arrayBuffer());
            const parsed = Studio.parseMidi(bytes);
            invalidateProcessed(); score = parsed; midiBytes = bytes;
            for (const key of Object.keys(tags)) delete tags[key];
            for (const key of Object.keys(pitchEdits)) delete pitchEdits[key];
            tagPage = selectedNote = 0;
            const available = Studio.noteTrackIndices(score);
            // A tempo-only conductor track must not duplicate Soprano/Alto.
            assignments.forEach((part, i) => { part.track = available[i] ?? -1; });
            $('scoreInfo').textContent = `${score.tracks.length} MIDI tracks; ${available.length} contain notes. Solo/unison need one written part; SATB needs four. Tempo changes and rests follow the export.`;
            const melody = $('melodyTrack'); melody.replaceChildren();
            available.forEach(i => { const option = document.createElement('option'); option.value = i;
                option.textContent = `${i + 1}: ${score.tracks[i].name} (${score.tracks[i].notes.length} notes)`; melody.append(option); });
            if (available.length) melody.value = String(available[0]);
            warning(available.length ? '' : 'This MIDI has no written-note track.');
            refresh();
        } catch (err) { invalidateProcessed(); score = undefined; warning(err.message); }
    };
    function makeSlider(label, key, min, max, step, value) {
        const wrapper = document.createElement('label'), input = document.createElement('input'), display = document.createElement('span');
        input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = value; input.dataset.field = key;
        display.textContent = `${label}: ${value}`; input.oninput = () => { display.textContent = `${label}: ${input.value}`; invalidateProcessed(); };
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
                invalidateProcessed();
                if (field === 'preset') {
                    part.preset = event.target.value;
                    Object.assign(part, Studio.defaults[part.preset]); refresh();
                } else if (field === 'recording') {
                    const selected = Number(event.target.value);
                    if (selected !== part.recording) {
                        part.recording = selected;
                        part.sourceHz = part.cropStart = part.cropEnd = 0;
                        refresh();
                    }
                } else {
                    part[field] = event.target.type === 'checkbox' ? event.target.checked : Number(event.target.value);
                    if (field === 'track') { tagPage = selectedNote = 0; updateTags(); }
                }
            };
            parent.append(card);
        });
        updateMode();
    }
    function updateMode() {
        const mode = $('arrangementMode').value, harmony = mode === 'choir', solo = mode === 'solo';
        $('melodyTrack').disabled = harmony;
        $('commonSource').disabled = false;
        $('assignAll').disabled = recordings.length === 0;
        $('soloVoice').disabled = !solo;
        $('modeInfo').textContent = harmony
            ? 'SATB harmony: assign four distinct written tracks below. You may reuse one recording, but different vocal characters cannot guarantee four realistic singers.'
            : solo ? 'Solo: the chosen written track and recording play through one selected voice character. Other parts are not rendered.'
                : 'Unison: all four characters follow the SAME written melody, not SATB harmony. Use SATB mode only after writing four independent parts.';
        document.querySelectorAll('#parts select[data-field="track"]').forEach(input => { input.disabled = !harmony; });
        document.querySelectorAll('#parts select[data-field="recording"]').forEach(input => { input.disabled = !harmony; });
        updateTags();
    }
    function syncSharedSource() {
        const mode = $('arrangementMode').value;
        if (mode === 'choir') return;
        const source = Number($('commonSource').value);
        if (!recordings[source]) return;
        const indices = mode === 'solo' ? [Number($('soloVoice').value)] : [0, 1, 2, 3];
        for (const i of indices) {
            const part = assignments[i];
            if (part && part.recording !== source) {
                part.recording = source;
                part.sourceHz = part.cropStart = part.cropEnd = 0;
            }
        }
        refresh();
    }
    $('arrangementMode').onchange = () => { invalidateProcessed(); syncSharedSource(); updateMode(); };
    $('melodyTrack').onchange = invalidateProcessed;
    for (const selector of ['commonSource', 'soloVoice']) $(selector).onchange = () => { invalidateProcessed(); syncSharedSource(); };
    $('assignAll').onclick = () => {
        const source = Number($('commonSource').value);
        if (!recordings[source]) return warning('Choose a recording first');
        invalidateProcessed();
        assignments.forEach(part => {
            if (part.recording !== source) {
                part.recording = source;
                part.sourceHz = part.cropStart = part.cropEnd = 0;
            }
        });
        refresh();
        status(`Assigned ${recordings[source].name} to all four voice characters; choose four written parts for SATB harmony.`);
    };
    function tagTarget() {
        const mode = $('arrangementMode').value;
        const i = mode === 'solo' ? Number($('soloVoice').value) : mode === 'unison' ? 0 : Number($('tagVoice').value);
        const part = assignments[i];
        const track = mode === 'choir' ? part?.track : Number($('melodyTrack').value);
        const recording = mode === 'choir' ? part?.recording : Number($('commonSource').value);
        const source = recordings[recording], notes = score?.tracks[track]?.notes;
        return source && notes?.length ? { track, recording, source, notes, name: part.name, part, voiceIndex: i } : null;
    }
    const tagKey = (track, recording) => `${track}:${recording}`;
    const pitchKey = (track, noteIndex) => `${track}:${noteIndex}`;
    const transpose = () => Studio.keySemitones($('keyFrom').value, $('keyTo').value, Number($('keyOctaves').value));
    const preferFlats = () => ['7:minor', '2:minor', '0:minor', '5:minor', '10:minor', '3:minor',
        '1:major', '3:major', '5:major', '8:major', '10:major'].includes($('keyTo').value);
    function showKeyGuide() {
        try {
            const shift = transpose(), target = $('keyTo').value, tonic = Number(target.split(':')[0]);
            const degrees = target.endsWith(':minor') ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
            const guide = degrees.map(d => Studio.noteName(60 + tonic + d, preferFlats()).replace(/\d+$/, '')).join(' · ');
            $('transposeInfo').textContent = `Global pitch shift ${shift >= 0 ? '+' : ''}${shift} semitones. ${keyNames[tonic]} ${target.split(':')[1]} guide: ${guide}. Original MIDI unchanged.`;
            return shift;
        } catch (err) { $('transposeInfo').textContent = err.message; return 0; }
    }
    const pitchLabel = value => value >= 0 && value <= 127 ? Studio.noteName(value, preferFlats()) : `MIDI ${value} (unsupported)`;
    function drawScoreTimeline(target, shift) {
        const canvas = $('scoreWave'), ctx = canvas.getContext?.('2d');
        if (!ctx) return;
        const { width, height } = canvas; ctx.clearRect(0, 0, width, height);
        if (!target) return;
        const notes = target.notes, first = tagPage * 20, last = Math.min(notes.length, first + 20);
        const from = notes[first].startSeconds, length = Math.max(0.1, notes[last - 1].endSeconds - from);
        for (let i = first; i < last; ++i) {
            const note = notes[i], pitch = note.pitch + shift + (pitchEdits[pitchKey(target.track, i)] || 0);
            const x = (note.startSeconds - from) / length * width, w = Math.max(2, (note.endSeconds - note.startSeconds) / length * width);
            const y = Math.max(3, Math.min(height - 19, height - 26 - (pitch - 60) * 1.4));
            ctx.fillStyle = i === selectedNote ? '#ffbf69' : Studio.inKey(pitch, $('keyTo').value) ? '#8adc98' : '#c4a0e3';
            ctx.fillRect(x, y, w, 18);
            if (w > 32) { ctx.fillStyle = '#101826'; ctx.font = '12px sans-serif';
                ctx.fillText(pitchLabel(pitch), x + 3, y + 13); }
        }
    }
    function showSelectedNote(target, shift) {
        if (!target) { $('noteLink').textContent = 'Choose a score note to inspect its linked source range.'; return; }
        const note = target.notes[selectedNote], mark = tags[tagKey(target.track, target.recording)]?.[selectedNote];
        const pitch = note.pitch + shift + (pitchEdits[pitchKey(target.track, selectedNote)] || 0);
        const stretch = mark ? (note.endSeconds - note.startSeconds) / (mark.end - mark.start) : null;
        $('noteLink').textContent = `Note ${selectedNote + 1}: written ${pitchLabel(note.pitch)} → output ${pitchLabel(pitch)}`
            + ` at score ${note.startSeconds.toFixed(2)}–${note.endSeconds.toFixed(2)} s; `
            + (mark ? `recording ${mark.start.toFixed(2)}–${mark.end.toFixed(2)} s fitted ${stretch.toFixed(2)}×.`
                : 'no source range tagged yet.');
    }
    function drawWaveform(target) {
        const canvas = $('tagWave'), ctx = canvas.getContext?.('2d');
        if (!ctx) return; // DOM test stand-in or browser without canvas
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);
        if (!target) return;
        const from = Number($('waveStart').value), to = Number($('waveEnd').value);
        if (!(from >= 0 && to > from)) return;
        const samples = target.source.samples, marks = tags[tagKey(target.track, target.recording)] || [];
        for (let x = 0; x < width; ++x) {
            const a = Math.floor((from + (to - from) * x / width) * rate);
            const b = Math.min(samples.length, Math.ceil((from + (to - from) * (x + 1) / width) * rate));
            let peak = 0;
            for (let j = a; j < b; j += Math.max(1, Math.floor((b - a) / 128))) peak = Math.max(peak, Math.abs(samples[j] || 0));
            ctx.fillStyle = '#8ab5dc'; ctx.fillRect(x, height / 2 - peak * height * 0.47, 1, Math.max(1, peak * height * 0.94));
        }
        for (let i = tagPage * 20; i < Math.min(marks.length, (tagPage + 1) * 20); ++i) {
            const mark = marks[i]; if (!mark) continue;
            const x = Math.max(0, (mark.start - from) / (to - from) * width);
            const right = Math.min(width, (mark.end - from) / (to - from) * width);
            if (right <= x) continue;
            ctx.fillStyle = i === selectedNote ? 'rgba(255,190,95,.45)' : 'rgba(105,220,145,.25)';
            ctx.fillRect(x, 0, right - x, height);
        }
    }
    async function previewProcessedNote(target, index) {
        if (previewPending) return;
        previewPending = true;
        try {
            const current = tagTarget();
            if (!current || current.track !== target.track || current.recording !== target.recording) {
                throw Error('The selected part changed; select its note again');
            }
            const note = target.notes[index], duration = note.endSeconds - note.startSeconds;
            if (duration <= 0 || duration > 30) throw Error('Preview supports written notes up to 30 seconds');
            const shift = transpose(), delta = pitchEdits[pitchKey(target.track, index)] || 0;
            const part = { ...target.part, track: 0, recording: 0, solo: false, mute: false,
                transposeSemitones: shift, pitchDeltas: [delta] };
            if (target.part.recording !== target.recording) part.sourceHz = part.cropStart = part.cropEnd = 0;
            if ($('phraseMode').checked) {
                const tag = tags[tagKey(target.track, target.recording)]?.[index];
                if (!tag) throw Error('Tag this written note first, then audition the pitch and stretch');
                part.noteTags = [{ ...tag }];
            }
            const previewScore = { tracks: [{ notes: [{ ...note, startSeconds: 0, endSeconds: duration }] }] };
            const version = revision;
            status(`Processing note ${index + 1} locally…`);
            const mix = await Studio.renderAsync(previewScore, [part], [target.source], rate, Math.max(1, duration + 0.1));
            if (version !== revision) throw Error('Settings changed during note preview; try again');
            if (mix.peak < 0.001) throw Error('Processed note is silent; check the tagged source');
            const player = $('processedTagPlayer'); player.pause();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = URL.createObjectURL(new Blob([Studio.wav([mix.left, mix.right], rate)], { type: 'audio/wav' }));
            player.src = previewUrl;
            let autoPlayed = true;
            try { await player.play(); } catch { autoPlayed = false; }
            if (version !== revision) { status('Preview canceled after settings changed.'); return; }
            const output = Studio.outputPitch(note, part, 0), mark = part.noteTags?.[0];
            $('previewInfo').textContent = `Note ${index + 1}: ${pitchLabel(note.pitch)} → ${pitchLabel(output)}, ${duration.toFixed(2)} s at score tempo`
                + (mark ? ` from ${mark.start.toFixed(2)}–${mark.end.toFixed(2)} s source (${(duration / (mark.end - mark.start)).toFixed(2)}× fit).` : '.')
                + (Studio.inKey(output, $('keyTo').value) ? ' In target-key guide.' : ' Chromatic: outside target-key guide.');
            status(autoPlayed ? 'Playing the processed note.' : 'Processed note ready: press Play on the preview audio control.');
            warning(mix.warnings.join('\n') || 'Audition the processed note against the unchanged source; note-preview F0 is not a naturalness test.');
        } catch (err) { warning(err.message); }
        finally { previewPending = false; }
    }
    function updateTags() {
        const shift = showKeyGuide(), mode = $('arrangementMode').value;
        $('tagVoice').disabled = mode !== 'choir';
        if (mode === 'solo') $('tagVoice').value = $('soloVoice').value;
        if (mode === 'unison') $('tagVoice').value = '0';
        const target = tagTarget(), rows = $('tagRows'); rows.replaceChildren();
        if (!target) { $('tagInfo').textContent = 'Load a MIDI and recording, then choose a written part to tag.';
            $('tagPageInfo').textContent = ''; drawWaveform(null); drawScoreTimeline(null, shift); showSelectedNote(null, shift); return; }
        const { track, recording, source, notes, name } = target, key = tagKey(track, recording);
        const marks = tags[key] || [], missing = notes.reduce((n, _, i) => n + (!marks[i] ? 1 : 0), 0);
        tagPage = Math.min(tagPage, Math.floor((notes.length - 1) / 20));
        if (selectedNote < tagPage * 20 || selectedNote >= Math.min(notes.length, (tagPage + 1) * 20)) selectedNote = tagPage * 20;
        $('tagInfo').textContent = `${name} · written track ${track + 1} · ${source.name} · ${notes.length} notes (${missing} untagged). Source ranges are seconds in the unchanged recording.`;
        $('tagPageInfo').textContent = `Notes ${tagPage * 20 + 1}–${Math.min(notes.length, (tagPage + 1) * 20)} of ${notes.length}`;
        $('tagPrevious').disabled = tagPage === 0;
        $('tagNext').disabled = (tagPage + 1) * 20 >= notes.length;
        for (let i = tagPage * 20; i < Math.min(notes.length, (tagPage + 1) * 20); ++i) {
            const row = document.createElement('div'), note = notes[i], mark = marks[i];
            row.className = 'tag-row';
            const select = document.createElement('button'); select.textContent = `Note ${i + 1} · MIDI ${note.pitch} · score ${note.startSeconds.toFixed(2)}–${note.endSeconds.toFixed(2)} s`;
            select.onclick = () => {
                selectedNote = i;
                if (marks[i]) {
                    $('waveStart').value = Math.max(0, +(marks[i].start - 0.3).toFixed(2));
                    $('waveEnd').value = Math.min(source.samples.length / rate, +(marks[i].end + 0.3).toFixed(2));
                }
                drawWaveform(target); drawScoreTimeline(target, shift); showSelectedNote(target, shift);
            };
            row.append(select);
            const targetPitch = note.pitch + shift + (pitchEdits[pitchKey(track, i)] || 0);
            const pitchSelect = document.createElement('select'); pitchSelect.dataset.pitchIndex = String(i);
            for (let p = 36; p <= 88; ++p) {
                const option = document.createElement('option'); option.value = String(p);
                option.textContent = `${pitchLabel(p)} (MIDI ${p})${Studio.inKey(p, $('keyTo').value) ? '' : ' · chromatic'}`;
                pitchSelect.append(option);
            }
            if (targetPitch < 36 || targetPitch > 88) {
                const option = document.createElement('option'); option.value = String(targetPitch);
                option.textContent = `${pitchLabel(targetPitch)} (outside recommended range)`; pitchSelect.append(option);
            }
            pitchSelect.value = String(targetPitch);
            pitchSelect.onchange = () => {
                const delta = Number(pitchSelect.value) - note.pitch - shift;
                if (!Number.isInteger(delta) || Math.abs(delta) > 24) {
                    updateTags(); return warning('A single note may move at most 24 semitones. Choose a closer note or change the global key.');
                }
                if (delta) pitchEdits[pitchKey(track, i)] = delta;
                else delete pitchEdits[pitchKey(track, i)];
                invalidateProcessed(); updateTags();
            };
            const pitchLabelElement = document.createElement('label');
            pitchLabelElement.textContent = `Output ${pitchLabel(targetPitch)} (written ${pitchLabel(note.pitch)})`;
            pitchLabelElement.append(pitchSelect); row.append(pitchLabelElement);
            const inputs = {};
            for (const [field, label] of [['start', 'Source from'], ['end', 'Source to'], ['hz', 'Hz (0 auto)']]) {
                const input = document.createElement('input'); input.type = 'number'; input.step = 0.001; input.min = 0;
                input.value = mark ? +mark[field].toFixed(4) : field === 'hz' ? 0 : '';
                input.dataset.tagField = field; input.dataset.noteIndex = i;
                const wrapper = document.createElement('label'); wrapper.textContent = label; wrapper.append(input); row.append(wrapper); inputs[field] = input;
            }
            row.onchange = event => {
                if (event?.target?.dataset?.pitchIndex !== undefined) return;
                if (inputs.start.value === '' || inputs.end.value === '') return;
                const start = Number(inputs.start.value), end = Number(inputs.end.value), hz = Number(inputs.hz.value);
                if (!(Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(hz)
                    && start >= 0 && end <= source.samples.length / rate && end > start && hz >= 0)) {
                    return warning('Source range must have a start before its end and lie within the recording.');
                }
                if (!tags[key]) tags[key] = Array(notes.length).fill(null);
                tags[key][i] = { start, end, hz };
                invalidateProcessed(); updateTags();
            };
            const move = delta => {
                if (!marks[i]) return warning('Tag this note first');
                const old = marks[i], shift = Math.max(-old.start, Math.min(delta, source.samples.length / rate - old.end));
                marks[i] = { ...old, start: +(old.start + shift).toFixed(4), end: +(old.end + shift).toFixed(4) };
                invalidateProcessed(); updateTags();
            };
            for (const [label, delta] of [['← 50 ms', -0.05], ['50 ms →', 0.05]]) {
                const button = document.createElement('button'); button.textContent = label; button.onclick = () => move(delta); row.append(button);
            }
            const preview = document.createElement('button'); preview.textContent = 'Hear tagged source';
            preview.onclick = async () => {
                const range = tags[key]?.[i]; if (!range) return warning('Tag this note first');
                const player = $('tagPlayer'); player.pause();
                try {
                    if (player.src !== source.url) player.src = source.url;
                    if (player.addEventListener && player.readyState < 1) {
                        await new Promise((resolve, reject) => {
                            const ready = () => { player.removeEventListener('error', failed); resolve(); };
                            const failed = () => { player.removeEventListener('loadedmetadata', ready); reject(Error('Cannot preview source audio')); };
                            player.addEventListener('loadedmetadata', ready, { once: true });
                            player.addEventListener('error', failed, { once: true });
                        });
                    }
                    player.currentTime = range.start;
                    player.ontimeupdate = () => { if (player.currentTime >= range.end) player.pause(); };
                    await player.play();
                } catch (err) { warning(err.message); }
            };
            row.append(preview);
            const processed = document.createElement('button'); processed.textContent = 'Hear pitched + stretched note';
            processed.onclick = () => previewProcessedNote(target, i);
            row.append(processed); rows.append(row);
        }
        drawWaveform(target); drawScoreTimeline(target, shift); showSelectedNote(target, shift);
    }
    $('tagVoice').onchange = () => { tagPage = selectedNote = 0; updateTags(); };
    for (const selector of ['keyFrom', 'keyTo', 'keyOctaves']) $(selector).onchange = () => { invalidateProcessed(); updateTags(); };
    $('quickGMinor').onclick = () => {
        $('keyFrom').value = '9:minor'; $('keyTo').value = '7:minor'; $('keyOctaves').value = '0';
        invalidateProcessed(); updateTags();
    };
    $('phraseMode').onchange = invalidateProcessed;
    $('melodyTrack').onchange = () => { invalidateProcessed(); tagPage = selectedNote = 0; updateTags(); };
    $('waveStart').onchange = $('waveEnd').onchange = () => drawWaveform(tagTarget());
    $('tagPrevious').onclick = () => { tagPage = Math.max(0, tagPage - 1); selectedNote = tagPage * 20; updateTags(); };
    $('tagNext').onclick = () => { ++tagPage; selectedNote = tagPage * 20; updateTags(); };
    $('fillTags').onclick = () => {
        const target = tagTarget(); if (!target) return warning('Load a score and recording first');
        tags[tagKey(target.track, target.recording)] = Studio.distributeTags(target.notes, target.source.samples.length / rate);
        invalidateProcessed(); updateTags();
        status('Guessed source ranges in note order. Listen and adjust every tag; rests in the score remain silent.');
    };
    $('clearTags').onclick = () => {
        const target = tagTarget(); if (!target) return;
        delete tags[tagKey(target.track, target.recording)]; invalidateProcessed(); updateTags();
    };
    const scoreCanvas = $('scoreWave');
    scoreCanvas.onpointerdown = event => {
        const target = tagTarget(); if (!target) return;
        const rect = scoreCanvas.getBoundingClientRect(); if (!rect.width) return;
        const first = tagPage * 20, last = Math.min(target.notes.length, first + 20);
        const from = target.notes[first].startSeconds, length = Math.max(0.1, target.notes[last - 1].endSeconds - from);
        const at = from + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * length;
        let best = first, distance = Infinity;
        for (let i = first; i < last; ++i) {
            const note = target.notes[i], d = Math.max(note.startSeconds - at, 0, at - note.endSeconds);
            if (d < distance) { distance = d; best = i; }
        }
        selectedNote = best;
        const mark = tags[tagKey(target.track, target.recording)]?.[best];
        if (mark) {
            $('waveStart').value = Math.max(0, +(mark.start - 0.3).toFixed(2));
            $('waveEnd').value = Math.min(target.source.samples.length / rate, +(mark.end + 0.3).toFixed(2));
        }
        updateTags();
    };
    const canvas = $('tagWave');
    canvas.onpointerdown = event => {
        const target = tagTarget(); if (!target) return;
        const rect = canvas.getBoundingClientRect(), from = Number($('waveStart').value), to = Number($('waveEnd').value);
        if (!(to > from) || !rect.width) return;
        waveDrag = { key: tagKey(target.track, target.recording), track: target.track, recording: target.recording,
            note: selectedNote, start: Math.max(0, Math.min(target.source.samples.length / rate,
                from + (event.clientX - rect.left) / rect.width * (to - from))) };
        canvas.setPointerCapture?.(event.pointerId);
    };
    canvas.onpointerup = event => {
        if (!waveDrag) return;
        const drag = waveDrag; waveDrag = null;
        const target = tagTarget(); if (!target || drag.key !== tagKey(target.track, target.recording)) return;
        const rect = canvas.getBoundingClientRect(), from = Number($('waveStart').value), to = Number($('waveEnd').value);
        const finish = Math.max(0, Math.min(target.source.samples.length / rate,
            from + (event.clientX - rect.left) / rect.width * (to - from)));
        const start = Math.min(drag.start, finish), end = Math.max(drag.start, finish);
        if (end - start < 0.075) return warning('Drag at least 75 ms of source audio for this note; zoom in for precision.');
        if (!tags[drag.key]) tags[drag.key] = Array(target.notes.length).fill(null);
        tags[drag.key][drag.note] = { start, end, hz: tags[drag.key][drag.note]?.hz || 0 };
        invalidateProcessed(); updateTags();
    };
    refresh();
    $('render').onclick = async () => {
        if (renderPending) return;
        renderPending = true; $('render').disabled = true;
        try {
            if (!score || recordings.length === 0) throw Error('Load both MIDI and a WAV or microphone recording first');
            const mode = $('arrangementMode').value;
            const partSnapshot = Studio.arrangeParts(mode, score, assignments,
                Number($('commonSource').value), Number($('melodyTrack').value), Number($('soloVoice').value));
            const shift = transpose();
            for (const part of partSnapshot) {
                part.transposeSemitones = shift;
                part.pitchDeltas = score.tracks[part.track].notes.map((_, i) => pitchEdits[pitchKey(part.track, i)] || 0);
            }
            if ($('phraseMode').checked) {
                for (const part of partSnapshot) {
                    if (part.mute || (partSnapshot.some(p => p.solo) && !part.solo)) continue;
                    const marks = tags[tagKey(part.track, part.recording)], notes = score.tracks[part.track].notes;
                    if (!marks || marks.length !== notes.length || marks.some(mark => !mark)) {
                        throw Error(`${part.name}: tag every written note with a source range first. Select the part in step 4 or use Guess sequential ranges.`);
                    }
                    part.noteTags = marks.map(mark => ({ ...mark }));
                }
            }
            invalidateProcessed();
            const renderRevision = revision, renderScore = score;
            status('Rendering locally…'); warning(''); await new Promise(resolve => setTimeout(resolve, 20));
            const mix = await Studio.renderAsync(renderScore, partSnapshot, recordings.slice(), rate, 240,
                step => status(`Rendering locally… ${step.completed}/${step.total} notes`));
            if (renderRevision !== revision) throw Error('Settings changed during render; render again to hear the new selection.');
            if (mix.peak < 0.001) throw Error('Rendered silence; choose an audible voiced source and non-muted tracks');
            processedUrl = URL.createObjectURL(new Blob([Studio.wav([mix.left, mix.right], rate)], { type: 'audio/wav' }));
            $('listen').disabled = $('download').disabled = false;
            status(`Rendered ${(mix.left.length / rate).toFixed(2)} seconds; peak ${mix.peak.toFixed(3)}. Original source unchanged.`);
            warning(mix.warnings.slice(0, 8).join('\n') || 'Experimental vowel rendering: audition for artifacts; no convincing choir-timbre claim.');
        } catch (err) { status('Render failed'); warning(err.message); }
        finally { renderPending = false; $('render').disabled = false; }
    };
    $('saveProject').onclick = async () => {
        if (projectPending) return;
        projectPending = true; $('saveProject').disabled = true;
        try {
            if (!midiBytes || !recordings.length) throw Error('Load a MIDI and at least one recording before saving');
            const controls = { mode: $('arrangementMode').value, melodyTrack: Number($('melodyTrack').value),
                commonSource: Number($('commonSource').value), soloVoice: Number($('soloVoice').value),
                tagVoice: Number($('tagVoice').value), phraseMode: $('phraseMode').checked,
                sourceKey: $('keyFrom').value, targetKey: $('keyTo').value, octaves: Number($('keyOctaves').value) };
            transpose(); // Do not save an impossible major ↔ minor transposition as a valid performance.
            const saveRevision = revision;
            const json = await Project.encodeProject({ midiBytes: midiBytes.slice(), recordings: recordings.slice(),
                parts: assignments.map(part => ({ ...part })), tags: Object.entries(tags).map(([key, marks]) =>
                    [key, marks.map(mark => mark && { ...mark })]), controls,
                pitchEdits: Object.entries(pitchEdits) });
            if (saveRevision !== revision) throw Error('Settings changed while saving; save again');
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
            const link = document.createElement('a'); link.href = url; link.download = 'personal-voice-choir.choir.json'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            status('Saved original recordings, written MIDI, note tags and character settings in a local session file.');
        } catch (err) { warning('Save failed: ' + err.message); }
        finally { projectPending = false; $('saveProject').disabled = false; }
    };
    $('openProject').onchange = async event => {
        if (projectPending) return;
        projectPending = true;
        try {
            if (renderPending || recordPending || mediaRecorder) throw Error('Finish rendering or recording before opening a session');
            const loadRevision = revision;
            const file = event.target.files[0];
            if (!file || file.size > 135 * 1024 * 1024) throw Error('Choose a choir session under 135 MB');
            const saved = Project.decodeProject(await file.text()), parsed = Studio.parseMidi(saved.midiBytes);
            const controls = saved.controls;
            Studio.keySemitones(controls.sourceKey, controls.targetKey, controls.octaves);
            for (const [key] of saved.pitchEdits) {
                const [track, index] = key.split(':').map(Number);
                if (!parsed.tracks[track]?.notes[index]) throw Error('Saved pitch edit references missing written note');
            }
            if (!parsed.tracks[controls.melodyTrack]?.notes.length || controls.commonSource < 0
                || controls.commonSource >= saved.recordings.length || controls.soloVoice < 0 || controls.soloVoice > 3
                || controls.tagVoice < 0 || controls.tagVoice > 3) throw Error('Saved session references missing score or voice');
            for (const part of saved.parts) if (part.track < -1 || part.track >= parsed.tracks.length) throw Error('Saved part references missing track');
            const staged = await Promise.all(saved.recordings.map(r => decodeRecording(r.blob, r.name)));
            for (const [key, marks] of saved.tags) {
                const [track, source] = key.split(':').map(Number);
                if (!parsed.tracks[track]?.notes.length || marks.length !== parsed.tracks[track].notes.length
                    || marks.some(mark => mark && mark.end > staged[source].samples.length / rate)) throw Error('Saved tags do not match the score or recording');
            }
            // Commit only after *all* blobs decode and all references validate.
            if (loadRevision !== revision || renderPending || recordPending || mediaRecorder) {
                throw Error('Current session changed while loading; retry the saved session');
            }
            invalidateProcessed(); $('player').pause(); $('player').src = ''; $('tagPlayer').pause(); $('tagPlayer').src = '';
            recordings.forEach(r => URL.revokeObjectURL(r.url));
            recordings.length = 0; assignments.length = 0;
            for (const key of Object.keys(tags)) delete tags[key];
            for (const key of Object.keys(pitchEdits)) delete pitchEdits[key];
            $('originalChoice').replaceChildren(); $('commonSource').replaceChildren();
            score = parsed; midiBytes = saved.midiBytes;
            for (const record of staged) registerRecording(record);
            assignments.splice(0, assignments.length, ...saved.parts);
            for (const [key, marks] of saved.tags) tags[key] = marks;
            for (const [key, delta] of saved.pitchEdits) pitchEdits[key] = delta;
            const melody = $('melodyTrack'); melody.replaceChildren();
            Studio.noteTrackIndices(score).forEach(i => {
                const option = document.createElement('option'); option.value = i;
                option.textContent = `${i + 1}: ${score.tracks[i].name} (${score.tracks[i].notes.length} notes)`; melody.append(option);
            });
            $('arrangementMode').value = controls.mode; melody.value = String(controls.melodyTrack);
            $('commonSource').value = String(controls.commonSource); $('soloVoice').value = String(controls.soloVoice);
            $('tagVoice').value = String(controls.tagVoice); $('phraseMode').checked = controls.phraseMode;
            $('keyFrom').value = controls.sourceKey; $('keyTo').value = controls.targetKey;
            $('keyOctaves').value = String(controls.octaves);
            $('scoreInfo').textContent = `Restored ${score.tracks.length} MIDI tracks with original audio and note tags from local session.`;
            tagPage = selectedNote = 0;
            $('waveStart').value = 0; $('waveEnd').value = Math.min(5, staged[controls.commonSource].samples.length / rate);
            refresh(); warning(''); status('Session restored locally. Audition tags and render when ready.');
        } catch (err) { warning('Open failed; existing session retained: ' + err.message); }
        finally { projectPending = false; }
    };
    $('listen').onclick = async () => { $('player').pause(); $('player').src = processedUrl; await $('player').play(); status('Playing processed mix'); };
    $('download').onclick = () => { const a = document.createElement('a'); a.href = processedUrl; a.download = 'personal-voice-choir-experimental.wav'; a.click(); };
})();