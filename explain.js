// Thermo Bench — "show the math" per lab: the physics, then your numbers.
const Explain = (() => {
  'use strict';
  const C = typeof Core !== 'undefined' ? Core : require('./core.js');
  const MINUS = '−', TK = 273.15;
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sup = n => String(n).split('').map(ch => SUP[ch] || ch).join('');
  function num(v, sig = 4) {
    if (v == null || !isFinite(v)) return v === Infinity ? '∞' : '—';
    if (Math.abs(v) < 1e-300) return '0';
    const a = Math.abs(v);
    const s = a >= 1e6 || a < 1e-3 ? v.toExponential(sig - 1).replace(/e([+-])(\d+)/, (_, sg, e) => `×10${sup((sg === '-' ? '-' : '') + e)}`) : String(+v.toPrecision(sig));
    return s.replace('-', MINUS);
  }
  // Durations in plain units.
  function dur(s) { if (s == null || !isFinite(s)) return '—'; const a = Math.abs(s); return a < 120 ? `${num(s, 3)} s` : a < 7200 ? `${num(s / 60, 3)} min` : `${num(s / 3600, 3)} h`; }
  const sub = s => `<sub>${s}</sub>`;
  const eq = lines => `<div class="eqs">${lines.filter(l => l != null).map(l => l.startsWith('=') ? `<div class="sub">${l}</div>` : l.startsWith('→') ? `<div class="res">${l.slice(1).trim()}</div>` : `<div>${l}</div>`).join('')}</div>`;
  const pct = v => `${num(v * 100, 4)} %`;
  const RATIO = { otto: 'compression ratio r', diesel: 'compression ratio r', dual: 'compression ratio r', brayton: 'pressure ratio r' + '<sub>p</sub>', stirling: 'volume ratio r', carnot: 'isothermal volume ratio r' };

  function cycles(m, r, out) {
    const p = m.cycles, g = r.g, K = t => `${num(t)} K`, n = r.S.length;
    out.push({ title: 'The gas', html: `<p>${g.name} treated as an ideal gas with constant specific heats (the air-standard assumption when the gas is air). Everything is per kilogram of gas.</p>` +
      eq([`R = ${num(g.R)} kJ/kg·K, k = c${sub('p')}/c${sub('v')} = ${num(g.k)}`, `c${sub('v')} = R/(k − 1) = ${num(g.cv)} kJ/kg·K, c${sub('p')} = k·c${sub('v')} = ${num(g.cp)} kJ/kg·K`, `Pv = RT ties pressure, volume and temperature together at every state`]) });
    const rule = { isentropic: 'no heat, no friction: T·v^(k−1) and P·v^k stay constant', adiabatic: 'no heat, but friction: the work is the ideal work corrected by the machine efficiency', isochoric: 'volume fixed: P/T stays constant', isobaric: 'pressure fixed: v/T stays constant', isothermal: 'temperature fixed: P·v stays constant' };
    const lines = [`State 1: T = ${K(r.S[0].T)}, P = ${num(r.S[0].P)} kPa, v = RT/P = ${num(r.S[0].v)} m³/kg`];
    r.P.forEach(c => { const b = r.S[c.b]; lines.push(`${c.a + 1} → ${c.b + 1} ${c.label}`, `= ${rule[c.kind]}`); if (c.b !== 0) lines.push(`= State ${c.b + 1}: T = ${K(b.T)}, P = ${num(b.P)} kPa, v = ${num(b.v)} m³/kg`); });
    let how = '';
    if (p.type === 'otto' || p.type === 'diesel' || p.type === 'dual') how = `T${sub(2)} = T${sub(1)}·r^(k−1) = ${num(r.S[0].T)} × ${num(p.r)}^${num(g.k - 1)} = ${K(r.S[1].T)}` + (r.extra.rc ? `; cutoff ratio r${sub('c')} = ${num(r.extra.rc)}` : '');
    if (p.type === 'brayton') how = `Ideal compressor exit T${sub('2s')} = T${sub(1)}·r${sub('p')}^((k−1)/k) = ${K(r.extra.T2s)}; real T${sub(2)} = T${sub(1)} + (T${sub('2s')} − T${sub(1)})/η${sub('c')} = ${K(r.S[1].T)}. Ideal turbine exit ${K(r.extra.T4s)}; real T${sub(4)} = T${sub(3)} − η${sub('t')}(T${sub(3)} − T${sub('4s')}) = ${K(r.S[3].T)}`;
    out.push({ title: 'Around the cycle', html: `<p>Start from state 1 and follow each process with the rule that applies to it, using the ${RATIO[p.type]} = ${num(p.r)} and the peak temperature ${num(p.Tmax)} °C.</p>` + eq(lines) + (how ? `<p>${how}.</p>` : '') });
    const hw = r.P.map(c => `${c.a + 1} → ${c.b + 1}: q = ${num(c.q)} kJ/kg, w = ${num(c.w)} kJ/kg`);
    out.push({ title: 'Heat and work', html: `<p>${r.flow ? 'For a steady-flow machine the heat equals the enthalpy change in each heat exchanger and the shaft work equals the enthalpy change across each machine.' : 'For gas trapped in a cylinder: the first law is q − w = Δu, with w = ∫P dv (the area under the path on the P–v diagram) and q = ∫T ds (the area under the path on the T–s diagram).'} Heat in and work out are positive.</p>` +
      eq([...hw, r.qRegen > 0 ? `Regenerator recycles ${num(r.qRegen)} kJ/kg inside the cycle, so that much less heat is bought` : null, `→ Heat supplied ${num(r.qin)} kJ/kg, heat rejected ${num(r.qout)} kJ/kg, net work ${num(r.wnet)} kJ/kg`, `= check: heat in − heat out = ${num(r.qin - r.qout)} kJ/kg = net work`]) });
    const cf = { otto: `η = 1 − r^(1−k)`, diesel: `η = 1 − r^(1−k)·(r${sub('c')}^k − 1) / (k(r${sub('c')} − 1))`, dual: `η = 1 − r^(1−k)·(α·r${sub('c')}^k − 1) / ((α − 1) + kα(r${sub('c')} − 1))`, brayton: p.regen === 1 ? `η = 1 − (T${sub(1)}/T${sub(3)})·r${sub('p')}^((k−1)/k)` : `η = 1 − r${sub('p')}^(−(k−1)/k)`, stirling: `η = 1 − T${sub('L')}/T${sub('H')}`, carnot: `η = 1 − T${sub('L')}/T${sub('H')}` }[p.type];
    out.push({ title: 'Efficiency', html: `<p>Efficiency is what you get over what you pay for. No engine working between the same hottest and coldest temperatures can beat the Carnot limit.</p>` +
      eq([`η = w${sub('net')}/q${sub('in')} = ${num(r.wnet)} / ${num(r.qin)}`, `→ η = ${pct(r.eta)}`, r.formula != null ? `Closed form: ${cf} = ${pct(r.formula)}` : `(no simple closed form with these losses; the value comes from the state-by-state balance)`, `Carnot limit: 1 − T${sub('min')}/T${sub('max')} = ${pct(r.etaCarnot)}`,
        p.type === 'brayton' ? `Back work ratio: compressor work ÷ turbine work = ${pct(r.bwr)}` : `Mean effective pressure: w${sub('net')}/(v${sub('max')} − v${sub('min')}) = ${num(r.mep)} kPa`,
        p.type === 'brayton' ? `Pressure ratio for the most work per kg: (η${sub('c')}η${sub('t')}T${sub(3)}/T${sub(1)})^(k/2(k−1)) = ${num(r.extra.rOpt)}` : null]) });
    out.push({ title: 'Size and power', html: r.flow ? eq([`Power = ṁ·w${sub('net')} = ${num(p.mdot)} kg/s × ${num(r.wnet)} kJ/kg`, `→ ${num(r.power)} kW from ${num(r.heatRate)} kW of heat`]) :
      eq([`Gas per cycle: m = V${sub('d')}/(v${sub('max')} − v${sub('min')}) = ${num(p.Vd)} L / ${num(r.vmax - r.vmin)} m³/kg = ${num(r.mass * 1000)} g`, `Cycles per second: ${num(r.cps)} (${p.type === 'stirling' || p.type === 'carnot' ? 'one per revolution' : 'four-stroke: one every two revolutions'})`, `Power = m·w${sub('net')}·cycles/s`, `→ ${num(r.power)} kW, torque ${num(r.torque)} N·m, from ${num(r.heatRate)} kW of heat`]) });
    out.push({ title: 'What this leaves out', html: `<p>Constant specific heats, no friction or heat loss in the cylinder, instant heat addition, and no intake or exhaust strokes. Real engines reach roughly half to two thirds of these ideal efficiencies. Specific heats of real air rise with temperature, which lowers peak temperatures and efficiency compared with this model.</p>` });
  }

  function psychro(m, r, out) {
    const p = m.psychro, s = r.s1, sb = sub;
    out.push({ title: 'Saturation pressure', html: `<p>How much water vapor air can hold depends only on temperature. The saturation pressure p${sb('ws')}(t) comes from the Hyland–Wexler correlation used by ASHRAE (one fit over ice below 0 °C, another over liquid water above).</p>` +
      eq([`ln p${sb('ws')} = C${sb(8)}/T + C${sb(9)} + C${sb(10)}T + C${sb(11)}T² + C${sb(12)}T³ + C${sb(13)} ln T   (T in K, liquid)`, `p${sb('ws')}(${num(s.t)} °C) = ${num(s.ps)} kPa`, `Total pressure p = ${num(r.P)} kPa${p.useAlt ? ` at ${num(p.alt)} m: p = 101.325 (1 − 2.25577×10⁻⁵ z)^5.2559` : ''}`]) });
    out.push({ title: 'State 1', html: `<p>Two properties plus the pressure fix everything else. Properties are per kilogram of dry air, because the dry air is what stays constant while moisture comes and goes.</p>` +
      eq([`Vapor pressure p${sb('w')} = φ·p${sb('ws')} = ${num(s.pw)} kPa (φ = ${pct(s.rh)})`, `Humidity ratio W = 0.621945·p${sb('w')}/(p − p${sb('w')}) = ${num(s.W * 1000)} g/kg`, `Enthalpy h = 1.006t + W(2501 + 1.86t) = ${num(s.h)} kJ/kg`, `Volume v = 0.287042(t + 273.15)(1 + 1.6079W)/p = ${num(s.v)} m³/kg`,
        `Dew point: the temperature where p${sb('ws')} = p${sb('w')} → ${num(s.tdp)} °C`, `Wet bulb t*: solves W = [(2501 − 2.326t*)W${sb('s')}* − 1.006(t − t*)] / (2501 + 1.86t − 4.186t*) → ${num(s.twb)} °C`]) });
    if (r.s2) {
      const s2 = r.s2, L = r.load, name = { sensible: 'Heating or cooling at constant moisture', coil: 'Cooling coil', evap: 'Evaporative cooling', steam: 'Steam humidifier', mix: 'Mixing two streams' }[p.process];
      const lines = [`Dry-air flow ṁ = V̇/v${sb(1)} = ${num(p.flow)} m³/h ÷ ${num(s.v)} m³/kg = ${num(r.mda)} kg/s`];
      let text = '';
      if (p.process === 'sensible') { text = 'No moisture is added or removed, so W stays the same and the state moves horizontally on the chart.'; lines.push(`q = ṁ(h${sb(2)} − h${sb(1)}) = ṁ(1.006 + 1.86W)(t${sb(2)} − t${sb(1)})`); }
      if (p.process === 'coil') { text = 'Air that touches the coil leaves saturated at the coil surface temperature (the apparatus dew point). A fraction, the bypass factor, slips through untouched. The leaving air is the mix of the two, on a straight line toward the apparatus dew point.'; lines.push(`Apparatus dew point: ${num(p.adp)} °C, W = ${num(r.adp.W * 1000)} g/kg, h = ${num(r.adp.h)} kJ/kg`, `W${sb(2)} = W${sb('adp')} + BF(W${sb(1)} − W${sb('adp')}), h${sb(2)} = h${sb('adp')} + BF(h${sb(1)} − h${sb('adp')})`, `Coil load = ṁ[(h${sb(1)} − h${sb(2)}) − (W${sb(1)} − W${sb(2)})·4.186·t${sb('adp')}] = ${num(L.qCoil)} kW`); }
      if (p.process === 'evap') { text = 'Water evaporates into the air using the air’s own heat: the wet-bulb temperature stays constant while the dry-bulb falls toward it.'; lines.push(`t${sb(2)} = t${sb(1)} − ε(t${sb(1)} − t*) = ${num(s.t)} − ${num(p.eff)} × (${num(s.t)} − ${num(s.twb)})`); }
      if (p.process === 'steam') { text = 'Steam adds moisture with almost no change in dry-bulb temperature, so the state moves straight up.'; lines.push(`W${sb(2)} from the target ${num(p.rh2)} % at ${num(s.t)} °C`); }
      if (p.process === 'mix') { text = 'Mass and energy balances put the mixture on the straight line between the two streams, closer to the larger one.'; lines.push(`Stream B: ${num(r.sB.t)} °C, W = ${num(r.sB.W * 1000)} g/kg, h = ${num(r.sB.h)} kJ/kg, share f = ${num(p.fB)} %`, `W${sb(3)} = (1 − f)W${sb(1)} + f·W${sb('B')}, h${sb(3)} = (1 − f)h${sb(1)} + f·h${sb('B')}, then t${sb(3)} = (h − 2501W)/(1.006 + 1.86W)`); }
      lines.push(`→ Leaving: ${num(s2.t)} °C, ${pct(s2.rh)} RH, W = ${num(s2.W * 1000)} g/kg, h = ${num(s2.h)} kJ/kg`);
      if (L) lines.push(`Sensible ${num(L.qs)} kW + latent ${num(L.ql)} kW = total ${num(L.qt)} kW (+ = added to the air)`, `Water ${L.water >= 0 ? 'added' : 'removed'}: ṁ·|W${sb(2)} − W${sb(1)}| = ${num(Math.abs(L.water) * 3600)} kg/h`);
      out.push({ title: name, html: `<p>${text}</p>` + eq(lines) });
    }
    out.push({ title: 'What this leaves out', html: `<p>Moist air is treated as a mixture of ideal gases (the standard psychrometric relations; errors under about 0.7 % for comfort conditions). The coil model is the bypass-factor idealization, and a real coil’s surface temperature varies along its depth. Fog and frost formation are flagged but not modeled.</p>` });
  }

  function hx(m, r, out) {
    const p = m.hx, sb = sub, big = r.minIsHot ? 'hot' : 'cold';
    out.push({ title: 'Capacity rates', html: `<p>A stream’s capacity rate C = ṁc${sb('p')} is how many watts it takes to change its temperature by one degree. The stream with the smaller C changes temperature the most, and it limits the exchanger.</p>` +
      eq([`C${sb('hot')} = ${num(p.hot.mdot)} × ${num(p.hot.cp)} = ${num(r.Ch)} W/K`, `C${sb('cold')} = ${num(p.cold.mdot)} × ${num(p.cold.cp)} = ${num(r.Cc)} W/K`, `C${sb('min')} = ${num(r.Cmin)} W/K (the ${big} stream), C${sb('r')} = C${sb('min')}/C${sb('max')} = ${num(r.cr)}`,
        `Most heat any exchanger could move: q${sb('max')} = C${sb('min')}(T${sb('h,in')} − T${sb('c,in')}) = ${num(r.qmax / 1000)} kW`]) });
    const f = { counter: `ε = [1 − e^(−NTU(1 − C${sb('r')}))] / [1 − C${sb('r')}·e^(−NTU(1 − C${sb('r')}))]`, parallel: `ε = [1 − e^(−NTU(1 + C${sb('r')}))] / (1 + C${sb('r')})`,
      shell: `ε${sb(1)} = 2 / {1 + C${sb('r')} + √(1 + C${sb('r')}²)·[1 + e^(−NTU√(1 + C${sb('r')}²))] / [1 − e^(−NTU√(1 + C${sb('r')}²))]}`, crossUU: `ε ≈ 1 − exp[(NTU^0.22/C${sb('r')})·(e^(−C${sb('r')}·NTU^0.78) − 1)]`,
      crossMaxMixed: `ε = (1/C${sb('r')})·{1 − exp[−C${sb('r')}(1 − e^(−NTU))]}`, crossMinMixed: `ε = 1 − exp{−(1/C${sb('r')})[1 − e^(−C${sb('r')}·NTU)]}` }[p.type];
    out.push({ title: 'Size as NTU, performance as effectiveness', html: `<p>NTU = UA/C${sb('min')} measures the exchanger’s thermal size. Effectiveness ε is the fraction of q${sb('max')} actually transferred. For each flow arrangement ε depends only on NTU and C${sb('r')}.</p>` +
      eq(p.mode === 'sizing' ? [`Target → q = ${num(r.q / 1000)} kW → ε = q/q${sb('max')} = ${pct(r.eps)}`, `${C.HX[p.type]}: ${f}`, `= solved backward for NTU = ${num(r.ntu)}`, `→ A = NTU·C${sb('min')}/U = ${num(r.A)} m² (UA = ${num(r.UA)} W/K)`]
        : [`NTU = UA/C${sb('min')} = ${num(p.U)} × ${num(r.A)} / ${num(r.Cmin)} = ${num(r.ntu)}`, `${C.HX[p.type]}: ${f}`, p.type === 'shell' && p.shells > 1 ? `= ${p.shells} shells: ε = [((1 − ε${sb(1)}C${sb('r')})/(1 − ε${sb(1)}))ⁿ − 1] / [((1 − ε${sb(1)}C${sb('r')})/(1 − ε${sb(1)}))ⁿ − C${sb('r')}], with NTU split evenly` : null, `→ ε = ${pct(r.eps)} (this arrangement can never exceed ${pct(r.epsMax)})`]) });
    out.push({ title: 'Heat rate and outlets', html: eq([`q = ε·q${sb('max')} = ${num(r.q / 1000)} kW`, `T${sb('h,out')} = T${sb('h,in')} − q/C${sb('hot')} = ${num(r.Tho)} °C`, `T${sb('c,out')} = T${sb('c,in')} + q/C${sb('cold')} = ${num(r.Tco)} °C`, r.cross ? `= the cold stream leaves hotter than the hot stream leaves (a temperature cross)` : null]) });
    out.push({ title: 'The same answer by LMTD', html: `<p>The log-mean temperature difference method gives the same result: q = U·A·F·ΔT${sb('lm')}, where ΔT${sb('lm')} is taken as if the exchanger were counterflow and F ≤ 1 corrects for the real arrangement.</p>` +
      eq([`ΔT${sb(1)} = T${sb('h,in')} − T${sb('c,out')} = ${num(p.hot.Tin - r.Tco)} K, ΔT${sb(2)} = T${sb('h,out')} − T${sb('c,in')} = ${num(r.Tho - p.cold.Tin)} K`, `ΔT${sb('lm')} = (ΔT${sb(1)} − ΔT${sb(2)})/ln(ΔT${sb(1)}/ΔT${sb(2)}) = ${num(r.lmtdCF)} K`, `→ F = q/(UA·ΔT${sb('lm')}) = ${num(r.F)}`, r.F < 0.75 ? `= F below about 0.75 means this arrangement is working against itself; add a shell pass or go counterflow` : null]) });
    out.push({ title: 'What this leaves out', html: `<p>U and the specific heats are taken as constant along the exchanger, with no heat loss to the surroundings and no phase change (for a condenser or evaporator, C${sb('r')} → 0 and every arrangement behaves the same). The crossflow, both-unmixed formula is the standard approximation, good to a few percent. U itself (film coefficients and fouling) is an input here.</p>` });
  }

  function warm(m, r, out) {
    const p = m.warm, sb = sub, n1 = r.n1, n2 = r.n2;
    const nd = (n, nm) => `${nm}: ${n.mat.name}, m = ρV = ${num(n.mass * 1000)} g, C = m·c = ${num(n.C)} J/K, exposed area ${num(n.A * 1e4)} cm²`;
    out.push({ title: 'Thermal masses', html: `<p>Each part is one lump at a single temperature, with a heat capacity C (joules to warm it one degree).</p>` + eq([nd(n1, 'Heater block'), r.two ? nd(n2, 'Load') : null, r.two ? `Contact resistance between them: R${sb(12)} = ${num(p.R12)} K/W` : null]) });
    out.push({ title: 'Heat balance', html: `<p>Energy stored = heater power − losses. Each surface loses heat by convection and by radiation.</p>` +
      eq([`Loss(T) = hA(T − T${sb('∞')}) + εσA(T⁴ − T${sb('∞')}⁴)   (σ = 5.670×10⁻⁸ W/m²K⁴, T in kelvin)`, r.two ? `C${sb(1)}·dT${sb(1)}/dt = P − Loss${sb(1)}(T${sb(1)}) − (T${sb(1)} − T${sb(2)})/R${sb(12)}` : `C·dT/dt = P − Loss(T)`, r.two ? `C${sb(2)}·dT${sb(2)}/dt = (T${sb(1)} − T${sb(2)})/R${sb(12)} − Loss${sb(2)}(T${sb(2)})` : null, `= integrated with fourth-order Runge–Kutta`]) });
    out.push({ title: 'Time constant and settling', html: eq([`Loss conductance near ambient: G = hA + 4εσA·T${sb('∞')}³ = ${num(r.G1 + r.G2)} W/K`, `τ = C/G = ${dur(r.tauSlow)} (63 % of the way after one τ, 95 % after three)`, r.two ? `The two parts equalize with τ${sb(12)} = R${sb(12)}·C${sb(1)}C${sb(2)}/(C${sb(1)} + C${sb(2)}) = ${dur(r.tauFast)}` : null,
      `At full power ${num(p.P)} W the block would settle at ${num(r.ss.T1)} °C${r.two ? `, the load at ${num(r.ss.T2)} °C` : ''}`]) });
    if (r.ctl !== 'constant') out.push({ title: 'Controller', html: `<p>${r.ctl === 'onoff' ? `On/off thermostat: full power below ${num(p.setpoint - p.hyst / 2)} °C, off above ${num(p.setpoint + p.hyst / 2)} °C.` : `PI controller: P = K${sb('p')}·e + (K${sb('p')}/T${sb('i')})∫e dt, limited to 0…${num(p.P)} W, with the integral frozen while the output is saturated (anti-windup).`} The sensor is on the ${r.sens === 2 ? 'load' : 'heater block'}.</p>` +
      eq([`Power to hold ${num(p.setpoint)} °C: the losses at that temperature = ${num(r.need)} W (${pct(r.need / p.P)} of the heater)`, r.tReach != null ? `→ Reaches the setpoint after ${dur(r.tReach)}; peak ${num(r.peak)} °C (overshoot ${num(r.overshoot)} K)` : `→ Does not reach the setpoint in the time shown`,
        !r.two && r.tReach != null ? `= full-power estimate ignoring losses: C(T${sb('sp')} − T${sb(0)})/P = ${dur(n1.C * (p.setpoint - r.Ti0) / p.P)}` : null]) });
    out.push({ title: 'Is one temperature per part fair?', html: `<p>The Biot number compares how easily heat leaves the surface with how easily it spreads inside. Below about 0.1 the part is nearly uniform and the lumped model is good.</p>` +
      eq([`Bi = h${sb('eff')}·L${sb('c')}/k, with L${sb('c')} = V/A = ${num(n1.Lc * 1000)} mm, k = ${num(n1.mat.k)} W/m·K`, `→ Heater block Bi = ${num(r.biot1)}${r.two ? `, load Bi = ${num(r.biot2)}` : ''}`]) });
    out.push({ title: 'Energy books', html: eq([`Heater energy in: ${num(r.Ein / 3600)} Wh`, `Lost to the room: ${num(r.Eloss / 3600)} Wh`, `Stored in the parts: ${num(r.U / 3600)} Wh`, `= in − lost − stored = ${num(r.residual)} J (should be zero)`]) });
    out.push({ title: 'What this leaves out', html: `<p>h is a constant you supply (natural convection is roughly 5–15 W/m²K and actually rises with temperature difference). The heater and sensor respond instantly, and there are no gradients inside a part. Real sensors lag, which adds overshoot. Material properties are room-temperature values.</p>` });
  }

  function explain(model, r) {
    if (!r || !r.ok) return [{ title: 'No solution', html: `<p>${r ? r.message : ''}</p>` }];
    const out = []; ({ cycles, psychro, hx, warm })[r.kind === 'psychro' ? 'psychro' : r.kind](model, r, out); return out;
  }
  return { explain, num, dur, pct };
})();
if (typeof module !== 'undefined') module.exports = Explain;
