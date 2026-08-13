/* TR-909 Web — sequencer + Web Audio engine.
   Self-contained: builds its DOM into #tr909-root, loads samples relative to this script's URL. */
(function () {
  'use strict';

  /* ── configuration ── */

  const SAMPLE_BASE = (function () {
    const el = document.currentScript ||
      Array.from(document.querySelectorAll('script[src]')).find(s => /tr909\.js/.test(s.src));
    return el ? el.src.replace(/tr909\.js.*$/, '') : './';
  })();

  // Voices in Legend order (step keys 1..11). Knobs listed per voice; 'level' keys
  // may be shared (hats share hhLevel, cymbals share cymLevel).
  const VOICES = [
    { id: 'bd',    legend: 'BASS',   file: 'BT0AADA.WAV',  level: 'bdLevel'  },
    { id: 'sd',    legend: 'SNARE',  file: 'ST0T0SA.WAV',  level: 'sdLevel'  },
    { id: 'lt',    legend: 'L-TOM',  file: 'LT0DA.WAV',    level: 'ltLevel'  },
    { id: 'mt',    legend: 'M-TOM',  file: 'MT0DA.WAV',    level: 'mtLevel'  },
    { id: 'ht',    legend: 'H-TOM',  file: 'HT0DA.WAV',    level: 'htLevel'  },
    { id: 'rim',   legend: 'RIM',    file: 'RIM127.WAV',   level: 'rimLevel' },
    { id: 'clap',  legend: 'CLAP',   file: 'HANDCLP1.WAV', level: 'clapLevel'},
    { id: 'ch',    legend: 'CH-HAT', file: 'HHCDA.WAV',    level: 'hhLevel'  },
    { id: 'oh',    legend: 'OH-HAT', file: 'HHODA.WAV',    level: 'hhLevel'  },
    { id: 'crash', legend: 'CRASH',  file: 'CSHD4.WAV',    level: 'cymLevel' },
    { id: 'ride',  legend: 'RIDE',   file: 'RIDED4.WAV',   level: 'cymLevel' },
  ];
  const DECOR_LEGENDS = ['SHUFF', 'LED-ON', 'ACC-1', 'ACC-2', 'ENTER'];
  const LANES = VOICES.map(v => v.id).concat(['accent']);
  const SLOTS = 'ABCDEFGH'.split('');

  /* ── state ── */

  const knobs = {                 // all 0..1 unless noted
    accentAmt: 0.6,
    bdTune: 0.5, bdLevel: 0.85, bdAttack: 0.5, bdDecay: 0.7,
    sdTune: 0.5, sdLevel: 0.8,  sdTone: 0.5,   sdSnappy: 0.6,
    ltTune: 0.5, ltLevel: 0.75, ltDecay: 0.7,
    mtTune: 0.5, mtLevel: 0.75, mtDecay: 0.7,
    htTune: 0.5, htLevel: 0.75, htDecay: 0.7,
    rimLevel: 0.75, clapLevel: 0.8, hhLevel: 0.7, cymLevel: 0.6,
    volume: 0.8,
    tempo: (120 - 60) / 140,    // knob position for 120 BPM on a 60..200 scale
  };
  const TUNE_RANGE = 7;         // semitones each way

  function emptyPattern() {
    const p = {};
    LANES.forEach(l => { p[l] = new Array(16).fill(false); });
    return p;
  }
  const patterns = SLOTS.map(emptyPattern);
  // Demo house beat in slot A.
  [0, 4, 8, 12].forEach(i => { patterns[0].bd[i] = true; });
  [4, 12].forEach(i => { patterns[0].clap[i] = true; });
  [0, 4, 8, 12].forEach(i => { patterns[0].ch[i] = true; });
  [2, 6, 10, 14].forEach(i => { patterns[0].oh[i] = true; });
  [0, 8].forEach(i => { patterns[0].accent[i] = true; });

  let activeSlot = 0;
  let pendingSlot = -1;
  let selectedLane = 'bd';
  let playing = false;

  const bpm = () => Math.round(60 + knobs.tempo * 140);

  /* ── audio engine ── */

  let ctx = null;
  const buffers = {};
  let masterGain = null;
  let openHatVoices = [];       // ringing OH sources, choked by CH
  let loadPromise = null;
  let rawPromise = null;        // sample bytes, prefetched before any user gesture

  function prefetchSamples() {
    if (rawPromise) return rawPromise;
    rawPromise = Promise.all(VOICES.map(v =>
      fetch(SAMPLE_BASE + 'samples/' + v.file)
        .then(r => { if (!r.ok) throw new Error(v.file + ' HTTP ' + r.status); return r.arrayBuffer(); })
        .then(ab => [v.id, ab])
    ));
    rawPromise.catch(() => {});   // surfaced later via ensureAudio
    return rawPromise;
  }

  function ensureAudio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = knobs.volume;
      masterGain.connect(ctx.destination);
      loadPromise = prefetchSamples().then(pairs => Promise.all(
        pairs.map(([id, ab]) => ctx.decodeAudioData(ab).then(buf => { buffers[id] = buf; }))
      ));
    }
    if (ctx.state === 'suspended') ctx.resume();
    return loadPromise;
  }

  function trigger(voiceId, time, accented) {
    const buf = buffers[voiceId];
    if (!buf) return;
    const v = VOICES.find(x => x.id === voiceId);
    const src = ctx.createBufferSource();
    src.buffer = buf;

    // TUNE — repitch
    let semis = 0;
    if (voiceId === 'bd') semis = (knobs.bdTune - 0.5) * 2 * TUNE_RANGE;
    if (voiceId === 'sd') semis = (knobs.sdTune - 0.5) * 2 * TUNE_RANGE;
    if (voiceId === 'lt') semis = (knobs.ltTune - 0.5) * 2 * TUNE_RANGE;
    if (voiceId === 'mt') semis = (knobs.mtTune - 0.5) * 2 * TUNE_RANGE;
    if (voiceId === 'ht') semis = (knobs.htTune - 0.5) * 2 * TUNE_RANGE;
    src.playbackRate.value = Math.pow(2, semis / 12);

    let node = src;

    // TONE / SNAPPY (snare) — filters
    if (voiceId === 'sd') {
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1500 + knobs.sdTone * 14000;   // closed→dark, open→full
      node.connect(tone); node = tone;
      const snappy = ctx.createBiquadFilter();
      snappy.type = 'highshelf';
      snappy.frequency.value = 1800;
      snappy.gain.value = -18 + knobs.sdSnappy * 24;        // -18dB .. +6dB noise band
      node.connect(snappy); node = snappy;
    }

    // ATTACK (kick) — shape the first 15ms
    const env = ctx.createGain();
    if (voiceId === 'bd') {
      const boost = 0.4 + knobs.bdAttack * 1.2;             // 0.4x .. 1.6x transient
      env.gain.setValueAtTime(boost, time);
      env.gain.linearRampToValueAtTime(1, time + 0.015);
    } else {
      env.gain.setValueAtTime(1, time);
    }

    // DECAY — shorten the tail with an exponential ramp
    const decayKnob = { bd: 'bdDecay', lt: 'ltDecay', mt: 'mtDecay', ht: 'htDecay' }[voiceId];
    if (decayKnob) {
      const d = knobs[decayKnob];
      const dur = buf.duration / src.playbackRate.value;
      const tail = 0.04 + d * (dur - 0.04);
      env.gain.setValueAtTime(env.gain.value, time + Math.min(0.015, tail * 0.5));
      env.gain.exponentialRampToValueAtTime(0.001, time + tail);
    }

    node.connect(env);

    // LEVEL × ACCENT → master
    const out = ctx.createGain();
    const accentMul = accented ? 1 + knobs.accentAmt : 1;
    out.gain.value = Math.pow(knobs[v.level], 1.6) * accentMul;
    env.connect(out);
    out.connect(masterGain);

    // hat choke: CH (or a new OH) silences ringing OH
    if (voiceId === 'oh') {
      chokeOpenHat(time);
      openHatVoices.push({ src, gain: out });
    } else if (voiceId === 'ch') {
      chokeOpenHat(time);
    }

    src.start(time);
    src.onended = () => { openHatVoices = openHatVoices.filter(o => o.src !== src); };
  }

  function chokeOpenHat(time) {
    openHatVoices.forEach(o => {
      o.gain.gain.setValueAtTime(o.gain.gain.value, time);
      o.gain.gain.exponentialRampToValueAtTime(0.001, time + 0.03);
      o.src.stop(time + 0.05);
    });
    openHatVoices = [];
  }

  /* ── sequencer (lookahead scheduler) ── */

  const LOOKAHEAD_MS = 25, HORIZON = 0.1;
  let currentStep = 0, nextNoteTime = 0, timerId = null;
  let drawQueue = [];             // {step, time} for the playhead

  function scheduleStep(step, time) {
    const p = patterns[activeSlot];
    const accented = p.accent[step];
    VOICES.forEach(v => { if (p[v.id][step]) trigger(v.id, time, accented); });
    drawQueue.push({ step, time });
  }

  function scheduler() {
    while (nextNoteTime < ctx.currentTime + HORIZON) {
      scheduleStep(currentStep, nextNoteTime);
      nextNoteTime += (60 / bpm()) / 4;      // 16th notes
      currentStep = (currentStep + 1) % 16;
      if (currentStep === 0 && pendingSlot >= 0) {
        activeSlot = pendingSlot; pendingSlot = -1;
        syncSlotUI(); renderSteps(); updateDisplay();
      }
    }
  }

  function start() {
    ensureAudio().then(() => {
      if (playing) { currentStep = 0; nextNoteTime = ctx.currentTime + 0.05; return; }
      playing = true;
      currentStep = 0;
      nextNoteTime = ctx.currentTime + 0.05;
      timerId = setInterval(scheduler, LOOKAHEAD_MS);
      ui.startBtn.classList.add('t9-running');
      requestAnimationFrame(drawPlayhead);
    }).catch(err => {
      console.error('TR-909: sample load failed', err);
      updateDisplay('LOAD ERR');
    });
  }

  function stop() {
    playing = false;
    if (timerId) clearInterval(timerId);
    timerId = null;
    drawQueue = [];
    if (pendingSlot >= 0) { activeSlot = pendingSlot; pendingSlot = -1; syncSlotUI(); renderSteps(); updateDisplay(); }
    ui.startBtn.classList.remove('t9-running');
    ui.keys.forEach(k => k.classList.remove('t9-play'));
  }

  let lastDrawn = -1;
  function drawPlayhead() {
    if (!playing) return;
    let current = -1;
    while (drawQueue.length && drawQueue[0].time <= ctx.currentTime) {
      current = drawQueue.shift().step;
    }
    if (current >= 0 && current !== lastDrawn) {
      ui.keys.forEach(k => k.classList.remove('t9-play'));
      ui.keys[current].classList.add('t9-play');
      lastDrawn = current;
    }
    requestAnimationFrame(drawPlayhead);
  }

  /* ── UI construction ── */

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  const ui = { keys: [], stepLabels: {}, slotBtns: [], knobEls: {} };

  function createKnob(key, label, sub, size) {
    const wrap = h('div', 't9-knob-wrap');
    if (label) wrap.appendChild(h('div', 't9-knob-label', label));
    const knob = h('div', 't9-knob');
    knob.style.width = knob.style.height = size + 'px';
    const pointer = h('div', 't9-knob-pointer');
    knob.appendChild(pointer);
    wrap.appendChild(knob);
    if (sub) wrap.appendChild(h('div', 't9-knob-sub', sub));

    const setAngle = () => {
      const deg = -135 + knobs[key] * 270;
      pointer.style.transform = 'rotate(' + (deg + 180) + 'deg)';   // pointer hangs from center; +180 points it outward
    };
    setAngle();
    ui.knobEls[key] = setAngle;

    let dragging = false, startY = 0, startVal = 0;
    knob.addEventListener('pointerdown', e => {
      dragging = true; startY = e.clientY; startVal = knobs[key];
      knob.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    knob.addEventListener('pointermove', e => {
      if (!dragging) return;
      knobs[key] = Math.min(1, Math.max(0, startVal + (startY - e.clientY) / 150));
      setAngle(); onKnob(key);
    });
    knob.addEventListener('pointerup', () => { dragging = false; });
    knob.addEventListener('dblclick', () => { knobs[key] = 0.5; setAngle(); onKnob(key); });
    knob.addEventListener('wheel', e => {
      e.preventDefault();
      knobs[key] = Math.min(1, Math.max(0, knobs[key] - Math.sign(e.deltaY) * 0.03));
      setAngle(); onKnob(key);
    }, { passive: false });
    return wrap;
  }

  function onKnob(key) {
    if (key === 'volume' && masterGain) masterGain.gain.setTargetAtTime(knobs.volume, ctx.currentTime, 0.01);
    if (key === 'tempo') updateDisplay();
  }

  function voiceCol(title, rows) {
    const col = h('div', 't9-vcol');
    col.appendChild(h('div', 't9-vcol-title', title));
    rows.forEach(r => {
      const row = h('div', 't9-knob-pair');
      r.forEach(k => row.appendChild(k));
      col.appendChild(row);
    });
    return col;
  }

  function build(root) {
    root.innerHTML = '';
    const scale = h('div', 't9-scale');
    const chassis = h('div', 't9-chassis');
    scale.appendChild(chassis);
    root.appendChild(scale);

    chassis.appendChild(h('div', 't9-trim'));
    [[10, 22], [1096, 22], [10, 718], [1096, 718]].forEach(([x, y]) => {
      const s = h('div', 't9-screw');
      s.style.left = x + 'px'; s.style.top = y + 'px';
      chassis.appendChild(s);
    });

    // header
    const header = h('div', 't9-header');
    const brand = h('div');
    brand.appendChild(h('div', 't9-title', 'TR-909'));
    const tag = h('div', 't9-tag');
    tag.appendChild(h('div', 't9-tag-main', 'RHYTHM COMPOSER'));
    tag.appendChild(h('div', 't9-tag-sub', 'DIGITAL SEQUENCE MUSIC PLAYER'));
    header.appendChild(brand); header.appendChild(tag);
    chassis.appendChild(header);

    const body = h('div', 't9-body');
    chassis.appendChild(body);

    // ── voice knob panel ──
    const panel = h('div', 't9-voice-panel');
    const div = () => panel.appendChild(h('div', 't9-vdivider'));

    const accentCol = h('div', 't9-vcol');
    const accentTitle = h('button', 't9-vcol-title t9-accent-title', 'ACCENT');
    accentTitle.title = 'Click to edit the accent lane';
    accentTitle.addEventListener('click', () => selectLane('accent'));
    ui.accentTitle = accentTitle;
    accentCol.appendChild(accentTitle);
    accentCol.appendChild(createKnob('accentAmt', 'TOTAL', 'LEVEL', 38));
    panel.appendChild(accentCol); div();

    panel.appendChild(voiceCol('BASS DRUM', [
      [createKnob('bdTune', 'TUNE', null, 32), createKnob('bdLevel', 'LEVEL', null, 32)],
      [createKnob('bdAttack', 'ATTACK', null, 32), createKnob('bdDecay', 'DECAY', null, 32)],
    ])); div();

    panel.appendChild(voiceCol('SNARE DRUM', [
      [createKnob('sdTune', 'TUNE', null, 32), createKnob('sdLevel', 'LEVEL', null, 32)],
      [createKnob('sdTone', 'TONE', null, 32), createKnob('sdSnappy', 'SNAPPY', null, 32)],
    ])); div();

    const toms = h('div', 't9-knob-trio');
    [['LOW TOM', 'lt'], ['MID TOM', 'mt'], ['HI TOM', 'ht']].forEach(([t, id]) => {
      const col = h('div', 't9-vcol');
      col.appendChild(h('div', 't9-vcol-title', t));
      const pair = h('div', 't9-knob-pair');
      pair.appendChild(createKnob(id + 'Tune', 'TUNE', null, 30));
      pair.appendChild(createKnob(id + 'Level', 'LEVEL', null, 30));
      col.appendChild(pair);
      col.appendChild(createKnob(id + 'Decay', 'DECAY', null, 30));
      toms.appendChild(col);
    });
    panel.appendChild(toms); div();

    const rimClap = h('div', 't9-vcol');
    rimClap.appendChild(h('div', 't9-vcol-title', 'RIM / CLAP'));
    const rcPair = h('div', 't9-knob-pair');
    rcPair.appendChild(createKnob('rimLevel', 'RIM', 'LEVEL', 30));
    rcPair.appendChild(createKnob('clapLevel', 'CLAP', 'LEVEL', 30));
    rimClap.appendChild(rcPair);
    panel.appendChild(rimClap); div();

    const hatCym = h('div', 't9-vcol');
    hatCym.appendChild(h('div', 't9-vcol-title', 'HI-HAT / CYMBAL'));
    const hcPair = h('div', 't9-knob-pair');
    hcPair.appendChild(createKnob('hhLevel', 'H-H', 'LEVEL', 30));
    hcPair.appendChild(createKnob('cymLevel', 'CYM', 'LEVEL', 30));
    hatCym.appendChild(hcPair);
    panel.appendChild(hatCym);

    body.appendChild(panel);

    // ── mid row: slots, display, tempo/volume, options ──
    const mid = h('div', 't9-mid');

    const matrix = h('div', 't9-matrix');
    for (let c = 0; c < 4; c++) {
      const col = h('div', 't9-matrix-col');
      [c, c + 4].forEach(i => {
        const b = h('button', 't9-mbtn', SLOTS[i]);
        b.addEventListener('click', () => selectSlot(i));
        ui.slotBtns.push(b);
        col.appendChild(b);
      });
      matrix.appendChild(col);
    }
    mid.appendChild(matrix);

    const disp = h('div', 't9-display');
    const dHead = h('div', 't9-disp-head');
    dHead.appendChild(h('div', 't9-disp-badge', 'LIST'));
    ui.dispBpm = h('div', 't9-disp-bpm');
    dHead.appendChild(ui.dispBpm);
    disp.appendChild(dHead);
    const r1 = h('div', 't9-disp-row');
    r1.appendChild(h('div', 't9-disp-key', 'PATTERN'));
    ui.dispPattern = h('div', 't9-disp-val');
    r1.appendChild(ui.dispPattern);
    disp.appendChild(r1);
    const r2 = h('div', 't9-disp-row');
    r2.appendChild(h('div', 't9-disp-key', 'KIT'));
    r2.appendChild(h('div', 't9-disp-val', '909 Basic Kit'));
    disp.appendChild(r2);
    mid.appendChild(disp);

    const tempoBlock = h('div', 't9-tempo-block');
    tempoBlock.appendChild(createKnob('volume', 'VOLUME', 'MASTER', 42));
    tempoBlock.appendChild(createKnob('tempo', 'TEMPO', 'SHUFFLE', 36));
    mid.appendChild(tempoBlock);

    const options = h('div', 't9-options');
    options.appendChild(h('div', 't9-options-head', 'OPTIONS SELECT'));
    const optRow = h('div', 't9-options-row');
    [['PANEL', null, true], ['OPTION', null, false], ['HELP', helpText, false], ['ABOUT', aboutText, false]]
      .forEach(([label, content, dark]) => {
        const o = h('div', 't9-opt');
        const b = h('button', 't9-mbtn' + (dark ? ' t9-dark' : ''));
        if (content) b.addEventListener('click', () => showModal(label, content));
        o.appendChild(b);
        o.appendChild(h('div', 't9-opt-label', label));
        optRow.appendChild(o);
      });
    options.appendChild(optRow);
    mid.appendChild(options);

    body.appendChild(mid);

    // ── notation strip ──
    const notation = h('div', 't9-notation');
    notation.appendChild(h('div', 't9-notation-line'));
    const nRow = h('div', 't9-notation-row');
    for (let i = 0; i < 16; i++) nRow.appendChild(h('span', null, '♩'));
    notation.appendChild(nRow);
    notation.appendChild(h('div', 't9-notation-line'));
    body.appendChild(notation);

    // ── sequencer row ──
    const seq = h('div', 't9-seq');
    const transport = h('div', 't9-transport');
    ui.startBtn = h('button', 't9-tbtn t9-tbtn-start', 'START');
    ui.startBtn.addEventListener('click', start);
    const stopBtn = h('button', 't9-tbtn t9-tbtn-stop', 'STOP');
    stopBtn.addEventListener('click', stop);
    transport.appendChild(ui.startBtn); transport.appendChild(stopBtn);
    seq.appendChild(transport);

    const steps = h('div', 't9-steps');
    for (let i = 0; i < 16; i++) {
      const stepEl = h('div', 't9-step');
      stepEl.appendChild(h('div', 't9-step-num', String(i + 1)));
      const key = h('button', 't9-key');
      key.setAttribute('aria-label', 'Step ' + (i + 1));
      key.appendChild(h('div', 't9-led'));
      key.addEventListener('click', () => toggleStep(i));
      ui.keys.push(key);
      stepEl.appendChild(key);

      let label;
      if (i < VOICES.length) {
        label = h('button', 't9-step-label t9-voice-label', VOICES[i].legend);
        label.setAttribute('aria-label', 'Select ' + VOICES[i].legend + ' voice');
        label.addEventListener('click', () => selectLane(VOICES[i].id));
        ui.stepLabels[VOICES[i].id] = label;
      } else {
        label = h('div', 't9-step-label', DECOR_LEGENDS[i - VOICES.length]);
      }
      stepEl.appendChild(label);
      steps.appendChild(stepEl);
    }
    seq.appendChild(steps);
    body.appendChild(seq);

    // scale to fit
    const fit = () => {
      const w = root.clientWidth;
      const s = Math.min(1, w / (1120 + 40));
      scale.style.transform = 'scale(' + s + ')';
      // chassis height is layout-stable (fixed 1120px design); reserve the scaled space
      root.style.height = (chassis.offsetHeight * s + 80) + 'px';
    };
    window.addEventListener('resize', fit);
    fit();

    selectLane('bd');
    syncSlotUI();
    updateDisplay();
  }

  /* ── interactions ── */

  function toggleStep(i) {
    const p = patterns[activeSlot];
    p[selectedLane][i] = !p[selectedLane][i];
    renderSteps();
    // instant feedback when editing while stopped
    if (!playing && p[selectedLane][i] && selectedLane !== 'accent') {
      ensureAudio().then(() => trigger(selectedLane, ctx.currentTime, false));
    }
  }

  function selectLane(lane) {
    selectedLane = lane;
    Object.values(ui.stepLabels).forEach(l => l.classList.remove('t9-selected'));
    ui.accentTitle.classList.remove('t9-selected');
    if (lane === 'accent') ui.accentTitle.classList.add('t9-selected');
    else ui.stepLabels[lane].classList.add('t9-selected');
    renderSteps();
  }

  function renderSteps() {
    const lane = patterns[activeSlot][selectedLane];
    ui.keys.forEach((k, i) => k.classList.toggle('t9-on', lane[i]));
  }

  function selectSlot(i) {
    if (playing && i !== activeSlot) {
      pendingSlot = i;
      syncSlotUI();
    } else if (!playing) {
      activeSlot = i; pendingSlot = -1;
      syncSlotUI(); renderSteps(); updateDisplay();
    }
  }

  function syncSlotUI() {
    ui.slotBtns.forEach((b, i) => {
      b.classList.toggle('t9-active', i === activeSlot);
      b.classList.toggle('t9-pending', i === pendingSlot);
    });
  }

  function updateDisplay(msg) {
    ui.dispBpm.textContent = msg || (bpm() + ' BPM');
    ui.dispPattern.textContent = 'Pattern ' + SLOTS[activeSlot];
  }

  /* ── modals ── */

  const helpText =
    'Pick a voice by clicking its name under a step key (BASS, SNARE, ...). ' +
    'Tap the 16 keys to place that voice’s hits, then press START. ' +
    'Click ACCENT (top left) to mark steps that hit harder. ' +
    'A–H hold eight patterns — switch live and the change lands on the next bar. ' +
    'Drag knobs up/down to tweak each sound. Double-click a knob to reset it.';
  const aboutText =
    'A web tribute to the Roland TR-909 Rhythm Composer. ' +
    'Drum samples: the free "TR-909 Rhythm Composer Samples" set by Rob Roy Recordings, ' +
    'Minneapolis (1995) — free to use, never for sale. ' +
    'This site is not affiliated with or endorsed by Roland Corporation; ' +
    'TR-909 is a trademark of Roland Corporation. Patterns live in your browser session only.';

  function showModal(title, text) {
    const veil = h('div', 't9-modal-veil');
    const modal = h('div', 't9-modal');
    modal.appendChild(h('h3', null, title));
    modal.appendChild(h('p', null, text));
    const close = h('button', null, 'CLOSE');
    close.addEventListener('click', () => veil.remove());
    veil.addEventListener('click', e => { if (e.target === veil) veil.remove(); });
    modal.appendChild(close);
    veil.appendChild(modal);
    document.querySelector('#tr909-root .t9-chassis').appendChild(veil);
  }

  /* ── boot ── */

  function boot() {
    const root = document.getElementById('tr909-root');
    if (!root) { console.error('TR-909: #tr909-root not found'); return; }
    build(root);
    prefetchSamples();   // warm the sample cache so the first START is instant
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
