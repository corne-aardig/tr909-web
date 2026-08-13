#!/usr/bin/env node
/* Generates faceplate.html (static markup inserted into Webflow as native layers)
   and index.html (local dev harness wrapping the same fragment).
   The hydration script tr909.js binds to the data-t9-* attributes. */
'use strict';
const fs = require('fs');

const VOICES = [
  ['bd', 'BASS'], ['sd', 'SNARE'], ['lt', 'L-TOM'], ['mt', 'M-TOM'], ['ht', 'H-TOM'],
  ['rim', 'RIM'], ['clap', 'CLAP'], ['ch', 'CH-HAT'], ['oh', 'OH-HAT'], ['crash', 'CRASH'], ['ride', 'RIDE'],
];
const DECOR = ['SHUFF', 'LED-ON', 'ACC-1', 'ACC-2', 'ENTER'];

const knob = (key, size, label, sub) => `
<div class="t9-knob-wrap">
${label ? `<div class="t9-knob-label">${label}</div>` : ''}
<div class="t9-knob t9-knob-${size}" data-t9-knob="${key}"><div class="t9-knob-pointer"></div></div>
${sub ? `<div class="t9-knob-sub">${sub}</div>` : ''}
</div>`;

const vcolPair2 = (title, rows) => `
<div class="t9-vcol">
<div class="t9-vcol-title">${title}</div>
${rows.map(r => `<div class="t9-knob-pair">${r.join('')}</div>`).join('')}
</div>`;

const tomCol = (title, id) => `
<div class="t9-vcol">
<div class="t9-vcol-title">${title}</div>
<div class="t9-knob-pair">${knob(id + 'Tune', 30, 'TUNE')}${knob(id + 'Level', 30, 'LEVEL')}</div>
${knob(id + 'Decay', 30, 'DECAY')}
</div>`;

const divider = '<div class="t9-vdivider"></div>';

const voicePanel = `
<div class="t9-voice-panel">
<div class="t9-vcol">
<div class="t9-vcol-title t9-accent-title" data-t9-voice-select="accent" role="button" aria-label="Edit accent lane">ACCENT</div>
${knob('accentAmt', 38, 'TOTAL', 'LEVEL')}
</div>
${divider}
${vcolPair2('BASS DRUM', [[knob('bdTune', 32, 'TUNE'), knob('bdLevel', 32, 'LEVEL')], [knob('bdAttack', 32, 'ATTACK'), knob('bdDecay', 32, 'DECAY')]])}
${divider}
${vcolPair2('SNARE DRUM', [[knob('sdTune', 32, 'TUNE'), knob('sdLevel', 32, 'LEVEL')], [knob('sdTone', 32, 'TONE'), knob('sdSnappy', 32, 'SNAPPY')]])}
${divider}
<div class="t9-knob-trio">${tomCol('LOW TOM', 'lt')}${tomCol('MID TOM', 'mt')}${tomCol('HI TOM', 'ht')}</div>
${divider}
<div class="t9-vcol">
<div class="t9-vcol-title">RIM / CLAP</div>
<div class="t9-knob-pair">${knob('rimLevel', 30, 'RIM', 'LEVEL')}${knob('clapLevel', 30, 'CLAP', 'LEVEL')}</div>
</div>
${divider}
<div class="t9-vcol">
<div class="t9-vcol-title">HI-HAT / CYMBAL</div>
<div class="t9-knob-pair">${knob('hhLevel', 30, 'H-H', 'LEVEL')}${knob('cymLevel', 30, 'CYM', 'LEVEL')}</div>
</div>
</div>`;

const SLOTS = 'ABCDEFGH'.split('');
const matrix = `
<div class="t9-matrix">
${[0, 1, 2, 3].map(c => `<div class="t9-matrix-col">
<div class="t9-mbtn" data-t9-slot="${c}" role="button" aria-label="Pattern ${SLOTS[c]}">${SLOTS[c]}</div>
<div class="t9-mbtn" data-t9-slot="${c + 4}" role="button" aria-label="Pattern ${SLOTS[c + 4]}">${SLOTS[c + 4]}</div>
</div>`).join('')}
</div>`;

const display = `
<div class="t9-display">
<div class="t9-disp-head">
<div class="t9-disp-badge">LIST</div>
<div class="t9-disp-bpm" data-t9-display="bpm">120 BPM</div>
</div>
<div class="t9-disp-row"><div class="t9-disp-key">PATTERN</div><div class="t9-disp-val" data-t9-display="pattern">Pattern A</div></div>
<div class="t9-disp-row"><div class="t9-disp-key">KIT</div><div class="t9-disp-val">909 Basic Kit</div></div>
</div>`;

const tempoBlock = `
<div class="t9-tempo-block">
${knob('volume', 42, 'VOLUME', 'MASTER')}
${knob('tempo', 36, 'TEMPO', 'SHUFFLE')}
</div>`;

const options = `
<div class="t9-options">
<div class="t9-options-head">OPTIONS SELECT</div>
<div class="t9-options-row">
<div class="t9-opt"><div class="t9-mbtn t9-opt-dark"></div><div class="t9-opt-label">PANEL</div></div>
<div class="t9-opt"><div class="t9-mbtn"></div><div class="t9-opt-label">OPTION</div></div>
<div class="t9-opt"><div class="t9-mbtn" data-t9-modal-open="help" role="button" aria-label="Help"></div><div class="t9-opt-label">HELP</div></div>
<div class="t9-opt"><div class="t9-mbtn" data-t9-modal-open="about" role="button" aria-label="About"></div><div class="t9-opt-label">ABOUT</div></div>
</div>
</div>`;

const notation = `
<div class="t9-notation">
<div class="t9-notation-line"></div>
<div class="t9-notation-row">${'<div class="t9-note">♩</div>'.repeat(16)}</div>
<div class="t9-notation-line"></div>
</div>`;

const steps = Array.from({ length: 16 }, (_, i) => {
  const legend = i < 11
    ? `<div class="t9-step-label t9-voice-label" data-t9-voice-select="${VOICES[i][0]}" role="button" aria-label="Select ${VOICES[i][1]}">${VOICES[i][1]}</div>`
    : `<div class="t9-step-label">${DECOR[i - 11]}</div>`;
  return `<div class="t9-step">
<div class="t9-step-num">${i + 1}</div>
<div class="t9-key" data-t9-step="${i}" role="button" aria-label="Step ${i + 1}"><div class="t9-led"></div></div>
${legend}
</div>`;
}).join('');

const seq = `
<div class="t9-seq">
<div class="t9-transport">
<div class="t9-tbtn t9-tbtn-start" data-t9-transport="start" role="button">START</div>
<div class="t9-tbtn t9-tbtn-stop" data-t9-transport="stop" role="button">STOP</div>
</div>
<div class="t9-steps">${steps}</div>
</div>`;

const modal = (id, title, text) => `
<div class="t9-modal-veil t9-hidden" data-t9-modal="${id}">
<div class="t9-modal">
<div class="t9-modal-title">${title}</div>
<div class="t9-modal-text">${text}</div>
<div class="t9-modal-close" data-t9-modal-close="${id}" role="button">CLOSE</div>
</div>
</div>`;

const HELP = 'Pick a voice by clicking its name under a step key (BASS, SNARE, ...). Tap the 16 keys to place that voice’s hits, then press START. Click ACCENT (top left) to mark steps that hit harder. A–H hold eight patterns — switch live and the change lands on the next bar. Drag knobs up/down to tweak each sound. Double-click a knob to reset it.';
const ABOUT = 'A web tribute to the Roland TR-909 Rhythm Composer. Drum samples: the free "TR-909 Rhythm Composer Samples" set by Rob Roy Recordings, Minneapolis (1995) — free to use, never for sale. This site is not affiliated with or endorsed by Roland Corporation; TR-909 is a trademark of Roland Corporation. Patterns live in your browser session only.';

const chassisInner = `
<div class="t9-trim"></div>
<div class="t9-screw t9-screw-tl"></div>
<div class="t9-screw t9-screw-tr"></div>
<div class="t9-screw t9-screw-bl"></div>
<div class="t9-screw t9-screw-br"></div>
<div class="t9-header">
<div class="t9-title">TR-909</div>
<div class="t9-tag">
<div class="t9-tag-main">RHYTHM COMPOSER</div>
<div class="t9-tag-sub">DIGITAL SEQUENCE MUSIC PLAYER</div>
</div>
</div>
<div class="t9-body">
${voicePanel}
<div class="t9-mid">${matrix}${display}${tempoBlock}${options}</div>
${notation}
${seq}
</div>
${modal('help', 'HELP', HELP)}
${modal('about', 'ABOUT', ABOUT)}`;

const fragment = `<section class="t9-stage" id="tr909-root">
<div class="t9-scale">
<div class="t9-chassis">${chassisInner}
</div>
</div>
</section>`;

fs.writeFileSync(__dirname + '/faceplate.html', fragment + '\n');

const harness = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TR-909 Web — dev harness (hydration)</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;900&family=Geist+Mono:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="tr909.css">
<style>body { margin: 0; }</style>
</head>
<body>
${fragment}
<script src="tr909.js" defer></script>
</body>
</html>
`;
fs.writeFileSync(__dirname + '/index.html', harness);
console.log('wrote faceplate.html (' + fragment.length + ' bytes) and index.html');
