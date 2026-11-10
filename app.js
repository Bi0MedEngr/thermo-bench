// Thermo Bench — UI. Model → Core.run → diagrams, charts and results for four labs.
// Gas cycles: P–v and T–s diagrams with a moving state and a piston (or turbine) sketch.
// Moist air: a psychrometric chart with a draggable state and the process drawn on it.
// Heat exchanger: temperature profiles, a sketch of the arrangement, ε–NTU curve.
// Warm-up: the parts colored by temperature with heat flows, played back in time.
(() => {
  'use strict';
  const STORE_KEY = 'thermo-bench:model:v1';
  const $ = s => document.querySelector(s);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const { num, dur, pct } = Explain, TK = Core.TK;
  let model, res, downloads = null, u = 0, playing = false, lastTick = 0, drag = null, hover = null;
  const undoStack = [], redoStack = [];
  const LABS = [['cycles', 'Gas cycles'], ['psychro', 'Moist air'], ['hx', 'Heat exchanger'], ['warm', 'Warm-up']];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(model)); } catch (e) { /* storage unavailable */ } }
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { el.hidden = true; }, 3400); }
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function edit(fn, o = {}) { undoStack.push(JSON.stringify(model)); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; fn(); update(o); }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(model)); model = JSON.parse(undoStack.pop()); update({ play: false }); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(model)); model = JSON.parse(redoStack.pop()); update({ play: false }); }
  $('#undoBtn').addEventListener('click', undo); $('#redoBtn').addEventListener('click', redo);

  const animated = () => res && res.ok && (res.kind === 'cycles' || res.kind === 'warm');
  function update(o = {}) {
    res = Core.run(model); document.querySelector('.sheet').dataset.lab = model.lab;
    hover = null; u = 0; playing = animated() && !reduced && o.play !== false;
    if (!o.fast) { persist(); renderInputs(); }
    renderResults(); renderStatus(); syncTransport(); draw();
    if (mathOpen && !o.fast) renderMath();
  }
  function renderStatus() {
    const st = $('#status'); $('#modelName').textContent = model.name || '';
    if (!res.ok) { st.textContent = res.message; st.title = res.message; st.classList.add('bad'); return; }
    st.classList.remove('bad'); st.title = '';
    const r = res;
    st.textContent = ({
      cycles: () => `η ${pct(r.eta)} · ${num(r.wnet, 4)} kJ/kg · ${num(r.power, 3)} kW`,
      psychro: () => r.s2 ? `${num(r.s1.t, 3)} °C, ${num(r.s1.rh * 100, 3)} % → ${num(r.s2.t, 3)} °C, ${num(r.s2.rh * 100, 3)} %${r.load ? ` · ${num(r.load.qt, 3)} kW` : ''}` : `${num(r.s1.t, 3)} °C, ${num(r.s1.rh * 100, 3)} % RH · dew point ${num(r.s1.tdp, 3)} °C`,
      hx: () => `${num(r.q / 1000, 3)} kW · ε ${pct(r.eps)} · NTU ${num(r.ntu, 3)}`,
      warm: () => r.ctl === 'constant' ? `Settles at ${num(r.ss.T1, 4)} °C · τ ${dur(r.tauSlow)}` : r.tReach != null ? `Setpoint in ${dur(r.tReach)} · holds with ${num(r.need, 3)} W` : `Does not reach the setpoint`,
    })[r.kind]();
  }

  // ---------- inputs ----------
  function h(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v); }
    for (const k of kids) if (k != null) e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    return e;
  }
  // o.f: display factor (display = stored × f); o.id: prefix that keeps keys unique; o.after: runs inside the same edit
  function field(obj, key, label, unit, o = {}) {
    const f = o.f || 1, v = obj[key], id = (o.id || '') + key;
    const inp = h('input', { type: 'number', step: 'any', id: 'f-' + id, value: v == null ? '' : +(+(v * f).toPrecision(10)).toPrecision(7), 'data-key': id });
    inp.addEventListener('change', () => {
      const x = parseFloat(inp.value);
      if (!isFinite(x) || (o.min != null && x < o.min) || (o.max != null && x > o.max)) { inp.value = +(v * f).toPrecision(7); toast(`${label}: must be ${o.min != null ? '≥ ' + o.min : ''}${o.min != null && o.max != null ? ' and ' : ''}${o.max != null ? '≤ ' + o.max : ''}`); return; }
      edit(() => { obj[key] = x / f; if (o.after) o.after(x / f); });
    });
    return h('label', { class: 'field' }, h('span', { text: label }), h('span', { class: 'inp' }, inp, unit ? h('em', { text: unit }) : null));
  }
  function select(obj, key, label, options, after, id) {
    const s = h('select', { 'data-key': (id || '') + key, id: 's-' + (id || '') + key });
    for (const [v, tt] of options) s.appendChild(h('option', { value: v, text: tt, selected: String(v) === String(obj[key]) }));
    s.addEventListener('change', () => edit(() => { const old = obj[key], nv = typeof old === 'number' ? +s.value : s.value; obj[key] = nv; if (after) after(nv, old); }));
    return h('label', { class: 'field' }, h('span', { text: label }), s);
  }
  function check(obj, key, label, after) { const c = h('input', { type: 'checkbox', id: 'c-' + key }); c.checked = !!obj[key]; c.addEventListener('change', () => edit(() => { obj[key] = c.checked; if (after) after(c.checked); })); return h('label', { class: 'optn' }, c, h('span', { text: label })); }
  function seg(options, value, onPick) { const s = h('div', { class: 'seg' }); for (const [v, tt] of options) s.appendChild(h('button', { text: tt, class: v === value ? 'on' : null, 'data-v': v, onclick: () => onPick(v) })); return s; }
  const RATIO = { otto: 'Compression ratio', diesel: 'Compression ratio', dual: 'Compression ratio', brayton: 'Pressure ratio', stirling: 'Volume ratio', carnot: 'Isothermal volume ratio' };
  const MODES = [['rh', 'Relative humidity'], ['twb', 'Wet bulb'], ['tdp', 'Dew point'], ['w', 'Humidity ratio']], MODE_UNIT = { rh: '%', twb: '°C', tdp: '°C', w: 'g/kg' };
  const modeVal = (s, mode) => mode === 'rh' ? Math.min(100, +(s.rh * 100).toFixed(1)) : mode === 'twb' ? Math.min(s.t, +s.twb.toFixed(2)) : mode === 'tdp' ? Math.min(s.t, +s.tdp.toFixed(2)) : +(s.W * 1000).toFixed(3);
  function renderInputs() {
    const box = $('#inputs'), focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    box.innerHTML = '';
    const tabs = seg(LABS, model.lab, v => { if (v !== model.lab) edit(() => { model.lab = v; model.name = LABS.find(q => q[0] === v)[1]; }); }); tabs.style.flexWrap = 'wrap';
    box.append(h('h2', { text: 'Lab' }), tabs);
    const H2 = t => box.append(h('h2', { text: t })), add = (...els) => box.append(...els.filter(Boolean));
    if (model.lab === 'cycles') {
      const p = model.cycles, br = p.type === 'brayton';
      H2('Cycle'); add(select(p, 'type', 'Cycle', Object.entries(Core.CYCLES), v => { if (v === 'stirling' && !(p.regen > 0)) p.regen = 1; }), select(p, 'gas', 'Working gas', Object.entries(Core.GASES).map(([k, g]) => [k, g.name])));
      H2('Start of compression'); add(field(p, 'T1', 'Temperature', '°C', { min: -200 }), field(p, 'P1', 'Pressure', 'kPa', { min: 0.01 }));
      H2('Cycle limits'); add(field(p, 'r', RATIO[p.type], br ? 'P₂/P₁' : 'V₁/V₂', { min: 1.01 }), field(p, 'Tmax', 'Peak temperature', '°C'));
      if (p.type === 'dual') add(field(p, 'alpha', 'Pressure rise at constant volume', '×', { min: 1 }));
      if (br) add(field(p, 'etaC', 'Compressor efficiency', '%', { f: 100, min: 1, max: 100 }), field(p, 'etaT', 'Turbine efficiency', '%', { f: 100, min: 1, max: 100 }));
      if (br || p.type === 'stirling') add(field(p, 'regen', 'Regenerator effectiveness', '%', { f: 100, min: 0, max: 100 }));
      H2('Size'); if (br) add(field(p, 'mdot', 'Mass flow', 'kg/s', { min: 0 })); else add(field(p, 'Vd', 'Displacement', 'L', { min: 0.0001 }), field(p, 'rpm', 'Speed', 'rpm', { min: 0 }));
      H2('Diagrams'); add(check(p, 'logAxes', 'Log scales on the P–v diagram'));
      add(h('p', { class: 'note', text: 'Ideal gas with constant specific heats. Drag the slider above the diagrams, or press play, to walk around the cycle.' }));
    } else if (model.lab === 'psychro') {
      const p = model.psychro, cur = res && res.ok && res.kind === 'psychro' ? res : null;
      H2('Pressure'); add(check(p, 'useAlt', 'Set by altitude'), p.useAlt ? field(p, 'alt', 'Altitude', 'm', { min: -500, max: 9000 }) : field(p, 'P', 'Barometric pressure', 'kPa', { min: 20, max: 200 }));
      H2('State 1'); add(field(p, 't', 'Dry bulb', '°C', { min: -60, max: 90 }), select(p, 'mode', 'Second property', MODES, v => { if (cur) p.val = modeVal(cur.s1, v); }), field(p, 'val', MODES.find(q => q[0] === p.mode)[1], MODE_UNIT[p.mode]),
        field(p, 'flow', 'Airflow at state 1', 'm³/h', { min: 0 }));
      H2('Process'); add(select(p, 'process', 'What happens', [['none', 'Nothing (state only)'], ['sensible', 'Heat or cool'], ['coil', 'Cooling coil'], ['evap', 'Evaporative cooler'], ['steam', 'Steam humidifier'], ['mix', 'Mix with stream B']]));
      if (p.process === 'sensible') add(field(p, 't2', 'Leaving dry bulb', '°C'));
      if (p.process === 'coil') add(field(p, 'adp', 'Coil surface (apparatus dew point)', '°C'), field(p, 'bf', 'Bypass factor', '', { min: 0, max: 0.99 }));
      if (p.process === 'evap') add(field(p, 'eff', 'Effectiveness', '%', { f: 100, min: 0, max: 100 }));
      if (p.process === 'steam') add(field(p, 'rh2', 'Target humidity', '%', { min: 0.1, max: 100 }));
      if (p.process === 'mix') add(field(p, 'tB', 'Stream B dry bulb', '°C', { min: -60, max: 90 }), field(p, 'rhB', 'Stream B humidity', '%', { min: 0, max: 100 }), field(p, 'fB', 'Share of B (by dry-air mass)', '%', { min: 0, max: 100 }));
      add(h('p', { class: 'note', text: 'Drag point 1 on the chart. Hover anywhere under the saturation curve to read that state.' }));
    } else if (model.lab === 'hx') {
      const p = model.hx, cur = res && res.ok && res.kind === 'hx' ? res : null;
      H2('Arrangement'); const ts = select(p, 'type', 'Flow', Object.entries(Core.HX)); ts.querySelector('select').classList.add('wide'); ts.style.flexWrap = 'wrap'; add(ts);
      if (p.type === 'shell') add(select(p, 'shells', 'Shell passes', [[1, '1'], [2, '2'], [3, '3'], [4, '4']]));
      for (const [k, title] of [['hot', 'Hot stream'], ['cold', 'Cold stream']]) {
        const s = p[k]; H2(title);
        add(select(s, 'fluid', 'Fluid', Object.entries(Core.FLUIDS).map(([q, f]) => [q, f.name]), v => { if (Core.FLUIDS[v].cp) s.cp = Core.FLUIDS[v].cp; }, k + '-'), field(s, 'mdot', 'Mass flow', 'kg/s', { min: 0.000001, id: k + '-' }),
          field(s, 'cp', 'Specific heat', 'J/kg·K', { min: 1, id: k + '-', after: () => { s.fluid = 'custom'; } }), field(s, 'Tin', 'Inlet temperature', '°C', { id: k + '-' }));
      }
      H2('Exchanger'); add(seg([['rating', 'I have an exchanger'], ['sizing', 'Size one for me']], p.mode, v => { if (v !== p.mode) edit(() => { p.mode = v; if (cur) { if (v === 'rating') p.A = +cur.A.toPrecision(4); else p.targetVal = +(p.target === 'q' ? cur.q : p.target === 'Tco' ? cur.Tco : cur.Tho).toPrecision(4); } }); }));
      add(field(p, 'U', 'Overall coefficient U', 'W/m²K', { min: 0.001 }));
      if (p.mode === 'rating') add(field(p, 'A', 'Area', 'm²', { min: 0.000001 }));
      else add(select(p, 'target', 'Target', [['Tco', 'Cold outlet temperature'], ['Tho', 'Hot outlet temperature'], ['q', 'Heat rate']], v => { if (cur) p.targetVal = +(v === 'q' ? cur.q : v === 'Tco' ? cur.Tco : cur.Tho).toPrecision(4); }),
        p.target === 'q' ? field(p, 'targetVal', 'Heat rate', 'kW', { f: 1e-3, min: 0 }) : field(p, 'targetVal', p.target === 'Tco' ? 'Cold outlet' : 'Hot outlet', '°C'));
      add(h('p', { class: 'note', text: 'Typical U: water–water 800–1500, water–oil 100–350, gas–liquid (finned) 25–250, gas–gas 10–40 W/m²K.' }));
    } else {
      const p = model.warm;
      H2('Surroundings'); add(field(p, 'Tamb', 'Ambient', '°C', { min: -100 }), field(p, 'Tinit', 'Starting temperature', '°C', { min: -200 }));
      H2('Heater'); add(field(p, 'P', 'Heater power', 'W', { min: 0 }), seg([['constant', 'Constant'], ['onoff', 'On/off'], ['pi', 'PI']], p.control, v => { if (v !== p.control) edit(() => { p.control = v; }); }));
      if (p.control !== 'constant') add(field(p, 'setpoint', 'Setpoint', '°C'));
      if (p.control === 'onoff') add(field(p, 'hyst', 'Switching band', 'K', { min: 0.01 }));
      if (p.control === 'pi') add(field(p, 'Kp', 'Gain Kp', 'W/K', { min: 0.0001 }), field(p, 'Ti', 'Integral time Ti', 's', { min: 0.01 }));
      const part = (b, id) => add(select(b, 'mat', 'Material', Object.entries(Core.MATERIALS).map(([k, m]) => [k, m.name]), null, id), field(b, 'L', 'Length', 'mm', { min: 0.01, id }), field(b, 'W', 'Width', 'mm', { min: 0.01, id }), field(b, 'H', 'Height', 'mm', { min: 0.01, id }),
        field(b, 'exposed', 'Surface exposed', '%', { min: 0, max: 100, id }), field(b, 'h', 'Convection h', 'W/m²K', { min: 0, id }), field(b, 'emis', 'Emissivity', '', { min: 0, max: 1, id }));
      H2('Heater block'); part(p.block, 'b-');
      H2('Load'); add(check(p.load, 'on', 'A second part sits on the block', on => { if (!on) p.sensor = 1; }));
      if (p.load.on) { part(p.load, 'l-'); add(field(p, 'R12', 'Contact resistance', 'K/W', { min: 0.0001 }), select(p, 'sensor', 'Sensor is on the', [[1, 'Heater block'], [2, 'Load']])); }
      H2('Time'); add(field(p, 'tEnd', 'Time shown (0 = automatic)', 's', { min: 0 }));
      add(h('p', { class: 'note', text: 'Typical h: still air 5–15, fan 25–100 W/m²K. Emissivity: polished metal 0.05–0.1, anodized or painted 0.8–0.9.' }));
    }
    if (focusKey) { const el = box.querySelector(`[data-key="${focusKey}"]`); if (el) el.focus(); }
  }

  // ---------- results ----------
  const ICON = { pass: '<path d="m4 9.5 3.5 3.5L14 5.5"/>', warn: '<path d="M9 2.5 16.5 15h-15z"/><path d="M9 7.5v3.5M9 13v.2"/>', fail: '<path d="m4.5 4.5 9 9M13.5 4.5l-9 9"/>' };
  function renderResults() {
    const box = $('#results'); box.innerHTML = '';
    if (!res.ok) { box.append(h('h2', { text: 'Results' }), h('p', { class: 'note', text: res.message })); return; }
    const stat = (v, l) => h('div', { class: 'stat' }, h('b', { text: v, title: v }), h('span', { text: l }));
    const r = res, st = [], checks = [], extra = [];
    const chk = (lvl, t, d) => checks.push(h('li', { class: lvl }, h('span', { html: `<svg viewBox="0 0 18 18">${ICON[lvl]}</svg>` }), h('div', {}, h('b', { text: t }), d ? h('span', { text: d }) : null)));
    const table = (head, rows, cls) => h('div', { class: 'tblwrap' }, h('table', { class: 'pts' + (cls ? ' ' + cls : '') }, h('thead', {}, h('tr', {}, ...head.map(t => h('th', { text: t })))), h('tbody', {}, ...rows.map(row => h('tr', {}, ...row.map(c => h('td', { text: c })))))));
    if (r.kind === 'cycles') {
      const p = model.cycles;
      st.push(stat(pct(r.eta), 'Thermal efficiency'), stat(pct(r.etaCarnot), 'Carnot limit'), stat(`${num(r.wnet)} kJ/kg`, 'Net work'), stat(`${num(r.qin)} kJ/kg`, 'Heat supplied'),
        r.flow ? stat(pct(r.bwr), 'Back work ratio') : stat(`${num(r.mep)} kPa`, 'Mean effective pressure'), stat(`${num(Math.max(...r.S.map(s => s.P)))} kPa`, 'Peak pressure'), stat(`${num(r.power)} kW`, 'Power'), r.flow ? stat(`${num(r.heatRate)} kW`, 'Heat input rate') : stat(`${num(r.torque)} N·m`, 'Torque'));
      chk('pass', 'Energy balances', `heat in − heat out = ${num(r.qin - r.qout)} kJ/kg = net work`);
      if (r.formula != null) chk('pass', 'Matches the closed-form efficiency', pct(r.formula));
      if (p.type === 'brayton' && p.regen > 0 && !r.extra.regenUseful) chk('warn', 'The regenerator has nothing to recover', 'turbine exhaust is colder than the compressor outlet at this pressure ratio');
      if (p.type === 'brayton' && r.bwr > 0.7) chk('warn', 'Most of the turbine work drives the compressor', `back work ratio ${pct(r.bwr)}`);
      if ((p.type === 'otto') && p.gas === 'air' && p.r > 12) chk('warn', 'Above about 12:1 a gasoline engine knocks', 'fine for the ideal cycle; a real engine needs high-octane fuel or direct injection');
      if (p.Tmax > 2400) chk('warn', 'Peak temperature is beyond what real engines survive', 'metal and dissociation limits are near 2200–2500 °C in cylinders, 1500–1700 °C in turbines');
      extra.push(h('div', { class: 'sub2', text: 'States' }), table(['', 'T, °C', 'P, kPa', 'v, m³/kg', 's, kJ/kg·K'], r.S.map((s, i) => [String(i + 1), num(s.T - TK, 4), num(s.P, 4), num(s.v, 4), num(s.s, 4)])),
        h('div', { class: 'sub2', text: 'Processes, kJ/kg' }), table(['', 'What', 'Heat', 'Work'], r.P.map(c => [`${c.a + 1}→${c.b + 1}`, c.label, num(c.q, 4), num(c.w, 4)]), 'wrap2'));
    } else if (r.kind === 'psychro') {
      const s = r.s1, p = model.psychro;
      st.push(stat(`${num(s.rh * 100, 3)} %`, 'Relative humidity'), stat(`${num(s.W * 1000, 3)} g/kg`, 'Humidity ratio'), stat(`${num(s.tdp, 3)} °C`, 'Dew point'), stat(`${num(s.twb, 3)} °C`, 'Wet bulb'), stat(`${num(s.h, 4)} kJ/kg`, 'Enthalpy'), stat(`${num(s.v, 4)} m³/kg`, 'Specific volume'));
      if (r.load) { const L = r.load; st.push(stat(`${num(p.process === 'coil' ? L.qCoil : L.qt, 3)} kW`, p.process === 'coil' ? 'Coil load' : L.qt >= 0 ? 'Heat added to the air' : 'Heat removed'), stat(`${num(Math.abs(L.water) * 3600, 3)} kg/h`, L.water >= 0 ? 'Water added' : 'Water condensed'));
        if (p.process === 'coil') st.push(stat(`${num(Math.abs(L.qs), 3)} kW`, 'Sensible part'), stat(`${num(Math.abs(L.ql), 3)} kW`, 'Latent part')); }
      if (s.rh > 0.999) chk('warn', 'State 1 is saturated', 'any cooling will condense water');
      for (const n of r.notes) chk('warn', n);
      if (r.s2 && r.s2.rh > 0.95 && p.process !== 'mix') chk('warn', 'Leaving air is nearly saturated', `${num(r.s2.rh * 100, 3)} % RH: expect condensation on anything slightly cooler`);
      if (r.s2 && p.process === 'sensible' && r.s2.rh < 0.25) chk('warn', 'Heated air is very dry', `${num(r.s2.rh * 100, 3)} % RH`);
      const cols = [['1', s]]; if (r.sB) cols.push(['B', r.sB]); if (r.s2) cols.push([p.process === 'mix' ? 'Mix' : '2', r.s2]); if (r.adp) cols.push(['Coil', r.adp]);
      const rows = [['Dry bulb, °C', q => num(q.t, 4)], ['RH, %', q => num(q.rh * 100, 3)], ['W, g/kg', q => num(q.W * 1000, 4)], ['h, kJ/kg', q => num(q.h, 4)], ['Wet bulb, °C', q => num(q.twb, 3)], ['Dew point, °C', q => num(q.tdp, 3)], ['v, m³/kg', q => num(q.v, 4)], ['Vapor, kPa', q => num(q.pw, 3)]];
      extra.push(h('div', { class: 'sub2', text: `States at ${num(r.P, 4)} kPa` }), table(['', ...cols.map(c => c[0])], rows.map(([n, f]) => [n, ...cols.map(c => f(c[1]))])));
    } else if (r.kind === 'hx') {
      st.push(stat(`${num(r.q / 1000)} kW`, 'Heat rate'), stat(pct(r.eps), 'Effectiveness'), stat(`${num(r.Tho)} °C`, 'Hot outlet'), stat(`${num(r.Tco)} °C`, 'Cold outlet'), stat(`${num(r.A)} m²`, model.hx.mode === 'sizing' ? 'Area needed' : 'Area'), stat(num(r.ntu), 'NTU'),
        stat(`${num(r.lmtdCF)} K`, 'Log-mean ΔT'), stat(num(r.F), 'Correction factor F'));
      chk('pass', 'Both streams agree on the heat rate', `hot gives up ${num(r.Ch * (model.hx.hot.Tin - r.Tho) / 1000)} kW, cold picks up ${num(r.Cc * (r.Tco - model.hx.cold.Tin) / 1000)} kW`);
      if (r.cross) chk('warn', 'Temperature cross', 'the cold stream leaves hotter than the hot stream leaves; only counterflow-like arrangements do this well');
      if (r.F < 0.75) chk('warn', 'Low correction factor', `F = ${num(r.F, 3)}: add a shell pass or use counterflow`);
      if (r.eps > 0.97 * r.epsMax) chk('warn', 'More area buys almost nothing', `already at ${pct(r.eps)} of a possible ${pct(r.epsMax)} for this arrangement`);
      extra.push(h('div', { class: 'sub2', text: 'Streams' }), table(['', 'In, °C', 'Out, °C', 'C, W/K'], [['Hot', num(model.hx.hot.Tin), num(r.Tho), num(r.Ch)], ['Cold', num(model.hx.cold.Tin), num(r.Tco), num(r.Cc)]]));
    } else {
      const p = model.warm;
      if (r.ctl !== 'constant') st.push(stat(dur(r.tReach), 'Time to setpoint'), stat(r.tReach != null ? `${num(r.overshoot, 3)} K` : '—', 'Overshoot'), stat(`${num(r.need, 3)} W`, 'Power to hold'), stat(pct(r.need / p.P), 'Of the heater'));
      st.push(stat(`${num(r.ss.T1, 4)} °C`, 'Block at full power, steady'), stat(dur(r.tauSlow), 'Time constant'), stat(`${num(r.Ein / 3600, 3)} Wh`, 'Energy used'), stat(num(r.biot1, 2), 'Biot number'));
      if (r.two) st.push(stat(`${num(r.T2end, 4)} °C`, 'Load at the end'), stat(dur(r.tauFast), 'Parts equalize in'));
      if (r.canHold === false) chk('fail', 'The heater is too small', `holding ${num(p.setpoint)} °C takes ${num(r.need, 3)} W; it settles near ${num(r.sens === 2 ? r.ss.T2 : r.ss.T1, 4)} °C`);
      else if (r.ctl !== 'constant' && r.tReach == null) chk('warn', 'Setpoint not reached in the time shown', 'lengthen the time or raise the power');
      else if (r.ctl !== 'constant') chk('pass', 'Reaches and holds the setpoint', `${pct(r.need / p.P)} duty once warm`);
      if (r.ctl !== 'constant' && r.overshoot > Math.max(5, 0.05 * (p.setpoint - r.Ta))) chk('warn', 'Large overshoot', r.two && r.sens === 2 ? 'the block runs far hotter than the load while it catches up; lower the gain or the contact resistance' : 'lower the gain or lengthen the integral time');
      chk(Math.max(r.biot1, r.biot2 || 0) < 0.1 ? 'pass' : 'warn', Math.max(r.biot1, r.biot2 || 0) < 0.1 ? 'One temperature per part is a fair model' : 'Parts are not uniform inside', `Biot ${num(r.biot1, 2)}${r.two ? ` and ${num(r.biot2, 2)}` : ''} (want below 0.1)`);
      chk('pass', 'Energy books balance', `in ${num(r.Ein / 3600, 3)} Wh = lost ${num(r.Eloss / 3600, 3)} + stored ${num(r.U / 3600, 3)} Wh`);
      const row = (n, nm) => [nm, num(n.mass * 1000, 3), num(n.C, 3), num(n.A * 1e4, 3)];
      extra.push(h('div', { class: 'sub2', text: 'Parts' }), table(['', 'Mass, g', 'C, J/K', 'Area, cm²'], [row(r.n1, 'Block'), ...(r.two ? [row(r.n2, 'Load')] : [])]));
    }
    box.append(h('h2', { text: 'Results' }), h('div', { class: 'stats' }, ...st));
    if (checks.length) box.append(h('h2', { text: 'Checks' }), h('ul', { class: 'checks' }, ...checks));
    box.append(...extra);
    box.append(h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn primary', text: 'Show the math', onclick: openMath })));
  }

  // ---------- transport ----------
  const slider = $('#state');
  const lerpObj = (a, b, f) => { const o = {}; for (const k of Object.keys(a)) o[k] = typeof a[k] === 'number' ? a[k] + (b[k] - a[k]) * f : a[k]; return o; };
  function cyclePoint(uu) {
    const n = res.P.length, x = clamp(uu, 0, 1) * n, i = Math.min(Math.floor(x), n - 1), f = x - i, pts = res.P[i].pts, j = Math.min(Math.floor(f * (pts.length - 1)), pts.length - 2);
    return Object.assign(lerpObj(pts[j], pts[j + 1], f * (pts.length - 1) - j), { proc: res.P[i], i });
  }
  function warmFrame(uu) {
    const fr = res.frames, tt = clamp(uu, 0, 1) * res.tEnd; let i = clamp(Math.floor(uu * (fr.length - 1)), 0, fr.length - 2);
    while (i > 0 && fr[i].t > tt) i--; while (i < fr.length - 2 && fr[i + 1].t < tt) i++;
    return lerpObj(fr[i], fr[i + 1], clamp((tt - fr[i].t) / (fr[i + 1].t - fr[i].t || 1), 0, 1));
  }
  function syncTransport() {
    const an = animated();
    for (const id of ['#playBtn', '#restartBtn', '#state', '#speedSel']) $(id).hidden = !an;
    $('#playIcon').innerHTML = playing ? '<path d="M5 3v10M11 3v10"/>' : '<path d="M5 3l8 5-8 5z"/>';
    $('#playBtn').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (an) slider.value = Math.round(u * 1000);
    const out = $('#stateOut');
    if (hover && hover.text) { out.textContent = hover.text; return; }
    if (!res.ok) out.textContent = '';
    else if (res.kind === 'cycles') { const c = cyclePoint(u); out.textContent = `${c.proc.a + 1}→${c.proc.b + 1} ${c.proc.label} · ${num(c.T - TK, 4)} °C · ${num(c.P, 4)} kPa · ${num(c.v, 3)} m³/kg`; }
    else if (res.kind === 'warm') { const f = warmFrame(u); out.textContent = `t ${dur(f.t)} · block ${num(f.T1, 4)} °C${res.two ? ` · load ${num(f.T2, 4)} °C` : ''} · heater ${num(f.Pavg, 3)} W · losing ${num(f.loss1 + f.loss2, 3)} W`; }
    else if (res.kind === 'psychro') out.textContent = 'Drag point 1. Hover the chart to read any state.';
    else out.textContent = 'Hover a chart to read values.';
  }
  slider.addEventListener('input', () => { playing = false; u = slider.value / 1000; syncTransport(); draw(); });
  $('#playBtn').addEventListener('click', () => { if (!animated()) return; if (!playing && u >= 1 - 1e-9) u = 0; playing = !playing; lastTick = 0; syncTransport(); });
  $('#restartBtn').addEventListener('click', () => { u = 0; syncTransport(); draw(); });
  function tick(now) {
    if (playing && animated()) {
      const dt = lastTick ? Math.min(0.05, (now - lastTick) / 1000) : 0; u += dt * +$('#speedSel').value / (res.kind === 'cycles' ? 7 : 9);
      if (res.kind === 'cycles') u %= 1; else if (u >= 1) { u = 1; playing = false; }
      syncTransport(); draw();
    }
    lastTick = now; requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---------- canvas helpers ----------
  const cv = $('#cv'), ctx = cv.getContext('2d');
  let W = 0, H = 0, charts = [], scene = null;
  const MONO = '"IBM Plex Mono", ui-monospace, monospace', SANS = '"IBM Plex Sans", sans-serif', COND = '"IBM Plex Sans Condensed", sans-serif';
  function resize() { const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1; W = r.width; H = r.height; cv.width = Math.round(W * d); cv.height = Math.round(H * d); ctx.setTransform(d, 0, 0, d, 0, 0); draw(); }
  function text(s, x, y, o = {}) { ctx.font = o.font || `500 12px ${MONO}`; ctx.fillStyle = o.color || css('--ink-2'); ctx.textAlign = o.align || 'center'; ctx.textBaseline = o.base || 'middle'; ctx.fillText(s, x, y); }
  function tag(s, x, y, o = {}) {            // text on a small paper-colored plate, so it reads over lines and fills
    ctx.font = o.font || `500 11.5px ${MONO}`; const w = ctx.measureText(s).width + 8, al = o.align || 'center', x0 = al === 'left' ? x - 4 : al === 'right' ? x - w + 4 : x - w / 2;
    ctx.globalAlpha = 0.86; ctx.fillStyle = css('--paper'); rr(x0, y - 8.5, w, 17, 4); ctx.fill(); ctx.globalAlpha = 1; text(s, x, y, o);
  }
  function rr(x, y, w, hh, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, hh, r); else ctx.rect(x, y, w, hh); }
  function arrow(x1, y1, x2, y2, color, w = 1.8, head = 8) {
    if (Math.hypot(x2 - x1, y2 - y1) < 2) return;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2 - head * 0.6 * Math.cos(a), y2 - head * 0.6 * Math.sin(a)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(a - 0.4), y2 - head * Math.sin(a - 0.4)); ctx.lineTo(x2 - head * Math.cos(a + 0.4), y2 - head * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill(); ctx.lineCap = 'butt';
  }
  // Cold blue → neutral → amber → red, for anything drawn by temperature.
  const RAMP = ['#4f86d6', '#b9bec6', '#eda100', '#e0452f'].map(hx => [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16)));
  function tempColor(T, lo, hi) { const f = clamp((T - lo) / ((hi - lo) || 1), 0, 1) * (RAMP.length - 1), i = Math.min(Math.floor(f), RAMP.length - 2), g = f - i; return `rgb(${RAMP[i].map((c, k) => Math.round(c + (RAMP[i + 1][k] - c) * g)).join(',')})`; }
  const split = (b, fr, gap = 10) => { let x = b.x; const tot = fr.reduce((s, v) => s + v, 0); return fr.map(f => { const w = (b.w - gap * (fr.length - 1)) * f / tot, o = { x, y: b.y, w, h: b.h }; x += w + gap; return o; }); };
  const stack = (b, fr, gap = 6) => { let y = b.y; const tot = fr.reduce((s, v) => s + v, 0); return fr.map(f => { const hh = (b.h - gap * (fr.length - 1)) * f / tot, o = { x: b.x, y, w: b.w, h: hh }; y += hh + gap; return o; }); };

  function draw() {
    if (!W || !model || !res) return;
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = css('--paper'); ctx.fillRect(0, 0, W, H); charts = []; scene = null;
    if (!res.ok) { wrapText(res.message, W / 2, H / 2, Math.min(W - 40, 520)); return; }
    const all = { x: 8, y: 4, w: W - 16, h: H - 10 }, narrow = W < 620;
    ({ cycles: drawCycles, psychro: drawPsy, hx: drawHx, warm: drawWarm })[res.kind](all, narrow);
    if (hover && hover.sx != null) { ctx.strokeStyle = css('--ink'); ctx.fillStyle = css('--paper'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hover.sx, hover.sy, 4.5, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  function wrapText(s, x, y, maxW) {
    ctx.font = `500 14px ${SANS}`; const words = s.split(' '), lines = []; let cur = '';
    for (const w of words) { if (ctx.measureText(cur + ' ' + w).width > maxW && cur) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; } lines.push(cur);
    lines.forEach((l, i) => text(l, x, y + (i - (lines.length - 1) / 2) * 20, { color: css('--fail'), font: `500 14px ${SANS}` }));
  }

  // ---------- generic chart ----------
  function niceStep(span, n) { const raw = span / n || 1, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
  function drawChart(c, b) {
    const legend = c.legend || (c.series.filter(s => s.name).length > 1 ? c.series.filter(s => s.name).map(s => [s.name, s.col, s.dash]) : []);
    ctx.font = `600 12.5px ${COND}`; const titleW = ctx.measureText(c.title).width; ctx.font = `11.5px ${SANS}`;
    const legW = legend.reduce((s, l) => s + ctx.measureText(l[0]).width + 30, 0), twoRows = legend.length && titleW + legW + 16 > b.w;
    const pad = { l: 54, r: 12, t: twoRows ? 42 : 26, b: 30 }, px = b.x + pad.l, py = b.y + pad.t, pw = b.w - pad.l - pad.r, ph = b.h - pad.t - pad.b;
    if (pw < 60 || ph < 30) return;
    text(c.title, b.x + 4, b.y + 9, { align: 'left', font: `600 12.5px ${COND}`, color: css('--ink-2') });
    { let lx = twoRows ? b.x + 4 + legW : b.x + b.w - 6; const ly = twoRows ? b.y + 26 : b.y + 9;
      for (const l of legend.slice().reverse()) { ctx.font = `11.5px ${SANS}`; const w = ctx.measureText(l[0]).width; lx -= w; text(l[0], lx, ly, { align: 'left', color: css('--ink-2'), font: `11.5px ${SANS}` }); lx -= 20; ctx.strokeStyle = css(l[1]); ctx.lineWidth = 2.4; ctx.setLineDash(l[2] ? [4, 3] : []); ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 14, ly); ctx.stroke(); ctx.setLineDash([]); lx -= 10; } }
    const tx = v => c.logx ? Math.log10(Math.max(v, 1e-300)) : v, ty = v => c.logy ? Math.log10(Math.max(v, 1e-300)) : v;
    const sx = s => s.xs || c.xs, allX = c.series.flatMap(s => sx(s)).filter(isFinite).map(tx);
    let x0 = Math.min(...allX), x1 = Math.max(...allX); if (c.logx || c.padx) { const p = (x1 - x0) * 0.04 || 0.1; x0 -= p; x1 += p; }
    const allY = c.series.flatMap(s => s.ys).concat(c.hline ? [c.hline[0]] : []).filter(v => isFinite(v) && (!c.logy || v > 0)).map(ty);
    let y0 = Math.min(...allY), y1 = Math.max(...allY);
    if (c.logy || c.tight) { const p = (y1 - y0) * 0.08 || 0.5; y0 -= p; y1 += p; } else { y0 = Math.min(0, y0); const p = (y1 - y0) * 0.07 || 1; y1 += p; if (y0 < 0) y0 -= p; }
    if (!(y1 > y0)) y1 = y0 + 1; if (!(x1 > x0)) x1 = x0 + 1;
    const X = v => px + (tx(v) - x0) / (x1 - x0) * pw, Y = v => py + ph - (ty(v) - y0) / (y1 - y0) * ph;
    ctx.lineWidth = 1; ctx.strokeStyle = css('--grid'); const tf = `11px ${MONO}`, tc = css('--ink-3');
    const logTicks = (a, z, cb) => { const dec = z - a; for (let e = Math.floor(a); e <= Math.ceil(z); e++) for (const m of dec < 1.2 ? [1, 2, 3, 5, 7] : dec < 2.5 ? [1, 2, 5] : [1]) { const v = m * 10 ** e, l = Math.log10(v); if (l >= a - 1e-9 && l <= z + 1e-9) cb(v); } };
    const vline = v => { const x = Math.round(X(v)) + 0.5; ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, py + ph); ctx.stroke(); text(num(v, 3), x, py + ph + 11, { color: tc, font: tf }); };
    const hl = v => { const y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw, y); ctx.stroke(); text(num(v, 3), px - 6, y, { align: 'right', color: tc, font: tf }); };
    if (c.logx) logTicks(x0, x1, vline); else { const s = niceStep(x1 - x0, Math.max(2, Math.floor(pw / 80))); for (let v = Math.ceil(x0 / s - 1e-9) * s; v <= x1 + 1e-9; v += s) vline(Math.abs(v) < s * 1e-9 ? 0 : v); }
    if (c.logy) logTicks(y0, y1, hl); else { const s = niceStep(y1 - y0, Math.max(2, Math.floor(ph / 38))); for (let v = Math.ceil(y0 / s - 1e-9) * s; v <= y1 + 1e-9; v += s) hl(Math.abs(v) < s * 1e-9 ? 0 : v); }
    text(c.xl, px + pw, py + ph + 24, { align: 'right', color: tc, font: `11px ${SANS}` });
    if (!c.logy && y0 < 0 && y1 > 0) { ctx.strokeStyle = css('--ink-3'); ctx.beginPath(); ctx.moveTo(px, Y(0) + 0.5); ctx.lineTo(px + pw, Y(0) + 0.5); ctx.stroke(); }
    if (c.hline) { const col = css(c.hline[2] || '--fail'); ctx.strokeStyle = col; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.4; const y = Y(c.hline[0]); ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw, y); ctx.stroke(); ctx.setLineDash([]); text(c.hline[1], px + pw - 4, y - 9, { align: 'right', color: col, font: `11px ${SANS}` }); }
    ctx.save(); ctx.beginPath(); ctx.rect(px - 1, py - 1, pw + 2, ph + 2); ctx.clip();
    for (const s of c.series) {
      const xs = sx(s); ctx.strokeStyle = css(s.col); ctx.lineWidth = s.w || 2; ctx.lineJoin = 'round'; ctx.setLineDash(s.dash ? [5, 4] : []); ctx.beginPath();
      let on = false; s.ys.forEach((y, i) => { if (!isFinite(y) || !isFinite(xs[i]) || (c.logy && y <= 0)) { on = false; return; } const xx = X(xs[i]), yy = Y(y); on ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); on = true; });
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
    if (c.mark != null && isFinite(tx(c.mark)) && tx(c.mark) >= x0 && tx(c.mark) <= x1) { ctx.strokeStyle = css('--accent'); ctx.lineWidth = 1.2; const x = X(c.mark) + 0.5; ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, py + ph); ctx.stroke(); }
    for (const p of c.pts || []) { const x = X(p.x), y = Y(p.y); ctx.fillStyle = css('--paper'); ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(x, y, 3.6, 0, 7); ctx.fill(); ctx.stroke();
      const cx = px + pw / 2, cy = py + ph / 2, dx = x >= cx ? 11 : -11, dy = y >= cy ? 11 : -11; tag(p.label, clamp(x + dx, px + 8, px + pw - 8), clamp(y + dy, py + 9, py + ph - 9), { font: `600 12px ${MONO}`, color: css('--ink') }); }
    if (c.dot && isFinite(c.dot.x) && isFinite(c.dot.y)) { ctx.fillStyle = css('--accent'); ctx.strokeStyle = css('--paper'); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(c.dot.x), Y(c.dot.y), 5.5, 0, 7); ctx.fill(); ctx.stroke(); }
    charts.push({ px, pw, py, ph, c, X, Y });
  }

  // ---------- gas cycles ----------
  function drawCycles(b, narrow) {
    const r = res, lg = model.cycles.logAxes, cp = cyclePoint(u);
    const col = c => c.q > 1e-9 ? '--hot' : c.q < -1e-9 ? '--cold' : '--ink';
    const read = (si, pi) => { const q = r.P[si].pts[pi]; return `${r.P[si].a + 1}→${r.P[si].b + 1} ${r.P[si].label} · ${num(q.T - TK, 4)} °C (${num(q.T, 4)} K) · ${num(q.P, 4)} kPa · ${num(q.v, 3)} m³/kg · s ${num(q.s, 3)} kJ/kg·K`; };
    const legend = [['Heat in', '--hot'], ['Heat out', '--cold'], ['No heat', '--ink']];
    const pv = { title: 'P–v diagram, kPa', xl: 'specific volume, m³/kg', series: r.P.map(c => ({ xs: c.pts.map(q => q.v), ys: c.pts.map(q => q.P), col: col(c), dash: c.kind === 'adiabatic', w: 2.4 })), pts: r.S.map((s, i) => ({ x: s.v, y: s.P, label: String(i + 1) })), dot: { x: cp.v, y: cp.P }, logx: lg, logy: lg, legend, read, padx: true };
    const ts = { title: 'T–s diagram, K', xl: 'entropy, kJ/kg·K', series: r.P.map(c => ({ xs: c.pts.map(q => q.s), ys: c.pts.map(q => q.T), col: col(c), dash: c.kind === 'adiabatic', w: 2.4 })), pts: r.S.map((s, i) => ({ x: s.s, y: s.T, label: String(i + 1) })), dot: { x: cp.s, y: cp.T }, legend, read, padx: true };
    const br = r.flow, rl = br ? 'pressure ratio' : model.cycles.type === 'stirling' || model.cycles.type === 'carnot' ? 'volume ratio' : 'compression ratio';
    const eta = { title: 'Efficiency vs ' + rl + ', %', xs: r.sweep.map(q => q.r), xl: rl, series: [{ name: 'This cycle', ys: r.sweep.map(q => q.eta * 100), col: '--accent' }], mark: model.cycles.r, hline: [r.etaCarnot * 100, 'Carnot limit', '--ink-3'] };
    const wk = { title: 'Net work vs ' + rl + ', kJ/kg', xs: r.sweep.map(q => q.r), xl: rl, series: [{ ys: r.sweep.map(q => q.w > 0 ? q.w : NaN), col: '--s1' }], mark: model.cycles.r };
    if (narrow) { const [a, c, d, e, f] = stack(b, [24, 24, 16, 18, 18]); drawChart(pv, a); drawChart(ts, c); (br ? turbineSketch : pistonSketch)(d, cp, true); drawChart(eta, e); drawChart(wk, f); }
    else { const [top, bot] = stack(b, [60, 40]), [a, c, d] = split(top, [40, 40, 20]), [e, f] = split(bot, [1, 1]); drawChart(pv, a); drawChart(ts, c); (br ? turbineSketch : pistonSketch)(d, cp, false); drawChart(eta, e); drawChart(wk, f); }
  }
  function pistonSketch(b, cp, wide) {
    const r = res, Tlo = Math.min(...r.S.map(s => s.T)), Thi = Math.max(...r.S.map(s => s.T));
    text('Cylinder', b.x + 4, b.y + 9, { align: 'left', font: `600 12.5px ${COND}`, color: css('--ink-2') });
    const cw = clamp(Math.min(b.w * (wide ? 0.22 : 0.5), 110), 44, 110), top = b.y + (wide ? 44 : 70), bot = b.y + b.h - 34, span = bot - top, ph = Math.max(10, Math.min(18, span * 0.14)), cx = wide ? b.x + b.w * 0.3 : b.x + b.w / 2, x0 = cx - cw / 2;
    const travel = span - ph - 6, gh = Math.max(3, travel * cp.v / r.vmax), q = cp.proc.q;
    ctx.fillStyle = tempColor(cp.T, Tlo, Thi); ctx.fillRect(x0, top, cw, gh);
    ctx.fillStyle = css('--body'); rr(x0 + 1, top + gh, cw - 2, ph, 2); ctx.fill();
    ctx.strokeStyle = css('--body'); ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx, top + gh + ph); ctx.lineTo(cx, Math.min(bot + 8, top + gh + ph + span * 0.5)); ctx.stroke();
    ctx.strokeStyle = css('--ink'); ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(x0 - 1.5, bot); ctx.lineTo(x0 - 1.5, top - 1.5); ctx.lineTo(x0 + cw + 1.5, top - 1.5); ctx.lineTo(x0 + cw + 1.5, bot); ctx.stroke();
    if (q > 1e-9) { arrow(cx, top - 30, cx, top - 5, css('--hot'), 3, 9); }
    else if (q < -1e-9) { arrow(cx, top - 5, cx, top - 30, css('--cold'), 3, 9); }
    const lx = wide ? b.x + b.w * 0.56 : cx, lines = [q > 1e-9 ? 'heat in' : q < -1e-9 ? 'heat out' : 'no heat', `${num(cp.T - TK, 3)} °C`, `${num(cp.P, 3)} kPa`], cols = [q > 1e-9 ? css('--hot') : q < -1e-9 ? css('--cold') : css('--ink-3'), css('--ink'), css('--ink-2')];
    if (wide) lines.forEach((l, i) => text(l, lx, b.y + b.h / 2 - 18 + i * 18, { align: 'left', color: cols[i], font: `500 12.5px ${MONO}` }));
    else { text(lines[0], cx, b.y + 30, { color: cols[0], font: `500 12px ${SANS}` }); text(`${lines[1]} · ${lines[2]}`, cx, b.y + b.h - 12, { color: css('--ink'), font: `500 12px ${MONO}` }); }
  }
  function turbineSketch(b, cp, wide) {
    const r = res, act = cp.i, hi = i => act === i ? css('--accent') : css('--ink'), fillOf = i => act === i ? css('--accent-soft') : 'transparent';
    text('Gas turbine', b.x + 4, b.y + 9, { align: 'left', font: `600 12.5px ${COND}`, color: css('--ink-2') });
    const w = Math.min(b.w - 20, 260), x0 = b.x + (b.w - w) / 2, yMid = b.y + b.h * (wide ? 0.6 : 0.66), mh = clamp(b.h * 0.3, 34, 104), mw = w * 0.3, cxC = x0 + mw / 2 + 6, cxT = x0 + w - mw / 2 - 6, yB = Math.max(b.y + 30, yMid - mh / 2 - Math.min(48, b.h * 0.22));
    const trap = (cx, flip, i) => { const a = mh / 2, s = mh * 0.24; ctx.beginPath(); ctx.moveTo(cx - mw / 2, yMid - (flip ? s : a)); ctx.lineTo(cx + mw / 2, yMid - (flip ? a : s)); ctx.lineTo(cx + mw / 2, yMid + (flip ? a : s)); ctx.lineTo(cx - mw / 2, yMid + (flip ? s : a)); ctx.closePath(); ctx.fillStyle = fillOf(i); ctx.fill(); ctx.strokeStyle = hi(i); ctx.lineWidth = 2; ctx.stroke(); };
    ctx.strokeStyle = css('--ink-3'); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cxC + mw / 2, yMid); ctx.lineTo(cxT - mw / 2, yMid); ctx.stroke();
    trap(cxC, false, 0); trap(cxT, true, 2);
    const bw = w * 0.28, bx = x0 + w / 2 - bw / 2, bh = 28; ctx.fillStyle = fillOf(1); rr(bx, yB - bh / 2, bw, bh, 4); ctx.fill(); ctx.strokeStyle = hi(1); ctx.lineWidth = 2; rr(bx, yB - bh / 2, bw, bh, 4); ctx.stroke();
    ctx.strokeStyle = css('--ink-2'); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(cxC, yMid - mh * 0.3); ctx.lineTo(cxC, yB); ctx.lineTo(bx, yB); ctx.moveTo(bx + bw, yB); ctx.lineTo(cxT, yB); ctx.lineTo(cxT, yMid - mh * 0.3); ctx.stroke();
    arrow(x0 + w / 2, yB - bh / 2 - 22, x0 + w / 2, yB - bh / 2 - 3, css('--hot'), 2.5, 8);
    const tf = `500 11px ${MONO}`, T = i => `${num(r.S[i].T - TK, 3)}°`;
    tag('1 ' + T(0), cxC - mw / 2, yMid + mh / 2 + 12, { font: tf, align: 'left' }); tag('2 ' + T(1), cxC - mw / 2, yB - 14, { font: tf, align: 'left' }); tag('3 ' + T(2), cxT + mw / 2, yB - 14, { font: tf, align: 'right' }); tag('4 ' + T(3), cxT + mw / 2, yMid + mh / 2 + 12, { font: tf, align: 'right' });
    text(act === 3 ? 'exhaust heat leaves' : ['compressor', 'heat in', 'turbine'][act], x0 + w / 2, b.y + b.h - 10, { color: css('--accent'), font: `500 12px ${SANS}` });
    if (model.cycles.regen > 0 && r.extra.regenUseful) text(`regenerator preheats to ${num(r.extra.Tx - TK, 3)} °C`, x0 + w / 2, yMid + mh / 2 + 30 < b.y + b.h - 22 ? yMid + mh / 2 + 30 : b.y + 24, { color: css('--ink-3'), font: `11px ${SANS}` });
  }

  // ---------- psychrometric chart ----------
  function drawPsy(b) {
    const r = res, P = r.P, p = model.psychro, sts = [r.s1, r.s2, r.sB, r.adp].filter(Boolean);
    const t0 = Math.min(-10, Math.floor((Math.min(...sts.map(s => s.t)) - 4) / 5) * 5), t1 = Math.max(50, Math.ceil((Math.max(...sts.map(s => s.t)) + 4) / 5) * 5), wMax = Math.max(30, Math.ceil(Math.max(...sts.map(s => s.W)) * 1150 / 5) * 5);
    const pad = { l: 12, r: 44, t: 30, b: 34 }, px = b.x + pad.l, py = b.y + pad.t, pw = b.w - pad.l - pad.r, ph = b.h - pad.t - pad.b;
    const X = t => px + (t - t0) / (t1 - t0) * pw, Y = w => py + ph - w / wMax * ph, ws = t => Core.wOf(Core.pws(t), P) * 1000;
    scene = { px, py, pw, ph, X, Y, invX: x => t0 + (x - px) / pw * (t1 - t0), invY: y => (py + ph - y) / ph * wMax, P };
    text(`Psychrometric chart at ${num(P, 4)} kPa`, b.x + 4, b.y + 10, { align: 'left', font: `600 12.5px ${COND}`, color: css('--ink-2') });
    const tf = `11px ${MONO}`, tc = css('--ink-3'), narrow = pw < 520;
    ctx.save(); ctx.beginPath(); ctx.rect(px, py, pw, ph); ctx.clip();
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
    for (let t = Math.ceil(t0 / 5) * 5; t <= t1; t += 5) { const x = Math.round(X(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, py + ph); ctx.lineTo(x, Math.max(py, Y(Math.min(ws(t), wMax)))); ctx.stroke(); }
    for (let w = 5; w <= wMax; w += 5) { const y = Math.round(Y(w)) + 0.5, ts = Core.tsat(P * (w / 1000) / (0.621945 + w / 1000)); ctx.beginPath(); ctx.moveTo(Math.max(px, X(ts)), y); ctx.lineTo(px + pw, y); ctx.stroke(); }
    // fog region above the saturation curve
    ctx.beginPath(); ctx.moveTo(px, py); for (let i = 0; i <= 160; i++) { const t = t0 + (t1 - t0) * i / 160; ctx.lineTo(X(t), Y(Math.min(ws(t), wMax * 1.05))); } ctx.lineTo(px + pw, py); ctx.closePath(); ctx.fillStyle = css('--fog'); ctx.fill();
    // wet-bulb lines
    ctx.strokeStyle = css('--ink-3'); ctx.globalAlpha = 0.45; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    for (let tw = Math.ceil(t0 / 5) * 5; tw <= 40; tw += 5) { ctx.beginPath(); ctx.moveTo(X(tw), Y(ws(tw))); for (let t = tw + 1; t <= t1 + 1; t += 1) { const w = Core.wFromTwb(t, tw, P) * 1000; ctx.lineTo(X(t), Y(Math.max(w, 0))); if (w <= 0) break; } ctx.stroke(); }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // relative-humidity curves
    const rhLab = [];
    for (let rh = 10; rh <= 90; rh += 10) { ctx.strokeStyle = css('--ink-3'); ctx.globalAlpha = rh === 50 ? 0.9 : 0.55; ctx.lineWidth = rh === 50 ? 1.3 : 1; ctx.beginPath(); let last = null;
      for (let i = 0; i <= 160; i++) { const t = t0 + (t1 - t0) * i / 160, w = Core.wOf(rh / 100 * Core.pws(t), P) * 1000; i ? ctx.lineTo(X(t), Y(w)) : ctx.moveTo(X(t), Y(w)); if (w <= wMax * 0.93 && t <= t1 - (t1 - t0) * 0.04) last = [X(t), Y(w)]; }
      ctx.stroke(); if (last) rhLab.push([rh, last]); }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.beginPath(); for (let i = 0; i <= 200; i++) { const t = t0 + (t1 - t0) * i / 200; i ? ctx.lineTo(X(t), Y(ws(t))) : ctx.moveTo(X(t), Y(ws(t))); } ctx.stroke();
    for (const [rh, [x, y]] of rhLab) if (!narrow || rh % 20 === 0) tag(`${rh}%`, x - 4, y + 1, { font: `10.5px ${MONO}`, color: tc, align: 'right' });
    { const tl = t0 + (t1 - t0) * 0.2, sl = (Y(ws(tl + 2)) - Y(ws(tl - 2))) / (X(tl + 2) - X(tl - 2)); ctx.save(); ctx.translate(X(tl), Y(ws(tl))); ctx.rotate(Math.atan(sl)); text('saturation, 100 %', 0, -11, { color: css('--accent'), font: `500 11.5px ${SANS}` }); ctx.restore(); }
    // state 1 constructions: dew point (straight left) and wet bulb (along the wet-bulb line)
    const s = r.s1, w1 = s.W * 1000; ctx.strokeStyle = css('--ink-2'); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
    if (s.rh < 0.995 && s.W > 1e-6) {
      ctx.beginPath(); ctx.moveTo(X(s.t), Y(w1)); ctx.lineTo(X(s.tdp), Y(w1)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(s.t), Y(w1)); ctx.lineTo(X(s.twb), Y(ws(s.twb))); ctx.stroke(); ctx.setLineDash([]);
      for (const [t, w, lab, dy] of [[s.tdp, w1, `dew point ${num(s.tdp, 3)}°`, 12], [s.twb, ws(s.twb), `wet bulb ${num(s.twb, 3)}°`, -12]]) { ctx.fillStyle = css('--ink-2'); ctx.beginPath(); ctx.arc(X(t), Y(w), 3, 0, 7); ctx.fill(); if (X(t) > px + 4 && Y(w) > py + 4) tag(lab, clamp(X(t) - 6, px + 80, px + pw), clamp(Y(w) + dy, py + 10, py + ph - 10), { align: 'right', font: `11px ${SANS}`, color: css('--ink-2') }); }
    }
    ctx.setLineDash([]);
    // process
    const dotAt = (q, lab, colr, big) => { const x = X(q.t), y = Y(q.W * 1000); ctx.fillStyle = colr; ctx.strokeStyle = css('--paper'); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, big ? 7 : 5, 0, 7); ctx.fill(); ctx.stroke(); tag(lab, x + 12, y - 12, { font: `600 12px ${MONO}`, color: css('--ink'), align: 'left' }); };
    if (r.s2) {
      const x1 = X(s.t), y1 = Y(w1), x2 = X(r.s2.t), y2 = Y(r.s2.W * 1000), warmer = r.s2.t > s.t + 1e-9, colr = p.process === 'mix' ? css('--ink') : warmer ? css('--hot') : r.s2.t < s.t - 1e-9 ? css('--cold') : css('--s3');
      if (r.adp) { ctx.strokeStyle = css('--cold'); ctx.setLineDash([2, 4]); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(X(r.adp.t), Y(r.adp.W * 1000)); ctx.stroke(); ctx.setLineDash([]); dotAt(r.adp, 'coil', css('--cold'), false); }
      if (r.sB) { ctx.strokeStyle = css('--ink-2'); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(X(r.sB.t), Y(r.sB.W * 1000)); ctx.stroke(); dotAt(r.sB, 'B', css('--s1'), false); dotAt(r.s2, 'mix', css('--ink'), false); }
      else { arrow(x1, y1, x2, y2, colr, 3, 11); dotAt(r.s2, '2', colr, false); }
    }
    dotAt(s, '1', css('--accent'), true);
    ctx.restore();
    ctx.strokeStyle = css('--ink-3'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py + ph + 0.5); ctx.lineTo(px + pw + 0.5, py + ph + 0.5); ctx.lineTo(px + pw + 0.5, py); ctx.stroke();
    for (let t = Math.ceil(t0 / 5) * 5; t <= t1; t += narrow ? 10 : 5) text(String(t), X(t), py + ph + 12, { color: tc, font: tf });
    for (let w = 0; w <= wMax; w += 5) text(String(w), px + pw + 7, Y(w), { color: tc, font: tf, align: 'left' });
    text('dry-bulb temperature, °C', px + pw, py + ph + 26, { align: 'right', color: tc, font: `11px ${SANS}` });
    text('humidity ratio, g/kg dry air', b.x + b.w - 2, b.y + 10, { align: 'right', color: tc, font: `11px ${SANS}` });
    if (!narrow) text('dashed lines: constant wet bulb (nearly constant enthalpy)', px + 8, py + 14, { align: 'left', color: tc, font: `11px ${SANS}` });
    scene.s1 = [X(s.t), Y(w1)];
  }

  // ---------- heat exchanger ----------
  function drawHx(b, narrow) {
    const r = res, p = model.hx;
    const prof = r.profile ? { title: 'Temperature along the exchanger, °C', xs: r.profile.map(q => q.x), xl: 'position, from the hot inlet (0) to the hot outlet (1)', series: [{ name: 'Hot', ys: r.profile.map(q => q.Th), col: '--hot', w: 2.6 }, { name: 'Cold', ys: r.profile.map(q => q.Tc), col: '--cold', w: 2.6 }], tight: true,
      read: (si, pi) => `at ${num(r.profile[pi].x, 2)} of the length · hot ${num(r.profile[pi].Th, 4)} °C · cold ${num(r.profile[pi].Tc, 4)} °C · difference ${num(r.profile[pi].Th - r.profile[pi].Tc, 3)} K` }
      : { title: 'Inlet and outlet temperatures, °C', xs: [0, 1], xl: 'each stream from its inlet (0) to its outlet (1); the path between is not a straight line', series: [{ name: 'Hot', ys: [p.hot.Tin, r.Tho], col: '--hot', w: 2.6, dash: true }, { name: 'Cold', ys: [p.cold.Tin, r.Tco], col: '--cold', w: 2.6, dash: true }], tight: true,
        pts: [{ x: 0, y: p.hot.Tin, label: num(p.hot.Tin, 3) }, { x: 1, y: r.Tho, label: num(r.Tho, 3) }, { x: 0, y: p.cold.Tin, label: num(p.cold.Tin, 3) }, { x: 1, y: r.Tco, label: num(r.Tco, 3) }] };
    const en = { title: 'Effectiveness vs size (NTU), %', xs: r.curve.map(q => q.ntu), xl: 'NTU = UA / Cmin', series: [{ name: Core.HX[p.type], ys: r.curve.map(q => q.eps * 100), col: '--accent' }, ...(p.type === 'counter' ? [] : [{ name: 'Counterflow', ys: r.curve.map(q => q.epsCF * 100), col: '--ink-3', dash: true }])], mark: r.ntu, dot: { x: r.ntu, y: r.eps * 100 } };
    const ar = { title: 'Outlet temperatures vs area, °C', xs: r.curve.map(q => q.A), xl: 'area, m²', series: [{ name: 'Hot out', ys: r.curve.map(q => q.Tho), col: '--hot' }, { name: 'Cold out', ys: r.curve.map(q => q.Tco), col: '--cold' }], mark: r.A, tight: true };
    if (narrow) { const [a, c, d, e] = stack(b, [28, 22, 25, 25]); drawChart(prof, a); hxSketch(c); drawChart(en, d); drawChart(ar, e); }
    else { const [top, bot] = stack(b, [56, 44]), [a, c] = split(top, [58, 42]), [d, e] = split(bot, [1, 1]); drawChart(prof, a); hxSketch(c); drawChart(en, d); drawChart(ar, e); }
  }
  function hxSketch(b) {
    const r = res, p = model.hx, hot = css('--hot'), cold = css('--cold'), ink = css('--ink'), tf = `500 12px ${MONO}`;
    text(Core.HX[p.type], b.x + 4, b.y + 9, { align: 'left', font: `600 12.5px ${COND}`, color: css('--ink-2') });
    const w = Math.min(b.w - 110, 320), hh = clamp(b.h - 96, 44, 130), x0 = b.x + (b.w - w) / 2, y0 = b.y + 30 + (b.h - 60 - hh) / 2, x1 = x0 + w, y1 = y0 + hh, ym = (y0 + y1) / 2;
    const T = v => `${num(v, 3)} °C`;
    if (p.type === 'counter' || p.type === 'parallel') {
      const cf = p.type === 'counter', ih = hh * 0.34;
      ctx.fillStyle = css('--fog'); rr(x0, y0, w, hh, 6); ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 2; rr(x0, y0, w, hh, 6); ctx.stroke();
      ctx.fillStyle = css('--paper'); ctx.fillRect(x0 - 14, ym - ih / 2, w + 28, ih); ctx.fillStyle = css('--fail-soft'); ctx.fillRect(x0 - 14, ym - ih / 2, w + 28, ih);
      ctx.strokeStyle = ink; ctx.beginPath(); ctx.moveTo(x0 - 14, ym - ih / 2); ctx.lineTo(x1 + 14, ym - ih / 2); ctx.moveTo(x0 - 14, ym + ih / 2); ctx.lineTo(x1 + 14, ym + ih / 2); ctx.stroke();
      arrow(x0 + w * 0.3, ym, x0 + w * 0.7, ym, hot, 3, 10);
      const ya = y0 + (hh - ih) / 4; cf ? arrow(x0 + w * 0.7, ya, x0 + w * 0.3, ya, cold, 3, 10) : arrow(x0 + w * 0.3, ya, x0 + w * 0.7, ya, cold, 3, 10);
      const yb = y1 - (hh - ih) / 4; cf ? arrow(x0 + w * 0.7, yb, x0 + w * 0.3, yb, cold, 3, 10) : arrow(x0 + w * 0.3, yb, x0 + w * 0.7, yb, cold, 3, 10);
      tag(T(p.hot.Tin), x0 - 8, ym, { align: 'left', color: hot, font: tf }); tag(T(r.Tho), x1 + 8, ym, { align: 'right', color: hot, font: tf });
      tag(T(cf ? r.Tco : p.cold.Tin), x0 + 4, y0 - 12, { align: 'left', color: cold, font: tf }); tag(T(cf ? p.cold.Tin : r.Tco), x1 - 4, y0 - 12, { align: 'right', color: cold, font: tf });
      text('hot in the inner tube, cold in the jacket', b.x + b.w / 2, b.y + b.h - 10, { color: css('--ink-3'), font: `11px ${SANS}` });
    } else if (p.type === 'shell') {
      ctx.fillStyle = css('--fog'); rr(x0, y0, w, hh, hh / 2.4); ctx.fill(); ctx.strokeStyle = ink; ctx.lineWidth = 2; rr(x0, y0, w, hh, hh / 2.4); ctx.stroke();
      ctx.strokeStyle = css('--ink-3'); ctx.lineWidth = 1.4; for (let i = 1; i <= 4; i++) { const x = x0 + w * (0.15 + i * 0.14), up = i % 2; ctx.beginPath(); ctx.moveTo(x, up ? y0 : y1); ctx.lineTo(x, up ? y1 - hh * 0.28 : y0 + hh * 0.28); ctx.stroke(); }
      ctx.strokeStyle = hot; ctx.lineWidth = 3; const ty = hh * 0.2; ctx.beginPath(); ctx.moveTo(x0 - 14, ym - ty); ctx.lineTo(x1 - hh * 0.5, ym - ty); ctx.arc(x1 - hh * 0.5, ym, ty, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x0 - 14, ym + ty); ctx.stroke();
      arrow(x0 - 30, ym - ty, x0 - 10, ym - ty, hot, 3, 9); arrow(x0 - 10, ym + ty, x0 - 30, ym + ty, hot, 3, 9);
      arrow(x0 + w * 0.82, y0 - 26, x0 + w * 0.82, y0 - 2, cold, 3, 9); arrow(x0 + w * 0.2, y1 + 2, x0 + w * 0.2, y1 + 26, cold, 3, 9);
      tag(T(p.hot.Tin), x0 - 4, ym - ty - 14, { align: 'left', color: hot, font: tf }); tag(T(r.Tho), x0 - 4, ym + ty + 14, { align: 'left', color: hot, font: tf });
      tag(T(p.cold.Tin), x0 + w * 0.82 - 10, y0 - 16, { align: 'right', color: cold, font: tf }); tag(T(r.Tco), x0 + w * 0.2 + 10, y1 + 16, { align: 'left', color: cold, font: tf });
      text(`hot in the tubes (two passes), cold in ${p.shells > 1 ? p.shells + ' shells in series' : 'the shell'}`, b.x + b.w / 2, b.y + b.h - 10, { color: css('--ink-3'), font: `11px ${SANS}` });
    } else {
      const s = Math.min(w * 0.5, hh), cx = b.x + b.w / 2, xa = cx - s / 2, ya = ym - s / 2;
      ctx.fillStyle = css('--fog'); ctx.fillRect(xa, ya, s, s); ctx.strokeStyle = hot; ctx.lineWidth = 2; for (let i = 1; i <= 5; i++) { const y = ya + s * i / 6; ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xa + s, y); ctx.stroke(); }
      ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(xa, ya, s, s);
      arrow(xa - 40, ym, xa - 4, ym, hot, 3, 10); arrow(xa + s + 4, ym, xa + s + 40, ym, hot, 3, 10);
      for (const f of [0.3, 0.7]) { arrow(xa + s * f, ya + s + 26, xa + s * f, ya + s + 3, cold, 3, 9); arrow(xa + s * f, ya - 3, xa + s * f, ya - 26, cold, 3, 9); }
      tag(T(p.hot.Tin), xa - 44, ym - 14, { align: 'right', color: hot, font: tf }); tag(T(r.Tho), xa + s + 44, ym - 14, { align: 'left', color: hot, font: tf });
      tag(T(p.cold.Tin), cx, ya + s + 16, { color: cold, font: tf }); tag(T(r.Tco), cx, ya - 16, { color: cold, font: tf });
      text('hot through the tubes, cold across them', b.x + b.w / 2, b.y + b.h - 10, { color: css('--ink-3'), font: `11px ${SANS}` });
    }
  }

  // ---------- warm-up ----------
  function drawWarm(b, narrow) {
    const r = res, p = model.warm, f = warmFrame(u), mins = r.tEnd > 900, div = mins ? 60 : 1, xs = r.frames.map(q => q.t / div), xl = mins ? 'time, min' : 'time, s';
    const read = (si, pi) => { const q = r.frames[pi]; return `t ${dur(q.t)} · block ${num(q.T1, 4)} °C${r.two ? ` · load ${num(q.T2, 4)} °C` : ''} · heater ${num(q.Pavg, 3)} W · losing ${num(q.loss1 + q.loss2, 3)} W`; };
    const tc = { title: 'Temperature, °C', xs, xl, series: [{ name: 'Heater block', ys: r.frames.map(q => q.T1), col: '--s2', w: 2.4 }, ...(r.two ? [{ name: 'Load', ys: r.frames.map(q => q.T2), col: '--s1', w: 2.4 }] : [])], mark: f.t / div, hline: r.ctl !== 'constant' ? [p.setpoint, 'setpoint', '--ink-3'] : null, tight: true, read };
    const pc = { title: 'Heater power, W' + (r.ctl === 'onoff' ? ' (averaged over the switching)' : ''), xs, xl, series: [{ name: 'Heater', ys: r.frames.map(q => q.Pavg), col: '--accent' }, { name: 'Lost to the room', ys: r.frames.map(q => q.loss1 + q.loss2), col: '--cold' }], mark: f.t / div, read };
    const hc = r.two ? { title: 'Heat flows, W', xs, xl, series: [{ name: 'Block → load', ys: r.frames.map(q => q.q12), col: '--s3' }, { name: 'Block → room', ys: r.frames.map(q => q.loss1), col: '--s2' }, { name: 'Load → room', ys: r.frames.map(q => q.loss2), col: '--s1' }], mark: f.t / div, read }
      : { title: 'Where the heat goes, W', xs, xl, series: [{ name: 'Warming the block', ys: r.frames.map(q => q.Pavg - q.loss1), col: '--s2' }, { name: 'Lost to the room', ys: r.frames.map(q => q.loss1), col: '--cold' }], mark: f.t / div, read };
    if (narrow) { const [a, c, d, e] = stack(b, [24, 28, 24, 24]); warmSketch(a, f); drawChart(tc, c); drawChart(pc, d); drawChart(hc, e); }
    else { const [top, bot] = stack(b, [56, 44]), [a, c] = split(top, [36, 64]), [d, e] = split(bot, [1, 1]); warmSketch(a, f); drawChart(tc, c); drawChart(pc, d); drawChart(hc, e); }
  }
  function warmSketch(b, f) {
    const r = res, p = model.warm, B = p.block, Ld = p.load, two = r.two, Thi = Math.max(r.peak, r.Ti0, r.ctl !== 'constant' ? p.setpoint : r.ss.T1, r.Ta + 20), Tlo = Math.min(r.Ta, r.Ti0);
    text('Side view', b.x + 4, b.y + 9, { align: 'left', font: `600 12.5px ${COND}`, color: css('--ink-2') });
    const availW = b.w - 120, availH = b.h - 110, totH = B.H + (two ? Ld.H : 0), maxL = Math.max(B.L, two ? Ld.L : 0), s = Math.max(0.2, Math.min(availW / maxL, availH / totH)), cx = b.x + b.w / 2;
    const bw = B.L * s, bh = Math.max(8, B.H * s), lw = two ? Ld.L * s : 0, lh = two ? Math.max(6, Ld.H * s) : 0, yBot = b.y + 38 + (b.h - 96 + (bh + lh)) / 2, yTop = yBot - bh, on = f.Pavg > 0.02 * p.P && p.P > 0;
    // heater element under the block
    ctx.strokeStyle = on ? css('--hot') : css('--ink-3'); ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.beginPath(); const n = Math.max(6, Math.round(bw / 12)), hx0 = cx - bw * 0.42, hw = bw * 0.84;
    for (let i = 0; i <= n; i++) { const x = hx0 + hw * i / n, y = yBot + 8 + (i % 2 ? 7 : 0); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    text(`heater ${num(f.Pavg, 3)} W`, cx, yBot + 30, { color: on ? css('--hot') : css('--ink-3'), font: `500 12px ${MONO}` });
    ctx.fillStyle = tempColor(f.T1, Tlo, Thi); rr(cx - bw / 2, yTop, bw, bh, 3); ctx.fill(); ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1.8; rr(cx - bw / 2, yTop, bw, bh, 3); ctx.stroke();
    tag(`${num(f.T1, 4)} °C`, cx, yTop + bh / 2, { font: `600 13px ${MONO}`, color: css('--ink') });
    if (two) { ctx.fillStyle = tempColor(f.T2, Tlo, Thi); rr(cx - lw / 2, yTop - lh - 2, lw, lh, 3); ctx.fill(); ctx.strokeStyle = css('--ink'); rr(cx - lw / 2, yTop - lh - 2, lw, lh, 3); ctx.stroke(); tag(`${num(f.T2, 4)} °C`, cx, yTop - lh / 2 - 2, { font: `600 13px ${MONO}`, color: css('--ink') }); }
    // heat leaving: arrow length follows the loss
    const lmax = Math.max(1e-9, ...r.frames.map(q => Math.max(q.loss1, q.loss2))), len = q => 8 + 34 * clamp(Math.abs(q) / lmax, 0, 1), cold = css('--cold');
    if (f.loss1 > 0.005 * lmax) { arrow(cx + bw / 2 + 4, yTop + bh / 2, cx + bw / 2 + 4 + len(f.loss1), yTop + bh / 2 - 6, cold, 2.4, 8); arrow(cx - bw / 2 - 4, yTop + bh / 2, cx - bw / 2 - 4 - len(f.loss1), yTop + bh / 2 - 6, cold, 2.4, 8); }
    text(`${two ? 'block loses' : 'loses'} ${num(f.loss1, 3)} W`, b.x + b.w - 6, yBot + 30 > b.y + b.h - 8 ? b.y + b.h - 8 : b.y + b.h - 12, { align: 'right', color: cold, font: `500 11.5px ${MONO}` });
    if (two) { if (f.loss2 > 0.005 * lmax) arrow(cx, yTop - lh - 6, cx, yTop - lh - 6 - len(f.loss2), cold, 2.4, 8); text(`load loses ${num(f.loss2, 3)} W`, b.x + 6, b.y + 28, { align: 'left', color: cold, font: `500 11.5px ${MONO}` }); text(`${num(f.q12, 3)} W crosses the joint`, b.x + 6, b.y + 45, { align: 'left', color: css('--ink-2'), font: `500 11.5px ${MONO}` }); }
    text(`room ${num(r.Ta, 3)} °C`, b.x + 6, b.y + b.h - 12, { align: 'left', color: css('--ink-3'), font: `500 11.5px ${MONO}` });
  }

  // ---------- pointer: hover readouts, scrubbing, dragging the psychrometric state ----------
  const local = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const chartAt = (x, y) => charts.find(q => x >= q.px - 4 && x <= q.px + q.pw + 4 && y >= q.py - 4 && y <= q.py + q.ph + 4);
  const nearS1 = (x, y) => scene && scene.s1 && Math.hypot(x - scene.s1[0], y - scene.s1[1]) < 18;
  function setPsyFrom(x, y) {
    const p = model.psychro, t = clamp(Math.round(scene.invX(x) * 2) / 2, -55, 85), Ws = Core.wOf(Core.pws(t), scene.P), Wv = clamp(scene.invY(y) / 1000, 0, Ws);
    p.t = t; p.val = modeVal(Core.moist(t, Wv, scene.P), p.mode);
  }
  cv.addEventListener('pointerdown', e => {
    const [x, y] = local(e); if (!res.ok) return;
    if (res.kind === 'psychro' && nearS1(x, y)) { drag = { kind: 's1', snap: JSON.stringify(model), moved: false }; cv.setPointerCapture(e.pointerId); return; }
    const c = chartAt(x, y);
    if (c && res.kind === 'warm') { drag = { kind: 'scrub', c }; cv.setPointerCapture(e.pointerId); scrub(c, x); }
  });
  function scrub(c, x) { playing = false; hover = null; u = clamp((x - c.px) / c.pw, 0, 1); syncTransport(); draw(); }
  cv.addEventListener('pointermove', e => {
    const [x, y] = local(e); if (!res.ok) return;
    if (drag && drag.kind === 'scrub') { scrub(drag.c, x); return; }
    if (drag && drag.kind === 's1') { setPsyFrom(x, y); drag.moved = true; const rr2 = Core.run(model); if (rr2.ok) { res = rr2; hover = null; renderStatus(); renderResults(); syncTransport(); draw(); } return; }
    hover = null;
    if (res.kind === 'psychro' && scene) {
      const t = scene.invX(x), w = scene.invY(y) / 1000;
      if (x >= scene.px && x <= scene.px + scene.pw && y >= scene.py && y <= scene.py + scene.ph && w >= 0 && w <= Core.wOf(Core.pws(t), scene.P)) { const s = Core.moist(t, w, scene.P); hover = { sx: x, sy: y, text: `${num(s.t, 3)} °C · ${num(s.rh * 100, 3)} % RH · W ${num(s.W * 1000, 3)} g/kg · h ${num(s.h, 3)} kJ/kg · wet bulb ${num(s.twb, 3)} °C · dew point ${num(s.tdp, 3)} °C · v ${num(s.v, 3)} m³/kg` }; }
      cv.style.cursor = nearS1(x, y) ? 'grab' : 'crosshair';
    } else {
      const c = chartAt(x, y);
      if (c) {
        let best = null; c.c.series.forEach((s, si) => { const xs = s.xs || c.c.xs; s.ys.forEach((yy, pi) => { if (!isFinite(yy) || !isFinite(xs[pi])) return; const d = Math.hypot(c.X(xs[pi]) - x, (c.Y(yy) - y) * (s.xs ? 1 : 0.15)); if (!best || d < best.d) best = { d, si, pi, sx: c.X(xs[pi]), sy: c.Y(yy), x: xs[pi], y: yy, s }; }); });
        if (best && best.d < 60) hover = { sx: best.sx, sy: best.sy, text: c.c.read ? c.c.read(best.si, best.pi) : `${c.c.title.replace(/, [^,]*$/, '')}: ${best.s.name ? best.s.name + ' ' : ''}${num(best.y, 4)} at ${c.c.xl.split(',')[0].split(' = ')[0]} ${num(best.x, 4)}` };
      }
      cv.style.cursor = c ? (res.kind === 'warm' ? 'ew-resize' : 'crosshair') : 'default';
    }
    syncTransport(); if (!playing) draw();
  });
  const endDrag = () => { if (drag && drag.kind === 's1' && drag.moved) { undoStack.push(drag.snap); redoStack.length = 0; drag = null; update(); return; } drag = null; };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('pointerleave', () => { if (hover) { hover = null; syncTransport(); draw(); } });
  addEventListener('keydown', e => {
    const tg = (e.target.tagName || '').toLowerCase(); if (tg === 'input' || tg === 'select' || tg === 'textarea') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (e.key === ' ' && animated()) { e.preventDefault(); $('#playBtn').click(); return; }
    if (e.key === 'Escape' && mathOpen) closeMath();
  });

  // ---------- math drawer ----------
  let mathOpen = false;
  function renderMath() { $('#mathSub').textContent = model.name || ''; const body = $('#mathBody'); body.innerHTML = ''; Explain.explain(model, res).forEach((s, i) => { const d = h('details', {}); d.open = i < 4; d.append(h('summary', { text: s.title }), h('div', { html: s.html })); body.append(d); }); }
  function openMath() { mathOpen = true; renderMath(); $('#math').classList.add('open'); $('#math').setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false; }
  function closeMath() { mathOpen = false; $('#math').classList.remove('open'); $('#math').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }
  $('#mathBtn').addEventListener('click', () => mathOpen ? closeMath() : openMath());
  $('#mathClose').addEventListener('click', closeMath); $('#scrim').addEventListener('click', closeMath);

  // ---------- files ----------
  async function offerFile(filename, data) {
    if (downloads) { try { await downloads.save({ filename, data }); toast(`Saved ${filename}.`); } catch (err) { if (!err || err.code !== 'declined') toast(`Could not save ${filename} here.`); } return; }
    if (window.claude && window.claude.use) { toast('Saving files is not available in this view.'); return; }
    const blob = data instanceof Blob ? data : new Blob([data], { type: filename.endsWith('.csv') ? 'text/csv' : 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const fileSafe = s => (s || 'thermo').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'thermo';
  function dataCSV() {
    if (!res.ok) return null;
    const r = res, rows = [], g = v => +(+v).toPrecision(7);
    if (r.kind === 'cycles') { rows.push('process,T (K),P (kPa),v (m3/kg),s (kJ/kg.K)'); for (const c of r.P) for (const q of c.pts) rows.push([`${c.a + 1}-${c.b + 1} ${c.label}`, g(q.T), g(q.P), g(q.v), g(q.s)].join(',')); rows.push('', 'ratio,efficiency,net work (kJ/kg)'); for (const q of r.sweep) if (isFinite(q.eta)) rows.push([g(q.r), g(q.eta), g(q.w)].join(',')); }
    else if (r.kind === 'psychro') { rows.push('state,dry bulb (C),RH (%),W (g/kg),h (kJ/kg),wet bulb (C),dew point (C),v (m3/kg),vapor pressure (kPa)'); for (const [n, s] of [['1', r.s1], ['B', r.sB], ['2', r.s2], ['coil', r.adp]]) if (s) rows.push([n, g(s.t), g(s.rh * 100), g(s.W * 1000), g(s.h), g(s.twb), g(s.tdp), g(s.v), g(s.pw)].join(',')); if (r.load) rows.push('', 'sensible (kW),latent (kW),total (kW),water (kg/h)', [g(r.load.qs), g(r.load.ql), g(r.load.qt), g(r.load.water * 3600)].join(',')); }
    else if (r.kind === 'hx') { if (r.profile) { rows.push('position (0-1),hot (C),cold (C)'); for (const q of r.profile) rows.push([g(q.x), g(q.Th), g(q.Tc)].join(',')); rows.push(''); } rows.push('NTU,area (m2),effectiveness,hot out (C),cold out (C)'); for (const q of r.curve) rows.push([g(q.ntu), g(q.A), g(q.eps), g(q.Tho), g(q.Tco)].join(',')); }
    else { rows.push('t (s),block (C),load (C),heater (W),block loss (W),load loss (W),block to load (W)'); for (const q of r.frames) rows.push([g(q.t), g(q.T1), r.two ? g(q.T2) : '', g(q.Pavg), g(q.loss1), g(q.loss2), g(q.q12)].join(',')); }
    return rows.join('\n');
  }
  const fileMenu = $('#fileMenu');
  $('#fileBtn').addEventListener('click', e => { e.stopPropagation(); fileMenu.hidden = !fileMenu.hidden; });
  addEventListener('click', () => { fileMenu.hidden = true; });
  fileMenu.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; fileMenu.hidden = true;
    ({ open: () => $('#fileIn').click(), save: () => offerFile(fileSafe(model.name) + '.json', JSON.stringify(model, null, 1)),
      csv: () => { const c = dataCSV(); if (c) offerFile(fileSafe(model.name) + '.csv', c); else toast('Nothing to export yet.'); },
      png: () => cv.toBlob(bl => bl && offerFile(fileSafe(model.name) + '.png', bl), 'image/png') })[b.dataset.act]();
  });
  $('#fileIn').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const m = JSON.parse(await f.text()); if (!m.lab || !m[m.lab]) throw new Error('not a Thermo Bench file'); undoStack.push(JSON.stringify(model)); model = normalize(m); update(); toast(`Opened ${f.name}.`); }
    catch (err) { toast(`Could not open ${f.name}: ${err.message}.`); }
  });
  const presetSel = $('#presetSel');
  for (const [g, keys] of Presets.groups) { const og = h('optgroup', { label: g }); for (const k of keys) og.appendChild(h('option', { value: k, text: Presets.titles[k] })); presetSel.appendChild(og); }
  presetSel.addEventListener('change', () => { const k = presetSel.value; presetSel.value = ''; if (!k) return; undoStack.push(JSON.stringify(model)); const keep = model; model = Presets.list[k](); for (const [lab] of LABS) if (lab !== model.lab && keep[lab]) model[lab] = keep[lab]; update(); toast(`Loaded ${Presets.titles[k]}.`); });
  // Fill anything a saved file is missing from the defaults, one level into nested parts.
  function normalize(m) {
    const b = Presets.base(), merge = (d, s) => { for (const k of Object.keys(d)) if (s && s[k] != null) d[k] = d[k] && typeof d[k] === 'object' ? merge(d[k], s[k]) : (typeof d[k] === typeof s[k] ? s[k] : d[k]); return d; };
    for (const [k] of LABS) merge(b[k], m[k]);
    return Object.assign(b, { name: typeof m.name === 'string' ? m.name : '', lab: LABS.some(q => q[0] === m.lab) ? m.lab : 'cycles' });
  }

  window.__thermoBench = { get model() { return JSON.parse(JSON.stringify(model)); }, get result() { return res; }, get u() { return u; }, state1Screen: () => scene && scene.s1 ? scene.s1.slice() : null, charts: () => charts.map(q => ({ title: q.c.title, px: q.px, py: q.py, pw: q.pw, ph: q.ph })) };

  try { const s = localStorage.getItem(STORE_KEY); model = s ? normalize(JSON.parse(s)) : null; } catch (e) { model = null; }
  if (!model || !model.lab) model = Presets.list.otto();
  new ResizeObserver(resize).observe(cv);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => draw());
  new MutationObserver(() => draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => draw());
  if (window.claude && window.claude.use) window.claude.use('downloads').then(d => { downloads = d; }).catch(() => { downloads = null; });
  update();
})();
