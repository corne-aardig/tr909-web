/* TR-909 Web v2 — hydration script.
   The faceplate is static markup (native Webflow layers on the live site,
   faceplate.html in the dev harness). This script finds elements by their
   data-t9-* attributes and wires up audio, sequencing, and state.
   Samples load relative to this script's URL. */
(function () {
  'use strict';

  /* ── configuration ── */

  const SAMPLE_BASE = (function () {
    const el = document.currentScript ||
      Array.from(document.querySelectorAll('script[src]')).find(s => /tr909\.js/.test(s.src));
    return el ? el.src.replace(/tr909\.js.*$/, '') : './';
  })();

  const VOICES = [
    { id: 'bd',    file: 'BT0AADA.WAV',  level: 'bdLevel'  },
    { id: 'sd',    file: 'ST0T0SA.WAV',  level: 'sdLevel'  },
    { id: 'lt',    file: 'LT0DA.WAV',    level: 'ltLevel'  },
    { id: 'mt',    file: 'MT0DA.WAV',    level: 'mtLevel'  },
    { id: 'ht',    file: 'HT0DA.WAV',    level: 'htLevel'  },
    { id: 'rim',   file: 'RIM127.WAV',   level: 'rimLevel' },
    { id: 'clap',  file: 'HANDCLP1.WAV', level: 'clapLevel'},
    { id: 'ch',    file: 'HHCDA.WAV',    level: 'hhLevel'  },
    { id: 'oh',    file: 'HHODA.WAV',    level: 'hhLevel'  },
    { id: 'crash', file: 'CSHD4.WAV',    level: 'cymLevel' },
    { id: 'ride',  file: 'RIDED4.WAV',   level: 'cymLevel' },
  ];
  const LANES = VOICES.map(v => v.id).concat(['accent']);
  const SLOTS = 'ABCDEFGH'.split('');

  /* ── state ── */

  const knobs = {                 // all 0..1
    accentAmt: 0.6,
    bdTune: 0.5, bdLevel: 0.85, bdAttack: 0.5, bdDecay: 0.7,
    sdTune: 0.5, sdLevel: 0.8,  sdTone: 0.5,   sdSnappy: 0.6,
    ltTune: 0.5, ltLevel: 0.75, ltDecay: 0.7,
    mtTune: 0.5, mtLevel: 0.75, mtDecay: 0.7,
    htTune: 0.5, htLevel: 0.75, htDecay: 0.7,
    rimLevel: 0.75, clapLevel: 0.8, hhLevel: 0.7, cymLevel: 0.6,
    volume: 0.8,
    tempo: (120 - 60) / 140,
  };
  const TUNE_RANGE = 7;           // semitones each way

  function emptyPattern() {
    const p = {};
    LANES.forEach(l => { p[l] = new Array(16).fill(false); });
    return p;
  }
  const patterns = SLOTS.map(emptyPattern);
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
  let openHatVoices = [];
  let loadPromise = null;
  let rawPromise = null;

  function prefetchSamples() {
    if (rawPromise) return rawPromise;
    rawPromise = Promise.all(VOICES.map(v =>
      fetch(SAMPLE_BASE + 'samples/' + v.file)
        .then(r => { if (!r.ok) throw new Error(v.file + ' HTTP ' + r.status); return r.arrayBuffer(); })
        .then(ab => [v.id, ab])
    ));
    rawPromise.catch(() => {});
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

    let semis = 0;
    if (voiceId === 'bd') semis = (knobs.bdTune - 0.5) * 2 * TUNE_RANGE;
    if (voiceId === 'sd') semis = (knobs.sdTune - 0.5) * 2 * TUNE_RANGE;
    if (voiceId === 'lt') semis = (knobs.ltTune - 0.5) * 2 * TUNE_RANGE;
    if (voiceId === 'mt') semis = (knobs.mtTune - 0.5) * 2 * TUNE_RANGE;
    if (voiceId === 'ht') semis = (knobs.htTune - 0.5) * 2 * TUNE_RANGE;
    src.playbackRate.value = Math.pow(2, semis / 12);

    let node = src;

    if (voiceId === 'sd') {
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 1500 + knobs.sdTone * 14000;
      node.connect(tone); node = tone;
      const snappy = ctx.createBiquadFilter();
      snappy.type = 'highshelf';
      snappy.frequency.value = 1800;
      snappy.gain.value = -18 + knobs.sdSnappy * 24;
      node.connect(snappy); node = snappy;
    }

    const env = ctx.createGain();
    if (voiceId === 'bd') {
      const boost = 0.4 + knobs.bdAttack * 1.2;
      env.gain.setValueAtTime(boost, time);
      env.gain.linearRampToValueAtTime(1, time + 0.015);
    } else {
      env.gain.setValueAtTime(1, time);
    }

    const decayKnob = { bd: 'bdDecay', lt: 'ltDecay', mt: 'mtDecay', ht: 'htDecay' }[voiceId];
    if (decayKnob) {
      const d = knobs[decayKnob];
      const dur = buf.duration / src.playbackRate.value;
      const tail = 0.04 + d * (dur - 0.04);
      env.gain.setValueAtTime(env.gain.value, time + Math.min(0.015, tail * 0.5));
      env.gain.exponentialRampToValueAtTime(0.001, time + tail);
    }

    node.connect(env);

    const out = ctx.createGain();
    const accentMul = accented ? 1 + knobs.accentAmt : 1;
    out.gain.value = Math.pow(knobs[v.level], 1.6) * accentMul;
    env.connect(out);
    out.connect(masterGain);

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
  let drawQueue = [];

  function scheduleStep(step, time) {
    const p = patterns[activeSlot];
    const accented = p.accent[step];
    VOICES.forEach(v => { if (p[v.id][step]) trigger(v.id, time, accented); });
    drawQueue.push({ step, time });
  }

  function scheduler() {
    while (nextNoteTime < ctx.currentTime + HORIZON) {
      scheduleStep(currentStep, nextNoteTime);
      nextNoteTime += (60 / bpm()) / 4;
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
      ui.startBtn.classList.add('t9-tbtn-running');
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
    ui.startBtn.classList.remove('t9-tbtn-running');
    ui.keys.forEach(k => k.classList.remove('t9-key-play'));
  }

  let lastDrawn = -1;
  function drawPlayhead() {
    if (!playing) return;
    let current = -1;
    while (drawQueue.length && drawQueue[0].time <= ctx.currentTime) {
      current = drawQueue.shift().step;
    }
    if (current >= 0 && current !== lastDrawn) {
      ui.keys.forEach(k => k.classList.remove('t9-key-play'));
      ui.keys[current].classList.add('t9-key-play');
      lastDrawn = current;
    }
    requestAnimationFrame(drawPlayhead);
  }

  /* ── hydration ── */

  const ui = { keys: [], leds: [], voiceLabels: {}, slotBtns: [], knobSetters: {} };
  let root = null;

  function hydrateKnob(el) {
    const key = el.getAttribute('data-t9-knob');
    if (!(key in knobs)) { console.warn('TR-909: unknown knob', key); return; }
    const pointer = el.querySelector('.t9-knob-pointer');
    const setAngle = () => {
      if (pointer) pointer.style.transform = 'rotate(' + (-135 + knobs[key] * 270 + 180) + 'deg)';
    };
    setAngle();
    ui.knobSetters[key] = setAngle;

    let dragging = false, startY = 0, startVal = 0;
    el.addEventListener('pointerdown', e => {
      dragging = true; startY = e.clientY; startVal = knobs[key];
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    el.addEventListener('pointermove', e => {
      if (!dragging) return;
      knobs[key] = Math.min(1, Math.max(0, startVal + (startY - e.clientY) / 150));
      setAngle(); onKnob(key);
    });
    el.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('dblclick', () => { knobs[key] = 0.5; setAngle(); onKnob(key); });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      knobs[key] = Math.min(1, Math.max(0, knobs[key] - Math.sign(e.deltaY) * 0.03));
      setAngle(); onKnob(key);
    }, { passive: false });
  }

  function onKnob(key) {
    if (key === 'volume' && masterGain) masterGain.gain.setTargetAtTime(knobs.volume, ctx.currentTime, 0.01);
    if (key === 'tempo') updateDisplay();
  }

  function hydrate() {
    const $ = s => root.querySelector(s);
    const $$ = s => Array.from(root.querySelectorAll(s));

    $$('[data-t9-knob]').forEach(hydrateKnob);

    // step keys, ordered by their index attribute
    $$('[data-t9-step]')
      .sort((a, b) => (+a.getAttribute('data-t9-step')) - (+b.getAttribute('data-t9-step')))
      .forEach(key => {
        const i = +key.getAttribute('data-t9-step');
        ui.keys[i] = key;
        ui.leds[i] = key.querySelector('.t9-led');
        key.addEventListener('click', () => toggleStep(i));
      });

    // voice / accent selectors
    $$('[data-t9-voice-select]').forEach(el => {
      const lane = el.getAttribute('data-t9-voice-select');
      ui.voiceLabels[lane] = el;
      el.addEventListener('click', () => selectLane(lane));
    });

    // pattern slots
    $$('[data-t9-slot]')
      .sort((a, b) => (+a.getAttribute('data-t9-slot')) - (+b.getAttribute('data-t9-slot')))
      .forEach(btn => {
        const i = +btn.getAttribute('data-t9-slot');
        ui.slotBtns[i] = btn;
        btn.addEventListener('click', () => selectSlot(i));
      });

    ui.startBtn = $('[data-t9-transport="start"]');
    ui.stopBtn = $('[data-t9-transport="stop"]');
    ui.startBtn.addEventListener('click', start);
    ui.stopBtn.addEventListener('click', stop);

    ui.dispBpm = $('[data-t9-display="bpm"]');
    ui.dispPattern = $('[data-t9-display="pattern"]');

    // modals
    $$('[data-t9-modal-open]').forEach(btn => {
      const id = btn.getAttribute('data-t9-modal-open');
      btn.addEventListener('click', () => {
        const veil = $('[data-t9-modal="' + id + '"]');
        if (veil) veil.classList.remove('t9-hidden');
      });
    });
    $$('[data-t9-modal]').forEach(veil => {
      veil.addEventListener('click', e => { if (e.target === veil) veil.classList.add('t9-hidden'); });
    });
    $$('[data-t9-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('[data-t9-modal]').classList.add('t9-hidden'));
    });

    // scale to fit
    const scale = $('.t9-scale');
    const chassis = $('.t9-chassis');
    const fit = () => {
      const w = root.clientWidth;
      const s = Math.min(1, w / (1120 + 40));
      scale.style.transform = 'scale(' + s + ')';
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
    if (!playing && p[selectedLane][i] && selectedLane !== 'accent') {
      ensureAudio().then(() => trigger(selectedLane, ctx.currentTime, false));
    }
  }

  function selectLane(lane) {
    selectedLane = lane;
    Object.entries(ui.voiceLabels).forEach(([id, el]) =>
      el.classList.toggle('t9-label-selected', id === lane));
    renderSteps();
  }

  function renderSteps() {
    const lane = patterns[activeSlot][selectedLane];
    ui.leds.forEach((led, i) => led.classList.toggle('t9-led-on', lane[i]));
  }

  let blinkTimer = null;
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
    ui.slotBtns.forEach((b, i) => b.classList.toggle('t9-mbtn-active', i === activeSlot));
    if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
    if (pendingSlot >= 0) {
      const btn = ui.slotBtns[pendingSlot];
      blinkTimer = setInterval(() => {
        if (pendingSlot < 0) { clearInterval(blinkTimer); blinkTimer = null; return; }
        btn.classList.toggle('t9-mbtn-active');
      }, 300);
    }
  }

  function updateDisplay(msg) {
    if (ui.dispBpm) ui.dispBpm.textContent = msg || (bpm() + ' BPM');
    if (ui.dispPattern) ui.dispPattern.textContent = 'Pattern ' + SLOTS[activeSlot];
  }

  /* ── boot ── */

  function boot() {
    root = document.getElementById('tr909-root');
    if (!root) { console.error('TR-909: #tr909-root not found'); return; }
    hydrate();
    prefetchSamples();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
