// Thermo Bench — the engineering model. Pure functions, no DOM.
// Units: temperatures in °C at the interface (K inside where physics needs it), pressure kPa,
// specific volume m³/kg, specific energy kJ/kg, entropy kJ/kg·K, power W unless stated.
// Four labs: gas cycles (ideal gas, constant specific heats), psychrometrics (ASHRAE relations),
// heat exchangers (effectiveness-NTU) and lumped heater warm-up (one or two thermal masses).
const Core = (() => {
  'use strict';
  const SIGMA = 5.670374419e-8, TK = 273.15, P_ATM = 101.325;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function bisect(f, a, b, n = 80) { let fa = f(a); for (let i = 0; i < n; i++) { const m = 0.5 * (a + b), fm = f(m); if ((fm > 0) === (fa > 0)) { a = m; fa = fm; } else b = m; } return 0.5 * (a + b); }
  const bad = message => ({ ok: false, message });

  // ============================================================ gas cycles
  const GASES = {
    air: { name: 'Air', R: 0.287, k: 1.4 }, n2: { name: 'Nitrogen', R: 0.2968, k: 1.4 }, he: { name: 'Helium', R: 2.0769, k: 1.667 },
    ar: { name: 'Argon', R: 0.2081, k: 1.667 }, co2: { name: 'Carbon dioxide', R: 0.1889, k: 1.289 }, h2: { name: 'Hydrogen', R: 4.124, k: 1.405 },
  };
  function gasProps(key) { const g = GASES[key] || GASES.air, cv = g.R / (g.k - 1); return { name: g.name, R: g.R, k: g.k, cv, cp: g.k * cv }; }
  // Entropy is measured from 0 °C, 101.325 kPa.
  const entropy = (g, T, P) => g.cp * Math.log(T / TK) - g.R * Math.log(P / P_ATM);
  const st = (g, T, P) => ({ T, P, v: g.R * T / P, s: entropy(g, T, P) });
  const stTv = (g, T, v) => st(g, T, g.R * T / v);
  // One process between states a and b. flow = steady-flow device (work is shaft work).
  function proc(g, kind, S, ia, ib, flow, label) {
    const a = S[ia], b = S[ib]; let q = 0, w = 0;
    if (kind === 'isentropic' || kind === 'adiabatic') w = -(flow ? g.cp : g.cv) * (b.T - a.T);
    else if (kind === 'isochoric') q = g.cv * (b.T - a.T);
    else if (kind === 'isobaric') { q = g.cp * (b.T - a.T); w = flow ? 0 : a.P * (b.v - a.v); }
    else if (kind === 'isothermal') { q = w = g.R * a.T * Math.log(b.v / a.v); }
    const pts = [], n = 40;
    for (let i = 0; i <= n; i++) {
      const u = i / n; let T, P, v;
      if (kind === 'isochoric') { T = a.T + u * (b.T - a.T); v = a.v; P = g.R * T / v; }
      else if (kind === 'isobaric') { T = a.T + u * (b.T - a.T); P = a.P; v = g.R * T / P; }
      else { v = a.v * (b.v / a.v) ** u; P = a.P * (b.P / a.P) ** u; T = P * v / g.R; }
      pts.push({ T, P, v, s: entropy(g, T, P) });
    }
    return { kind, a: ia, b: ib, q, w, pts, label };
  }
  const CYCLES = { otto: 'Otto', diesel: 'Diesel', dual: 'Dual', brayton: 'Brayton', stirling: 'Stirling', carnot: 'Carnot' };
  // The cycle itself for one kilogram of gas. p: {type, gas, T1 °C, P1 kPa, r, Tmax °C, alpha, etaC, etaT, regen}
  function cycleStates(p) {
    const g = gasProps(p.gas), k = g.k, T1 = p.T1 + TK, P1 = p.P1, T3 = p.Tmax + TK, r = p.r, type = p.type;
    if (!(T1 > 0) || !(P1 > 0)) return bad('Start temperature and pressure must be above absolute zero.');
    if (!(r > 1)) return bad(type === 'brayton' ? 'Pressure ratio must be greater than 1.' : 'Compression ratio must be greater than 1.');
    if (!(T3 > T1)) return bad('Peak temperature must be above the start temperature.');
    const S = [st(g, T1, P1)], P = []; let qRegen = 0, formula = null, extra = {};
    const flow = type === 'brayton';
    const tooCold = T2 => bad(`Peak temperature is below the end-of-compression temperature (${(T2 - TK).toFixed(0)} °C): raise it or lower the ratio.`);
    if (type === 'otto' || type === 'diesel' || type === 'dual') {
      const T2 = T1 * r ** (k - 1); S.push(stTv(g, T2, S[0].v / r)); P.push(proc(g, 'isentropic', S, 0, 1, false, 'Compression'));
      if (type === 'otto') {
        if (T3 <= T2) return tooCold(T2);
        S.push(stTv(g, T3, S[1].v)); P.push(proc(g, 'isochoric', S, 1, 2, false, 'Heat in at constant volume'));
        S.push(stTv(g, T3 * r ** (1 - k), S[0].v)); P.push(proc(g, 'isentropic', S, 2, 3, false, 'Expansion'));
        P.push(proc(g, 'isochoric', S, 3, 0, false, 'Heat out at constant volume'));
        formula = 1 - r ** (1 - k);
      } else if (type === 'diesel') {
        if (T3 <= T2) return tooCold(T2);
        const rc = T3 / T2; if (rc >= r) return bad('Cutoff ratio reaches the compression ratio: the peak temperature is too high for this cycle.');
        S.push(st(g, T3, S[1].P)); P.push(proc(g, 'isobaric', S, 1, 2, false, 'Heat in at constant pressure'));
        S.push(stTv(g, T3 * (S[2].v / S[0].v) ** (k - 1), S[0].v)); P.push(proc(g, 'isentropic', S, 2, 3, false, 'Expansion'));
        P.push(proc(g, 'isochoric', S, 3, 0, false, 'Heat out at constant volume'));
        formula = 1 - r ** (1 - k) * (rc ** k - 1) / (k * (rc - 1)); extra.rc = rc;
      } else {
        const al = p.alpha; if (!(al >= 1)) return bad('Pressure rise ratio must be at least 1.');
        const Tx = al * T2; if (T3 < Tx) return bad(`Peak temperature is below the temperature after the constant-volume burn (${(Tx - TK).toFixed(0)} °C): raise it or lower the pressure rise.`);
        const rc = T3 / Tx; if (rc >= r) return bad('Cutoff ratio reaches the compression ratio: the peak temperature is too high for this cycle.');
        S.push(stTv(g, Tx, S[1].v)); P.push(proc(g, 'isochoric', S, 1, 2, false, 'Heat in at constant volume'));
        S.push(st(g, T3, S[2].P)); P.push(proc(g, 'isobaric', S, 2, 3, false, 'Heat in at constant pressure'));
        S.push(stTv(g, T3 * (S[3].v / S[0].v) ** (k - 1), S[0].v)); P.push(proc(g, 'isentropic', S, 3, 4, false, 'Expansion'));
        P.push(proc(g, 'isochoric', S, 4, 0, false, 'Heat out at constant volume'));
        formula = (al === 1 && rc === 1) ? 1 - r ** (1 - k) : 1 - r ** (1 - k) * (al * rc ** k - 1) / ((al - 1) + k * al * (rc - 1)); extra.rc = rc;
      }
    } else if (type === 'brayton') {
      const ec = p.etaC, et = p.etaT, e = p.regen || 0;
      if (!(ec > 0 && ec <= 1) || !(et > 0 && et <= 1)) return bad('Compressor and turbine efficiencies must be between 0 and 100 %.');
      if (!(e >= 0 && e <= 1)) return bad('Regenerator effectiveness must be between 0 and 100 %.');
      const x = r ** ((k - 1) / k), T2s = T1 * x, T2 = T1 + (T2s - T1) / ec;
      if (T3 <= T2) return tooCold(T2);
      const T4s = T3 / x, T4 = T3 - et * (T3 - T4s);
      S.push(st(g, T2, P1 * r)); P.push(proc(g, ec < 1 ? 'adiabatic' : 'isentropic', S, 0, 1, true, 'Compressor'));
      S.push(st(g, T3, P1 * r)); P.push(proc(g, 'isobaric', S, 1, 2, true, 'Heat in at constant pressure'));
      S.push(st(g, T4, P1)); P.push(proc(g, et < 1 ? 'adiabatic' : 'isentropic', S, 2, 3, true, 'Turbine'));
      P.push(proc(g, 'isobaric', S, 3, 0, true, 'Heat out at constant pressure'));
      qRegen = e * g.cp * Math.max(0, T4 - T2);
      extra = { T2s, T4s, Tx: T2 + e * Math.max(0, T4 - T2), Ty: T4 - e * Math.max(0, T4 - T2), regenUseful: T4 > T2 };
      if (ec === 1 && et === 1) formula = e === 0 ? 1 - 1 / x : e === 1 && T4 > T2 ? 1 - (T1 / T3) * x : null;
      extra.rOpt = (T3 / T1 * ec * et) ** (k / (2 * (k - 1)));
    } else if (type === 'stirling') {
      const e = p.regen == null ? 1 : p.regen; if (!(e >= 0 && e <= 1)) return bad('Regenerator effectiveness must be between 0 and 100 %.');
      S.push(stTv(g, T1, S[0].v / r)); P.push(proc(g, 'isothermal', S, 0, 1, false, 'Cold compression'));
      S.push(stTv(g, T3, S[1].v)); P.push(proc(g, 'isochoric', S, 1, 2, false, 'Regenerator heats the gas'));
      S.push(stTv(g, T3, S[0].v)); P.push(proc(g, 'isothermal', S, 2, 3, false, 'Hot expansion'));
      P.push(proc(g, 'isochoric', S, 3, 0, false, 'Regenerator cools the gas'));
      qRegen = e * g.cv * (T3 - T1); if (e === 1) formula = 1 - T1 / T3;
    } else if (type === 'carnot') {
      S.push(stTv(g, T1, S[0].v / r)); P.push(proc(g, 'isothermal', S, 0, 1, false, 'Cold compression'));
      S.push(stTv(g, T3, S[1].v * (T1 / T3) ** (1 / (k - 1)))); P.push(proc(g, 'isentropic', S, 1, 2, false, 'Compression'));
      S.push(stTv(g, T3, S[2].v * r)); P.push(proc(g, 'isothermal', S, 2, 3, false, 'Hot expansion'));
      P.push(proc(g, 'isentropic', S, 3, 0, false, 'Expansion'));
      formula = 1 - T1 / T3;
    } else return bad('Unknown cycle.');
    let qin = 0, qout = 0, wnet = 0, wIn = 0, wOut = 0;
    for (const c of P) { if (c.q > 0) qin += c.q; else qout -= c.q; wnet += c.w; if (c.w < 0) wIn -= c.w; else wOut += c.w; }
    qin -= qRegen; qout -= qRegen;
    const vs = S.map(s => s.v), vmax = Math.max(...vs), vmin = Math.min(...vs), Ts = S.map(s => s.T);
    return { ok: true, g, S, P, flow, qin, qout, wnet, wIn, wOut, qRegen, eta: wnet / qin, etaCarnot: 1 - Math.min(...Ts) / Math.max(...Ts), formula,
      mep: wnet / (vmax - vmin), bwr: wIn / wOut, vmax, vmin, extra };
  }
  function cycle(p, opt = {}) {
    const c = cycleStates(p); if (!c.ok) return c;
    c.kind = 'cycles'; c.type = p.type;
    if (c.flow) { c.mdot = p.mdot; c.power = p.mdot * c.wnet; c.heatRate = p.mdot * c.qin; }       // kW
    else { const cps = p.rpm / 60 / (p.type === 'stirling' || p.type === 'carnot' ? 1 : 2); c.mass = p.Vd * 1e-3 / (c.vmax - c.vmin); c.cps = cps; c.power = c.mass * c.wnet * cps; c.heatRate = c.mass * c.qin * cps; c.torque = p.rpm > 0 ? c.power * 1000 / (p.rpm * 2 * Math.PI / 60) : 0; }
    if (opt.sweep !== false) {
      const hi = p.type === 'brayton' ? Math.max(40, p.r * 1.6) : p.type === 'stirling' || p.type === 'carnot' ? Math.max(10, p.r * 1.6) : Math.max(24, p.r * 1.4), n = 90;
      c.sweep = []; for (let i = 0; i <= n; i++) { const r = 1.05 + (hi - 1.05) * i / n, q = cycleStates({ ...p, r }); c.sweep.push({ r, eta: q.ok && q.wnet > 0 ? q.eta : NaN, w: q.ok ? q.wnet : NaN }); }
    }
    return c;
  }

  // ============================================================ psychrometrics (ASHRAE Fundamentals, ch. 1)
  // Saturation pressure of water vapor, kPa (Hyland–Wexler): over ice below 0 °C, over liquid above.
  function pws(t) {
    const T = t + TK;
    const ln = t < 0 ? -5.6745359e3 / T + 6.3925247 - 9.677843e-3 * T + 6.2215701e-7 * T * T + 2.0747825e-9 * T ** 3 - 9.484024e-13 * T ** 4 + 4.1635019 * Math.log(T)
      : -5.8002206e3 / T + 1.3914993 - 4.8640239e-2 * T + 4.1764768e-5 * T * T - 1.4452093e-8 * T ** 3 + 6.5459673 * Math.log(T);
    return Math.exp(ln) / 1000;
  }
  const tsat = p => bisect(t => pws(t) - p, -100, 200);
  const wOf = (pw, p) => 0.621945 * pw / (p - pw);
  const hOf = (t, W) => 1.006 * t + W * (2501 + 1.86 * t);
  const tOfHW = (h, W) => (h - 2501 * W) / (1.006 + 1.86 * W);
  const altitudeP = z => P_ATM * (1 - 2.25577e-5 * z) ** 5.2559;
  // Humidity ratio from dry-bulb and thermodynamic wet-bulb.
  function wFromTwb(t, twb, p) {
    const Ws = wOf(pws(twb), p);
    return twb >= 0 ? ((2501 - 2.326 * twb) * Ws - 1.006 * (t - twb)) / (2501 + 1.86 * t - 4.186 * twb) : ((2830 - 0.24 * twb) * Ws - 1.006 * (t - twb)) / (2830 + 1.86 * t - 2.1 * twb);
  }
  function moist(t, W, p) {
    const pw = p * W / (0.621945 + W), ps = pws(t), Ws = wOf(ps, p);
    return { t, W, p, pw, ps, Ws, rh: pw / ps, h: hOf(t, W), v: 0.287042 * (t + TK) * (1 + 1.607858 * W) / p, tdp: W > 1e-9 ? tsat(pw) : -100,
      twb: bisect(x => wFromTwb(t, x, p) - W, -100, t), rho: (1 + W) / (0.287042 * (t + TK) * (1 + 1.607858 * W) / p) };
  }
  // mode: 'rh' (%), 'twb' (°C), 'tdp' (°C), 'w' (g/kg)
  function moistFrom(t, mode, val, p) {
    let W;
    if (mode === 'rh') W = wOf(val / 100 * pws(t), p); else if (mode === 'twb') W = wFromTwb(t, val, p); else if (mode === 'tdp') W = wOf(pws(val), p); else W = val / 1000;
    return W;
  }
  function psy(p) {
    const P = p.useAlt ? altitudeP(p.alt) : p.P;
    if (!(P > 20)) return bad('Pressure is too low for this chart.');
    const chk = (t, mode, val, who) => {
      if (!(t > -60 && t < 90)) return `${who}: dry-bulb must be between −60 and 90 °C.`;
      if (mode === 'rh' && !(val >= 0 && val <= 100)) return `${who}: relative humidity must be between 0 and 100 %.`;
      if ((mode === 'twb' || mode === 'tdp') && val > t + 1e-9) return `${who}: ${mode === 'twb' ? 'wet-bulb' : 'dew point'} cannot be above the dry-bulb.`;
      const W = moistFrom(t, mode, val, P); if (!(W >= 0)) return `${who}: that combination is drier than dry air; raise the ${mode === 'twb' ? 'wet-bulb' : 'humidity'}.`;
      if (W > wOf(pws(t), P) * (1 + 1e-9)) return `${who}: more moisture than the air can hold at this temperature.`;
      return null;
    };
    let e = chk(p.t, p.mode, p.val, 'State 1'); if (e) return bad(e);
    const s1 = moist(p.t, moistFrom(p.t, p.mode, p.val, P), P), mda = p.flow / 3600 / s1.v;      // kg dry air per second
    const out = { ok: true, kind: 'psychro', P, s1, mda, s2: null, sB: null, adp: null, notes: [] };
    const pr = p.process; let s2 = null, cond = 0, tCond = 0;
    if (pr === 'sensible') {
      if (p.t2 < s1.tdp - 1e-9) return bad(`Cooling to ${p.t2} °C goes below the dew point (${s1.tdp.toFixed(1)} °C): moisture condenses. Use the cooling coil process.`);
      s2 = moist(p.t2, s1.W, P);
    } else if (pr === 'coil') {
      if (!(p.bf >= 0 && p.bf < 1)) return bad('Bypass factor must be between 0 and 1.');
      if (p.adp >= p.t) return bad('The coil surface must be colder than the entering air.');
      const a = moist(p.adp, wOf(pws(p.adp), P), P); out.adp = a;
      if (p.adp >= s1.tdp) { s2 = moist(p.adp + p.bf * (p.t - p.adp), s1.W, P); out.notes.push('The coil is warmer than the dew point, so it stays dry: cooling only, no moisture removed.'); }
      else { const W2 = a.W + p.bf * (s1.W - a.W), h2 = a.h + p.bf * (s1.h - a.h); s2 = moist(tOfHW(h2, W2), W2, P); cond = s1.W - W2; tCond = p.adp; }
    } else if (pr === 'evap') {
      if (!(p.eff >= 0 && p.eff <= 1)) return bad('Effectiveness must be between 0 and 100 %.');
      const t2 = p.t - p.eff * (p.t - s1.twb); s2 = moist(t2, Math.min(wFromTwb(t2, s1.twb, P), wOf(pws(t2), P)), P);
    } else if (pr === 'steam') {
      if (!(p.rh2 > 0 && p.rh2 <= 100)) return bad('Target humidity must be between 0 and 100 %.');
      const W2 = wOf(p.rh2 / 100 * pws(p.t), P); if (W2 < s1.W) return bad('Target humidity is below the starting humidity: a humidifier can only add moisture.');
      s2 = moist(p.t, W2, P);
    } else if (pr === 'mix') {
      e = chk(p.tB, 'rh', p.rhB, 'Stream B'); if (e) return bad(e);
      if (!(p.fB >= 0 && p.fB <= 100)) return bad('Stream B share must be between 0 and 100 %.');
      const sB = moist(p.tB, wOf(p.rhB / 100 * pws(p.tB), P), P), f = p.fB / 100; out.sB = sB;
      const W3 = (1 - f) * s1.W + f * sB.W, h3 = (1 - f) * s1.h + f * sB.h, t3 = tOfHW(h3, W3);
      if (W3 > wOf(pws(t3), P) * (1 + 1e-9)) { out.notes.push('The mixture lands past saturation: fog forms and some moisture condenses. The point shown is the nominal mix.'); }
      s2 = moist(t3, Math.min(W3, wOf(pws(t3), P)), P); s2.Wnominal = W3;
    }
    if (s2) {
      out.s2 = s2;
      if (pr !== 'mix') {
        const qs = mda * (hOf(s2.t, s1.W) - hOf(s1.t, s1.W)), ql = mda * (hOf(s2.t, s2.W) - hOf(s2.t, s1.W));   // kW, + = added to the air
        const water = mda * (s2.W - s1.W);                                                                        // kg/s, + = added
        const qCond = cond > 0 ? mda * cond * 4.186 * tCond : 0;                                                 // enthalpy carried off by condensate
        out.load = { qs, ql, qt: qs + ql, water, qCoil: pr === 'coil' ? -(qs + ql) - qCond : null, shr: Math.abs(qs + ql) > 1e-12 ? qs / (qs + ql) : 1 };
      }
    }
    return out;
  }

  // ============================================================ heat exchangers (effectiveness–NTU)
  const HX = { counter: 'Counterflow', parallel: 'Parallel flow', shell: 'Shell and tube', crossUU: 'Crossflow, both unmixed', crossMaxMixed: 'Crossflow, larger stream mixed', crossMinMixed: 'Crossflow, smaller stream mixed' };
  const FLUIDS = { water: { name: 'Water', cp: 4180 }, oil: { name: 'Engine oil', cp: 2131 }, air: { name: 'Air', cp: 1007 }, glycol: { name: '50/50 glycol–water', cp: 3400 }, custom: { name: 'Custom', cp: null } };
  function effectiveness(type, ntu, cr, shells = 1) {
    if (ntu <= 0) return 0;
    if (cr < 1e-9) return 1 - Math.exp(-ntu);
    if (type === 'parallel') return (1 - Math.exp(-ntu * (1 + cr))) / (1 + cr);
    if (type === 'counter') return Math.abs(1 - cr) < 1e-9 ? ntu / (1 + ntu) : (1 - Math.exp(-ntu * (1 - cr))) / (1 - cr * Math.exp(-ntu * (1 - cr)));
    if (type === 'shell') {
      const n = Math.max(1, Math.round(shells)), q = Math.sqrt(1 + cr * cr), x = Math.exp(-(ntu / n) * q), e1 = 2 / (1 + cr + q * (1 + x) / (1 - x));
      if (n === 1) return e1;
      if (Math.abs(1 - cr) < 1e-9) return n * e1 / (1 + (n - 1) * e1);
      const y = ((1 - e1 * cr) / (1 - e1)) ** n; return (y - 1) / (y - cr);
    }
    if (type === 'crossUU') return 1 - Math.exp((1 / cr) * ntu ** 0.22 * (Math.exp(-cr * ntu ** 0.78) - 1));
    if (type === 'crossMaxMixed') return (1 / cr) * (1 - Math.exp(-cr * (1 - Math.exp(-ntu))));
    if (type === 'crossMinMixed') return 1 - Math.exp(-(1 / cr) * (1 - Math.exp(-cr * ntu)));
    return NaN;
  }
  function ntuFor(type, eps, cr, shells) {
    if (eps <= 0) return 0;
    if (effectiveness(type, 1e4, cr, shells) <= eps) return Infinity;
    return Math.exp(bisect(x => effectiveness(type, Math.exp(x), cr, shells) - eps, Math.log(1e-6), Math.log(1e4)));
  }
  // p: {type, shells, hot:{mdot kg/s, cp J/kg·K, Tin}, cold:{…}, mode:'rating'|'sizing', U W/m²K, A m², target:'Tco'|'Tho'|'q', targetVal}
  function hx(p, opt = {}) {
    const Ch = p.hot.mdot * p.hot.cp, Cc = p.cold.mdot * p.cold.cp;
    if (!(Ch > 0) || !(Cc > 0)) return bad('Both streams need a flow rate and specific heat above zero.');
    if (!(p.hot.Tin > p.cold.Tin)) return bad('The hot stream must enter warmer than the cold stream.');
    if (!(p.U > 0)) return bad('U must be above zero.');
    const Cmin = Math.min(Ch, Cc), Cmax = Math.max(Ch, Cc), cr = Cmin / Cmax, dT = p.hot.Tin - p.cold.Tin, qmax = Cmin * dT, sh = p.shells || 1;
    const epsMax = effectiveness(p.type, 1e4, cr, sh);
    let eps, ntu, A, q;
    if (p.mode === 'sizing') {
      q = p.target === 'q' ? p.targetVal : p.target === 'Tco' ? Cc * (p.targetVal - p.cold.Tin) : Ch * (p.hot.Tin - p.targetVal);
      if (!(q > 0)) return bad('The target asks for no heat transfer, or heat flowing the wrong way.');
      eps = q / qmax;
      if (eps >= 1) return bad(`That needs ${(q / 1000).toFixed(2)} kW, more than the ${(qmax / 1000).toFixed(2)} kW these streams can exchange even with endless area.`);
      if (eps >= epsMax) return bad(`A ${HX[p.type].toLowerCase()} exchanger tops out at ${(epsMax * 100).toFixed(1)} % effectiveness for these flows; the target needs ${(eps * 100).toFixed(1)} %. Try counterflow or more shell passes.`);
      ntu = ntuFor(p.type, eps, cr, sh); A = ntu * Cmin / p.U;
    } else { if (!(p.A > 0)) return bad('Area must be above zero.'); A = p.A; ntu = p.U * A / Cmin; eps = effectiveness(p.type, ntu, cr, sh); q = eps * qmax; }
    const Tho = p.hot.Tin - q / Ch, Tco = p.cold.Tin + q / Cc, UA = p.U * A;
    const d1 = p.hot.Tin - Tco, d2 = Tho - p.cold.Tin, lmtdCF = Math.abs(d1 - d2) < 1e-9 * Math.max(d1, d2) ? d1 : (d1 - d2) / Math.log(d1 / d2);
    const out = { ok: true, kind: 'hx', type: p.type, Ch, Cc, Cmin, Cmax, cr, ntu, eps, epsMax, q, qmax, Tho, Tco, UA, A, U: p.U, lmtdCF, F: lmtdCF > 0 ? q / (UA * lmtdCF) : NaN, cross: Tco > Tho,
      minIsHot: Ch <= Cc };
    // Temperature profiles along the length (x from the hot inlet), exact for the two simple arrangements.
    if (p.type === 'counter' || p.type === 'parallel') {
      const cf = p.type === 'counter', a = UA * (1 / Ch + (cf ? -1 : 1) / Cc), d0 = cf ? d1 : dT, n = 60; out.profile = [];
      for (let i = 0; i <= n; i++) { const x = i / n, gI = Math.abs(a) < 1e-12 ? x : (1 - Math.exp(-a * x)) / a, Th = p.hot.Tin - UA / Ch * d0 * gI; out.profile.push({ x, Th, Tc: cf ? Tco - UA / Cc * d0 * gI : p.cold.Tin + UA / Cc * d0 * gI }); }
    }
    if (opt.sweep !== false) {
      const top = Math.max(5, isFinite(ntu) ? ntu * 1.6 : 5), n = 80; out.curve = [];
      for (let i = 0; i <= n; i++) { const x = top * i / n; out.curve.push({ ntu: x, eps: effectiveness(p.type, x, cr, sh), epsCF: effectiveness('counter', x, cr), A: x * Cmin / p.U, Tho: p.hot.Tin - effectiveness(p.type, x, cr, sh) * qmax / Ch, Tco: p.cold.Tin + effectiveness(p.type, x, cr, sh) * qmax / Cc }); }
    }
    return out;
  }

  // ============================================================ heater warm-up (lumped thermal masses)
  const MATERIALS = {
    al6061: { name: 'Aluminum 6061', rho: 2700, c: 896, k: 167 }, copper: { name: 'Copper', rho: 8933, c: 385, k: 401 }, brass: { name: 'Brass', rho: 8530, c: 380, k: 110 },
    steel: { name: 'Carbon steel', rho: 7850, c: 490, k: 50 }, ss304: { name: 'Stainless 304', rho: 8000, c: 500, k: 16.2 }, ti: { name: 'Titanium 6Al-4V', rho: 4430, c: 560, k: 7.2 },
    peek: { name: 'PEEK', rho: 1310, c: 1340, k: 0.25 }, water: { name: 'Water', rho: 998, c: 4182, k: 0.6 },
  };
  // A box-shaped thermal mass. dims mm; exposed % of the surface that loses heat.
  function node(b) {
    const m = MATERIALS[b.mat] || MATERIALS.al6061, L = b.L * 1e-3, W = b.W * 1e-3, H = b.H * 1e-3, V = L * W * H, Afull = 2 * (L * W + L * H + W * H), A = Afull * (b.exposed == null ? 1 : b.exposed / 100);
    return { mat: m, V, mass: m.rho * V, C: m.rho * V * m.c, A, Afull, h: b.h, emis: b.emis, Lc: V / Afull };
  }
  const lossOf = (n, T, Ta) => n.h * n.A * (T - Ta) + n.emis * SIGMA * n.A * ((T + TK) ** 4 - (Ta + TK) ** 4);
  const condOf = (n, T, Ta) => n.h * n.A + 4 * n.emis * SIGMA * n.A * ((T + Ta) / 2 + TK) ** 3;     // W/K, linearized
  // Steady temperatures at a constant power.
  function steady(n1, n2, R12, P, Ta) {
    if (!n2) return { T1: bisect(T => P - lossOf(n1, T, Ta), Ta - 1, Ta + 6000), T2: null };
    const T1of = T2 => T2 + R12 * lossOf(n2, T2, Ta);
    const T2 = bisect(T => P - lossOf(n1, T1of(T), Ta) - lossOf(n2, T, Ta), Ta - 1, Ta + 6000);
    return { T1: T1of(T2), T2 };
  }
  // p: {Tamb, Tinit, P (W), control:'constant'|'onoff'|'pi', setpoint, hyst, Kp (W/K), Ti (s), sensor:1|2, tEnd (s, 0 = auto), block:{…}, load:{on,…}, R12 (K/W)}
  function warm(p, opt = {}) {
    const n1 = node(p.block), two = !!(p.load && p.load.on), n2 = two ? node(p.load) : null, Ta = p.Tamb, Ti0 = p.Tinit == null ? Ta : p.Tinit;
    if (!(n1.C > 0) || (two && !(n2.C > 0))) return bad('Each part needs dimensions above zero.');
    if (!(p.P >= 0)) return bad('Heater power cannot be negative.');
    if (two && !(p.R12 > 0)) return bad('Contact resistance must be above zero.');
    if (!(n1.h >= 0 && n1.emis >= 0 && n1.emis <= 1) || (two && !(n2.h >= 0 && n2.emis >= 0 && n2.emis <= 1))) return bad('Convection must be zero or more and emissivity between 0 and 1.');
    const ctl = p.control, sp = p.setpoint, sens = two && p.sensor === 2 ? 2 : 1;
    if (ctl !== 'constant' && !(sp > Ta)) return bad('The setpoint must be above ambient.');
    if (ctl === 'pi' && !(p.Kp > 0 && p.Ti > 0)) return bad('Controller gain and integral time must be above zero.');
    const G1 = condOf(n1, Ta, Ta), G2 = two ? condOf(n2, Ta, Ta) : 0, Gtot = G1 + G2;
    const tauSlow = Gtot > 0 ? (n1.C + (two ? n2.C : 0)) / Gtot : Infinity, tauFast = two ? p.R12 * n1.C * n2.C / (n1.C + n2.C) : tauSlow;
    const ss = steady(n1, n2, p.R12, p.P, Ta);
    const run = (tEnd, keep) => {
      const tauMin = Math.min(tauFast, isFinite(tauSlow) ? tauSlow : tauFast, ctl === 'pi' ? n1.C / p.Kp : Infinity);
      const dtCtl = ctl === 'onoff' && p.P > 0 ? 0.05 * Math.max(p.hyst, 0.2) * n1.C / p.P : Infinity;      // on/off: resolve the switching band
      const N = Math.round(clamp(Math.max(tEnd / (0.04 * tauMin), tEnd / dtCtl, 3000), 3000, 400000)), dt = tEnd / N, every = Math.max(1, Math.floor(N / 600));
      let T1 = Ti0, T2 = two ? Ti0 : null, Ein = 0, El = 0, I = 0, on = true, tReach = null, peak = -Infinity, tPeak = 0, TsPrev = null, eMark = 0, tMark = 0; const frames = [];
      const f = (a, b, pw) => { const l1 = lossOf(n1, a, Ta), l2 = two ? lossOf(n2, b, Ta) : 0, q12 = two ? (a - b) / p.R12 : 0; return [(pw - l1 - q12) / n1.C, two ? (q12 - l2) / n2.C : 0, l1 + l2]; };
      for (let i = 0; i <= N; i++) {
        const t = i * dt, Ts = sens === 2 ? T2 : T1; let pw = p.P;
        if (ctl === 'onoff') { if (Ts >= sp + p.hyst / 2) on = false; else if (Ts <= sp - p.hyst / 2) on = true; pw = on ? p.P : 0; }
        else if (ctl === 'pi') { const e = sp - Ts, raw = p.Kp * e + I; pw = clamp(raw, 0, p.P); if (raw === pw || (raw > p.P && e < 0) || (raw < 0 && e > 0)) I += p.Kp / p.Ti * e * dt; }
        if (ctl !== 'constant' && tReach == null && Ts >= sp - 1e-9) tReach = TsPrev != null && Ts > TsPrev ? t - dt * (Ts - sp) / (Ts - TsPrev) : t;
        TsPrev = Ts;
        if (Ts > peak) { peak = Ts; tPeak = t; }
        if (keep && (i % every === 0 || i === N)) { const l1 = lossOf(n1, T1, Ta), l2 = two ? lossOf(n2, T2, Ta) : 0; frames.push({ t, T1, T2: two ? T2 : NaN, P: pw, Pavg: t > tMark ? (Ein - eMark) / (t - tMark) : pw, loss1: l1, loss2: l2, q12: two ? (T1 - T2) / p.R12 : 0 }); eMark = Ein; tMark = t; }
        if (i === N) break;
        const k1 = f(T1, T2, pw), k2 = f(T1 + 0.5 * dt * k1[0], two ? T2 + 0.5 * dt * k1[1] : null, pw), k3 = f(T1 + 0.5 * dt * k2[0], two ? T2 + 0.5 * dt * k2[1] : null, pw), k4 = f(T1 + dt * k3[0], two ? T2 + dt * k3[1] : null, pw);
        T1 += dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); if (two) T2 += dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
        El += dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]); Ein += pw * dt;
      }
      return { frames, T1, T2, Ein, El, tReach, peak, tPeak, dt, tEnd };
    };
    let tEnd = p.tEnd > 0 ? p.tEnd : null;
    if (tEnd == null) {
      const base = isFinite(tauSlow) ? 5 * tauSlow : 3600;
      if (ctl === 'constant') tEnd = base; else { const probe = run(base, false); tEnd = probe.tReach != null ? clamp(Math.max(2.5 * probe.tReach, two ? probe.tReach + 6 * tauFast : 0), 20, base) : base; }
    }
    const r = run(tEnd, true), U = n1.C * (r.T1 - Ti0) + (two ? n2.C * (r.T2 - Ti0) : 0);
    const fr = r.frames, tail = fr.filter(q => q.t >= 0.8 * tEnd), pAvg = tail.reduce((s, q) => s + q.P, 0) / tail.length;
    const TsEnd = sens === 2 ? r.T2 : r.T1, hEff1 = n1.A > 0 ? condOf(n1, Math.max(r.T1, ss.T1 || r.T1), Ta) / n1.A : 0;
    const need = ctl === 'constant' ? null : (() => { // power needed to hold the setpoint at the sensor
      if (!two) return lossOf(n1, sp, Ta);
      if (sens === 2) return lossOf(n1, sp + p.R12 * lossOf(n2, sp, Ta), Ta) + lossOf(n2, sp, Ta);
      const T2 = bisect(T => sp - T - p.R12 * lossOf(n2, T, Ta), Ta - 1, sp); return lossOf(n1, sp, Ta) + lossOf(n2, T2, Ta);
    })();
    return { ok: true, kind: 'warm', n1, n2, two, sens, ctl, Ta, Ti0, frames: fr, tEnd, tReach: r.tReach, peak: r.peak, overshoot: ctl === 'constant' ? null : r.peak - sp, T1end: r.T1, T2end: r.T2, TsEnd,
      Ein: r.Ein, Eloss: r.El, U, residual: r.Ein - r.El - U, ss, tauSlow, tauFast, G1, G2, pAvg, duty: p.P > 0 ? pAvg / p.P : 0, need, canHold: need == null ? null : p.P >= need,
      biot1: hEff1 * n1.Lc / n1.mat.k, biot2: two ? condOf(n2, r.T2, Ta) / Math.max(n2.A, 1e-12) * n2.Lc / n2.mat.k : null, t63: null };
  }

  function run(model, opt) {
    try {
      const lab = model.lab;
      const r = lab === 'cycles' ? cycle(model.cycles, opt) : lab === 'psychro' ? psy(model.psychro) : lab === 'hx' ? hx(model.hx, opt) : lab === 'warm' ? warm(model.warm, opt) : bad('Unknown lab.');
      return r;
    } catch (e) { return bad('The inputs give no valid answer: ' + e.message); }
  }
  return { SIGMA, TK, P_ATM, GASES, CYCLES, HX, FLUIDS, MATERIALS, gasProps, cycle, cycleStates, pws, tsat, wOf, hOf, tOfHW, altitudeP, wFromTwb, moist, moistFrom, psy, effectiveness, ntuFor, hx, node, lossOf, condOf, steady, warm, run, bisect };
})();
if (typeof module !== 'undefined') module.exports = Core;
