// Thermo Bench checks: every model against a closed form, a hand calculation or a published value.
// Run: node tests/test_core.js
const C = require('../core.js'), P = require('../presets.js');
let fails = 0, count = 0;
const near = (a, b, tol, msg) => { const ok = Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-300); count++; if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + `  got ${(+a).toPrecision(7)} want ${(+b).toPrecision(7)}`); };
const within = (a, b, abs, msg) => { const ok = Math.abs(a - b) <= abs; count++; if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + `  got ${(+a).toPrecision(7)} want ${(+b).toPrecision(7)} ± ${abs}`); };
const yes = (c, msg) => { count++; if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + msg); };
const TK = 273.15, cyc = o => C.cycle({ ...P.base().cycles, ...o });

// ---------- gas cycles
{ // Otto, r = 8, air: η = 1 − r^(1−k) = 0.5647; T2 = 300·8^0.4 = 689.2 K
  const c = cyc({ type: 'otto', T1: 300 - TK, P1: 100, r: 8, Tmax: 1500 });
  near(c.eta, 0.56472, 1e-4, 'Otto r = 8 efficiency'); near(c.S[1].T, 689.22, 1e-4, 'Otto end-of-compression temperature (K)');
  near(c.S[1].P, 100 * 8 ** 1.4, 1e-9, 'Otto P2 = P1 r^k');
  near(c.mep, c.wnet / (c.S[0].v * (1 - 1 / 8)), 1e-12, 'Otto MEP = w / (v1 − v2)');
  near(c.power, c.mep * 2e-3 * 3000 / 120, 1e-9, 'Otto power = MEP · Vd · cycles per second (kW)');
}
{ // Diesel r = 18, cutoff 2: η = 1 − r^(1−k)(rc^k − 1)/(k(rc − 1)) = 0.6316
  const T1 = 300, T2 = T1 * 18 ** 0.4, c = cyc({ type: 'diesel', T1: T1 - TK, r: 18, Tmax: 2 * T2 - TK });
  near(c.eta, 0.6316, 2e-4, 'Diesel r = 18, rc = 2 efficiency'); near(c.extra.rc, 2, 1e-9, 'Diesel cutoff ratio');
}
{ // Dual: closed form with α and rc
  const r = 16, al = 1.5, k = 1.4, T2 = 300 * r ** 0.4, rc = 1.6, c = cyc({ type: 'dual', T1: 300 - TK, r, alpha: al, Tmax: al * T2 * rc - TK });
  near(c.eta, 1 - r ** (1 - k) * (al * rc ** k - 1) / ((al - 1) + k * al * (rc - 1)), 1e-10, 'Dual cycle efficiency');
  // limits: α = 1 → Diesel, rc = 1 → Otto
  near(cyc({ type: 'dual', T1: 27, r, alpha: 1, Tmax: 1500 }).eta, cyc({ type: 'diesel', T1: 27, r, Tmax: 1500 }).eta, 1e-10, 'Dual with no pressure rise = Diesel');
}
{ // Brayton ideal rp = 8: η = 1 − rp^(−(k−1)/k) = 0.4479
  const c = cyc({ type: 'brayton', T1: 300 - TK, r: 8, Tmax: 1300 - TK, etaC: 1, etaT: 1, regen: 0, mdot: 2 });
  near(c.eta, 0.4479, 2e-4, 'Brayton rp = 8 efficiency'); near(c.power, 2 * c.wnet, 1e-12, 'Brayton power = ṁ w');
  // with losses, by hand: T2 = 604.3, T4 = 805.0 K → η = 0.2741
  const d = cyc({ type: 'brayton', T1: 300 - TK, r: 8, Tmax: 1300 - TK, etaC: 0.8, etaT: 0.85, regen: 0 });
  const x = 8 ** (0.4 / 1.4), T2 = 300 + (300 * x - 300) / 0.8, T4 = 1300 - 0.85 * (1300 - 1300 / x);
  near(d.S[1].T, T2, 1e-10, 'Brayton real compressor exit'); near(d.S[3].T, T4, 1e-10, 'Brayton real turbine exit');
  near(d.eta, ((1300 - T4) - (T2 - 300)) / (1300 - T2), 1e-10, 'Brayton with losses efficiency'); within(d.eta, 0.274, 0.001, 'Brayton with losses ≈ 27.4 %');
  near(d.bwr, (T2 - 300) / (1300 - T4), 1e-10, 'Brayton back work ratio');
  // ideal regenerator: η = 1 − (T1/T3) rp^((k−1)/k)
  near(cyc({ type: 'brayton', T1: 300 - TK, r: 8, Tmax: 1300 - TK, etaC: 1, etaT: 1, regen: 1 }).eta, 1 - 300 / 1300 * x, 1e-10, 'Brayton with ideal regenerator');
  // best pressure ratio for net work: rp = (T3/T1)^(k/2(k−1))
  let best = { w: -1 }; for (const q of C.cycle({ ...P.base().cycles, type: 'brayton', T1: 300 - TK, r: 8, Tmax: 1300 - TK, etaC: 1, etaT: 1, regen: 0 }).sweep) if (q.w > best.w) best = q;
  within(best.r, (1300 / 300) ** (1.4 / 0.8), 0.4, 'Brayton pressure ratio for most work'); near(c.extra.rOpt, (1300 / 300) ** 1.75, 1e-10, 'Brayton rOpt formula');
}
{ // Carnot and Stirling
  near(cyc({ type: 'carnot', T1: 27, Tmax: 627, r: 4 }).eta, 1 - 300.15 / 900.15, 1e-10, 'Carnot efficiency');
  near(cyc({ type: 'stirling', T1: 27, Tmax: 627, r: 3, regen: 1 }).eta, 1 - 300.15 / 900.15, 1e-10, 'Stirling with ideal regenerator = Carnot');
  const s = cyc({ type: 'stirling', gas: 'he', T1: 27, Tmax: 627, r: 3, regen: 0 }), g = C.gasProps('he');
  near(s.eta, g.R * 600 * Math.log(3) / (g.R * 900.15 * Math.log(3) + g.cv * 600), 1e-10, 'Stirling without regenerator');
}
// every cycle: first law, ∫T ds = q and ∫P dv = w along the drawn paths, entropy returns to its start
for (const [type, o] of [['otto', {}], ['diesel', { r: 18 }], ['dual', { r: 16 }], ['brayton', { etaC: 1, etaT: 1, Tmax: 1100 }], ['stirling', { r: 3, regen: 1 }], ['carnot', { r: 4 }]]) {
  const c = cyc({ type, ...o }); let worst = 0, worstW = 0, sq = 0, sw = 0;
  for (const p of c.P) {
    let q = 0, w = 0; for (let i = 1; i < p.pts.length; i++) { const a = p.pts[i - 1], b = p.pts[i]; q += 0.5 * (a.T + b.T) * (b.s - a.s); const lv = Math.log(b.v / a.v), n = Math.abs(lv) < 1e-14 ? 0 : -Math.log(b.P / a.P) / lv; w += Math.abs(lv) < 1e-14 ? 0 : Math.abs(n - 1) < 1e-9 ? a.P * a.v * lv : (b.P * b.v - a.P * a.v) / (1 - n); }   // each short segment as an exact polytrope
    worst = Math.max(worst, Math.abs(q - p.q)); if (!c.flow) worstW = Math.max(worstW, Math.abs(w - p.w) / Math.max(Math.abs(p.w), c.qin)); sq += p.q; sw += p.w;
  }
  yes(worst < 2e-3 * c.qin, `${type}: ∫T ds matches each process heat (worst ${worst.toExponential(2)} kJ/kg)`);
  yes(worstW < 1e-9, `${type}: ∫P dv matches each process work`);
  near(sq, sw, 1e-10, `${type}: first law, Σq = Σw`); near(c.eta, c.formula, 1e-10, `${type}: efficiency matches its closed form`);
  yes(c.eta <= c.etaCarnot + 1e-12, `${type}: at or below the Carnot limit`);
}
yes(!cyc({ type: 'otto', r: 12, Tmax: 400 }).ok, 'Otto with a peak temperature below compression is refused');

// ---------- psychrometrics
near(C.pws(0), 0.6112, 5e-4, 'saturation pressure at 0 °C (kPa)'); near(C.pws(20), 2.3392, 5e-4, 'saturation pressure at 20 °C');
near(C.pws(25), 3.1699, 5e-4, 'saturation pressure at 25 °C'); near(C.pws(50), 12.352, 5e-4, 'saturation pressure at 50 °C');
near(C.pws(100), 101.42, 5e-4, 'saturation pressure at 100 °C'); near(C.pws(-10), 0.2599, 1e-3, 'saturation pressure over ice at −10 °C');
near(C.pws(-1e-9), C.pws(0), 1e-4, 'ice and liquid curves meet at 0 °C'); near(C.tsat(101.325), 99.97, 3e-4, 'boiling point at one atmosphere');
near(C.altitudeP(1609), 83.43, 1e-3, 'standard pressure at 1609 m (kPa)');
{ // 25 °C, 50 % at sea level: chart values W 9.9 g/kg, h 50.3 kJ/kg, dew point 13.9 °C, wet bulb 17.9 °C, v 0.858 m³/kg
  const s = C.moist(25, C.moistFrom(25, 'rh', 50, 101.325), 101.325);
  near(s.W, 0.00988, 5e-3, '25 °C / 50 %: humidity ratio'); near(s.h, 50.3, 5e-3, '25 °C / 50 %: enthalpy'); within(s.tdp, 13.9, 0.15, '25 °C / 50 %: dew point');
  within(s.twb, 17.9, 0.15, '25 °C / 50 %: wet bulb'); near(s.v, 0.858, 3e-3, '25 °C / 50 %: specific volume'); near(s.rh, 0.5, 1e-9, 'relative humidity round trip');
  near(C.moistFrom(25, 'twb', s.twb, 101.325), s.W, 1e-7, 'wet bulb → humidity ratio round trip'); near(C.moistFrom(25, 'tdp', s.tdp, 101.325), s.W, 1e-7, 'dew point → humidity ratio round trip');
  const sat = C.moist(18, C.moistFrom(18, 'rh', 100, 101.325), 101.325); within(sat.twb, 18, 1e-6, 'saturated: wet bulb = dry bulb'); within(sat.tdp, 18, 1e-6, 'saturated: dew point = dry bulb');
  // 35 °C dry bulb, 24 °C wet bulb: by hand W = 0.01424, about 40 % RH
  const w = C.moist(35, C.moistFrom(35, 'twb', 24, 101.325), 101.325); near(w.W, 0.01424, 3e-3, '35 / 24 °C wet bulb: humidity ratio'); within(w.rh * 100, 40.3, 0.6, '35 / 24 °C wet bulb: relative humidity');
}
{ const b = P.base().psychro;
  // sensible heating 25 → 35 °C, 1000 m³/h: q = ṁ (1.006 + 1.86 W) ΔT
  const r = C.psy({ ...b, process: 'sensible', t2: 35 }); near(r.load.qt, r.mda * (1.006 + 1.86 * r.s1.W) * 10, 1e-10, 'sensible heating load (kW)'); within(r.load.qt, 3.32, 0.02, 'sensible heating ≈ 3.32 kW');
  near(r.mda, 1000 / 3600 / r.s1.v, 1e-12, 'dry-air mass flow'); near(r.load.ql, 0, 1, 'sensible heating adds no moisture') ; yes(Math.abs(r.load.ql) < 1e-12, 'latent load is zero');
  yes(!C.psy({ ...b, process: 'sensible', t2: 5 }).ok, 'cooling below the dew point is refused');
  // cooling coil: leaving state on the straight line to the apparatus dew point; water and energy balance
  const c = C.psy({ ...b, t: 32, val: 55, process: 'coil', adp: 9, bf: 0.12 }), s1 = c.s1, s2 = c.s2, a = c.adp;
  near((s2.W - a.W) / (s1.W - a.W), 0.12, 1e-9, 'coil: bypass factor on humidity'); near((s2.h - a.h) / (s1.h - a.h), 0.12, 1e-9, 'coil: bypass factor on enthalpy');
  near(c.load.qCoil, c.mda * ((s1.h - s2.h) - (s1.W - s2.W) * 4.186 * 9), 1e-10, 'coil: load = air enthalpy drop − condensate enthalpy'); yes(s2.rh <= 1 + 1e-9 && c.load.water < 0, 'coil: leaves unsaturated and removes water');
  yes(C.psy({ ...b, t: 30, val: 20, process: 'coil', adp: 12, bf: 0.1 }).load.water === 0, 'coil above the dew point stays dry');
  // evaporative cooler: wet bulb is constant, T2 = T1 − ε(T1 − Twb)
  const e = C.psy({ ...b, t: 40, val: 12, process: 'evap', eff: 0.85 }); within(e.s2.twb, e.s1.twb, 1e-6, 'evaporative: wet bulb unchanged'); near(e.s2.t, 40 - 0.85 * (40 - e.s1.twb), 1e-12, 'evaporative: leaving dry bulb');
  within(e.s2.h, e.s1.h, 0.8, 'evaporative: enthalpy nearly constant');
  // mixing: mass and energy balances
  const m = C.psy({ ...b, process: 'mix', tB: 35, rhB: 45, fB: 25 }); near(m.s2.W, 0.75 * m.s1.W + 0.25 * m.sB.W, 1e-12, 'mixing: moisture balance'); near(m.s2.h, 0.75 * m.s1.h + 0.25 * m.sB.h, 1e-9, 'mixing: energy balance');
  yes(m.s2.t > 24 && m.s2.t < 35, 'mixing: lands between the streams');
  const st = C.psy({ ...b, useAlt: true, alt: 1600, t: 21, val: 15, process: 'steam', rh2: 40 }); near(st.s2.rh, 0.4, 1e-9, 'humidifier reaches its target'); near(st.load.water, st.mda * (st.s2.W - st.s1.W), 1e-12, 'humidifier water rate');
}

// ---------- heat exchangers
{ const b = P.base().hx;
  // textbook oil cooler: oil 0.1 kg/s 100 → 60 °C, water 0.2 kg/s from 30 °C, U = 38.1 W/m²K, tube 25 mm × 65.9 m: q = 8524 W, Tc,o = 40.2 °C, LMTD = 43.2 °C
  const r = C.hx({ ...b, A: Math.PI * 0.025 * 65.9 }); near(r.q, 8524, 5e-3, 'oil cooler: heat rate (W)'); within(r.Tho, 60, 0.2, 'oil cooler: oil outlet'); within(r.Tco, 40.2, 0.1, 'oil cooler: water outlet'); near(r.lmtdCF, 43.2, 5e-3, 'oil cooler: LMTD');
  near(r.F, 1, 1e-9, 'counterflow: q = UA · LMTD exactly'); near(r.q, r.Ch * (100 - r.Tho), 1e-12, 'hot-side energy balance'); near(r.q, r.Cc * (r.Tco - 30), 1e-12, 'cold-side energy balance');
  near(r.profile[60].Th, r.Tho, 1e-9, 'counterflow profile ends at the hot outlet'); near(r.profile[60].Tc, 30, 1e-9, 'counterflow profile ends at the cold inlet'); near(r.profile[0].Tc, r.Tco, 1e-12, 'counterflow profile starts at the cold outlet');
  const s = C.hx({ ...b, mode: 'sizing', target: 'Tho', targetVal: 60 }); near(s.A, Math.PI * 0.025 * 65.9, 5e-3, 'sizing returns the textbook area'); near(C.hx({ ...b, mode: 'sizing', target: 'q', targetVal: r.q }).A, r.A, 1e-8, 'sizing inverts rating');
  // parallel flow: q = UA · LMTD with parallel end differences
  const p = C.hx({ ...b, type: 'parallel' }), d1 = 70, d2 = p.Tho - p.Tco; near(p.q, p.UA * (d1 - d2) / Math.log(d1 / d2), 1e-9, 'parallel flow: q = UA · LMTD'); yes(p.q < r.q, 'parallel flow transfers less than counterflow');
  near(p.profile[60].Th, p.Tho, 1e-9, 'parallel profile ends at the hot outlet'); near(p.profile[60].Tc, p.Tco, 1e-9, 'parallel profile ends at the cold outlet');
  yes(!C.hx({ ...b, type: 'parallel', mode: 'sizing', target: 'Tho', targetVal: 35 }).ok, 'parallel flow cannot cross temperatures: refused');
}
near(C.effectiveness('counter', 2, 1), 2 / 3, 1e-9, 'counterflow, Cr = 1: ε = NTU/(1 + NTU)'); near(C.effectiveness('parallel', 50, 0.5), 1 / 1.5, 1e-9, 'parallel flow limit ε → 1/(1 + Cr)');
for (const t of Object.keys(C.HX)) near(C.effectiveness(t, 1.3, 0), 1 - Math.exp(-1.3), 1e-9, `${t}: Cr = 0 gives 1 − e^−NTU`);
near(C.effectiveness('counter', 1.5, 0.999999), 1.5 / 2.5, 1e-5, 'counterflow is continuous at Cr = 1');
{ // shell and tube: LMTD correction factor from the classic P–R formula
  const r = C.hx({ type: 'shell', shells: 1, hot: { mdot: 1.5, cp: 4180, Tin: 90 }, cold: { mdot: 2.5, cp: 4180, Tin: 20 }, mode: 'rating', U: 1200, A: 6 });
  const Pp = (r.Tco - 20) / (90 - 20), R = (90 - r.Tho) / (r.Tco - 20), S = Math.sqrt(R * R + 1);
  const F = S / (R - 1) * Math.log((1 - Pp) / (1 - Pp * R)) / Math.log((2 - Pp * (R + 1 - S)) / (2 - Pp * (R + 1 + S)));
  near(r.F, F, 1e-8, 'shell and tube: F matches the P–R formula'); yes(r.F < 1 && r.F > 0.5, 'shell and tube: F below 1');
  const e1 = C.effectiveness('shell', 1.0, 0.6, 1), e2 = C.effectiveness('shell', 2.0, 0.6, 2); yes(e2 > C.effectiveness('shell', 2.0, 0.6, 1) && e2 < C.effectiveness('counter', 2.0, 0.6), 'two shells sit between one shell and counterflow');
  near(e2, (((1 - e1 * 0.6) / (1 - e1)) ** 2 - 1) / (((1 - e1 * 0.6) / (1 - e1)) ** 2 - 0.6), 1e-12, 'two-shell formula');
  for (const t of ['parallel', 'shell', 'crossUU', 'crossMaxMixed', 'crossMinMixed']) yes(C.effectiveness(t, 2, 0.7) < C.effectiveness('counter', 2, 0.7) && C.effectiveness(t, 2, 0.7) >= C.effectiveness('parallel', 2, 0.7) - 1e-12, `${t}: between parallel flow and counterflow`);
  near(C.ntuFor('crossUU', C.effectiveness('crossUU', 1.7, 0.4), 0.4), 1.7, 1e-8, 'NTU inversion');
}

// ---------- heater warm-up
{ const b = P.base().warm, blk = { mat: 'al6061', L: 60, W: 40, H: 20, h: 10, emis: 0, exposed: 100 };
  const n = C.node(blk), G = 10 * n.A, tau = n.C / G;
  near(n.mass, 2700 * 48e-6, 1e-12, 'block mass'); near(n.A, 2 * (0.06 * 0.04 + 0.06 * 0.02 + 0.04 * 0.02), 1e-12, 'block area');
  // one mass, convection only: T = T∞ + (P/hA)(1 − e^(−t/τ))
  const r = C.warm({ ...b, control: 'constant', P: 20, block: blk, tEnd: 1.3 * tau }); near(r.T1end - 22, 20 / G * (1 - Math.exp(-1.3)), 1e-7, 'warm-up follows the exponential'); near(r.tauSlow, tau, 1e-9, 'time constant mc/hA'); near(r.ss.T1, 22 + 20 / G, 1e-9, 'steady temperature T∞ + P/hA');
  yes(Math.abs(r.residual) < 1e-6 * r.Ein, `energy books balance (residual ${r.residual.toExponential(2)} J of ${r.Ein.toFixed(0)} J)`);
  // Newton cooling
  const c = C.warm({ ...b, control: 'constant', P: 0, Tinit: 300, block: blk, tEnd: 0.8 * tau }); near(c.T1end - 22, 278 * Math.exp(-0.8), 1e-7, 'Newton cooling');
  // radiation only: T = (T∞⁴ + P/εσA)^¼
  const rad = C.warm({ ...b, control: 'constant', P: 30, block: { ...blk, h: 0, emis: 0.8 } }); near(rad.ss.T1 + TK, ((22 + TK) ** 4 + 30 / (0.8 * C.SIGMA * n.A)) ** 0.25, 1e-9, 'radiation-only steady temperature');
  // time to setpoint, analytic: t = −τ ln(1 − (Tsp − T∞) G / P)
  const o = C.warm({ ...b, control: 'onoff', P: 150, setpoint: 200, hyst: 4, block: blk }); near(o.tReach, -tau * Math.log(1 - 178 * G / 150), 1e-4, 'time to reach the setpoint'); yes(o.overshoot <= 2 + 0.5 && o.overshoot >= 0, `on/off overshoot stays in the band (${o.overshoot.toFixed(2)} K)`);
  near(o.need, G * 178, 1e-9, 'power to hold the setpoint'); within(o.duty, G * 178 / 150, 0.03, 'on/off duty cycle ≈ holding power ÷ heater power');
  const pi = C.warm({ ...b, control: 'pi', P: 150, setpoint: 200, Kp: 12, Ti: 40, block: blk }); within(pi.TsEnd, 200, 0.5, 'PI controller settles on the setpoint'); within(pi.pAvg, G * 178, 0.5, 'PI power settles at the holding power');
  yes(C.warm({ ...b, control: 'pi', P: 10, setpoint: 200, block: blk }).canHold === false, 'undersized heater is flagged');
  // two masses, convection only: network by hand. T2 = T∞ + q2/G2, T1 = T2 + q2·R12, P = G1(T1 − T∞) + q2
  const ld = { on: true, mat: 'ss304', L: 40, W: 40, H: 10, h: 10, emis: 0, exposed: 100 }, n2 = C.node(ld), G2 = 10 * n2.A, R12 = 0.8, Pw = 25;
  const th1 = Pw / (G + 1 / (R12 + 1 / G2)), q2 = th1 / (R12 + 1 / G2), t2 = C.warm({ ...b, control: 'constant', P: Pw, block: blk, load: ld, R12 });
  near(t2.ss.T1 - 22, th1, 1e-8, 'two masses: heater block steady rise'); near(t2.ss.T2 - 22, q2 / G2, 1e-8, 'two masses: load steady rise'); near(t2.T1end - 22, th1, 1e-2, 'two masses: simulation approaches steady state');
  yes(Math.abs(t2.residual) < 1e-6 * t2.Ein, 'two masses: energy books balance'); near(t2.tauFast, R12 * n.C * n2.C / (n.C + n2.C), 1e-12, 'two masses: equalizing time constant');
  const s2 = C.warm({ ...b, control: 'pi', P: 200, setpoint: 150, Kp: 15, Ti: 80, sensor: 2, block: blk, load: ld, R12, tEnd: 9000 }); within(s2.T2end, 150, 0.5, 'sensor on the load: load reaches the setpoint'); yes(s2.T1end > s2.T2end, 'heater block runs hotter than the load');
  near(n.Lc, 48e-6 / n.A, 1e-12, 'characteristic length V/A'); near(r.biot1, 10 * n.Lc / 167, 1e-9, 'Biot number');
}

// ---------- every example solves and is physically sane
for (const k of Object.keys(P.list)) {
  const m = P.list[k](), r = C.run(m); yes(r.ok, `example ${k} solves${r.ok ? '' : ': ' + r.message}`); if (!r.ok) continue;
  if (r.kind === 'cycles') yes(r.eta > 0.05 && r.eta < r.etaCarnot + 1e-9 && r.power > 0, `  ${k}: η ${(r.eta * 100).toFixed(1)} % (Carnot ${(r.etaCarnot * 100).toFixed(1)} %), ${r.power.toFixed(1)} kW`);
  if (r.kind === 'psychro') yes(r.s1.rh <= 1 && (!r.s2 || r.s2.rh <= 1 + 1e-9), `  ${k}: ${r.s2 ? `leaves at ${r.s2.t.toFixed(1)} °C, ${(r.s2.rh * 100).toFixed(0)} %` : 'state only'}`);
  if (r.kind === 'hx') yes(r.eps > 0 && r.eps < 1 && r.Tho > m.hx.cold.Tin && r.Tco < m.hx.hot.Tin, `  ${k}: ε ${(r.eps * 100).toFixed(1)} %, ${(r.q / 1000).toFixed(2)} kW, A ${r.A.toFixed(2)} m²`);
  if (r.kind === 'warm') yes(Math.abs(r.residual) <= 1e-5 * Math.max(r.Ein, Math.abs(r.U), 1) && (r.canHold !== false) && r.biot1 < 0.1, `  ${k}: ${r.tReach != null ? `reaches setpoint in ${r.tReach.toFixed(0)} s, overshoot ${r.overshoot.toFixed(1)} K` : `ends at ${r.T1end.toFixed(1)} °C`}, Bi ${r.biot1.toFixed(4)}`);
}
console.log(fails ? `${fails} of ${count} FAILED` : `all ${count} passed`);
process.exitCode = fails ? 1 : 0;
