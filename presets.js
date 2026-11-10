// Examples. Each fills every lab so switching labs keeps sensible values.
// Temperatures °C, pressure kPa, flows kg/s (m³/h for air in the psychrometric lab), dimensions mm, power W.
const Presets = (() => {
  const base = () => ({
    lab: 'cycles', name: '',
    cycles: { type: 'otto', gas: 'air', T1: 27, P1: 100, r: 9.5, Tmax: 1900, alpha: 1.4, etaC: 0.85, etaT: 0.88, regen: 0, mdot: 1, Vd: 2, rpm: 3000, logAxes: false },
    psychro: { useAlt: false, P: 101.325, alt: 0, t: 25, mode: 'rh', val: 50, flow: 1000, process: 'none', t2: 35, adp: 10, bf: 0.15, eff: 0.85, rh2: 50, tB: 35, rhB: 40, fB: 30 },
    hx: { type: 'counter', shells: 1, hot: { fluid: 'oil', mdot: 0.1, cp: 2131, Tin: 100 }, cold: { fluid: 'water', mdot: 0.2, cp: 4178, Tin: 30 }, mode: 'rating', U: 38.1, A: 5.176, target: 'Tco', targetVal: 40 },
    warm: { Tamb: 22, Tinit: 22, P: 150, control: 'onoff', setpoint: 200, hyst: 4, Kp: 12, Ti: 40, sensor: 1, tEnd: 0,
      block: { mat: 'al6061', L: 60, W: 40, H: 20, h: 10, emis: 0.2, exposed: 100 }, load: { on: false, mat: 'ss304', L: 40, W: 40, H: 10, h: 10, emis: 0.3, exposed: 100 }, R12: 0.8 },
  });
  const mk = (name, lab, patch) => { const b = base(); b.name = name; b.lab = lab; if (patch) for (const [k, v] of Object.entries(patch)) b[lab][k] = v && typeof v === 'object' && !Array.isArray(v) ? Object.assign(b[lab][k] || {}, v) : v; return b; };
  const list = {
    otto: () => mk('Gasoline engine (Otto)', 'cycles', { type: 'otto', r: 9.5, Tmax: 1900, Vd: 2, rpm: 3000 }),
    diesel: () => mk('Diesel engine', 'cycles', { type: 'diesel', r: 18, Tmax: 1650, Vd: 2, rpm: 2200 }),
    dual: () => mk('Dual cycle (limited pressure)', 'cycles', { type: 'dual', r: 16, alpha: 1.4, Tmax: 1800, Vd: 2, rpm: 2500 }),
    braytonIdeal: () => mk('Gas turbine, ideal (Brayton)', 'cycles', { type: 'brayton', r: 10, Tmax: 1100, etaC: 1, etaT: 1, regen: 0, mdot: 5 }),
    braytonReal: () => mk('Gas turbine with losses and a regenerator', 'cycles', { type: 'brayton', r: 6, Tmax: 1000, etaC: 0.84, etaT: 0.88, regen: 0.75, mdot: 5 }),
    stirling: () => mk('Stirling engine on helium', 'cycles', { type: 'stirling', gas: 'he', T1: 40, P1: 1000, r: 2.5, Tmax: 650, regen: 0.9, Vd: 0.2, rpm: 1500 }),
    carnot: () => mk('Carnot engine', 'cycles', { type: 'carnot', T1: 27, r: 4, Tmax: 627, Vd: 1, rpm: 600 }),
    comfort: () => mk('Room air: 25 °C, 50 %', 'psychro', { t: 25, mode: 'rh', val: 50, process: 'none' }),
    coolingCoil: () => mk('Summer cooling coil', 'psychro', { t: 32, mode: 'rh', val: 55, process: 'coil', adp: 9, bf: 0.12, flow: 2000 }),
    winterHeat: () => mk('Winter heating dries the air', 'psychro', { t: 2, mode: 'rh', val: 80, process: 'sensible', t2: 22, flow: 1500 }),
    swamp: () => mk('Desert evaporative cooler', 'psychro', { t: 40, mode: 'rh', val: 12, process: 'evap', eff: 0.85, flow: 3000 }),
    mixing: () => mk('Mixing outdoor and return air', 'psychro', { t: 24, mode: 'rh', val: 50, process: 'mix', tB: 35, rhB: 45, fB: 25, flow: 4000 }),
    highAlt: () => mk('Steam humidifier at 1600 m', 'psychro', { useAlt: true, alt: 1600, t: 21, mode: 'rh', val: 15, process: 'steam', rh2: 40, flow: 1200 }),
    oilCooler: () => mk('Oil cooler, counterflow (textbook)', 'hx', { type: 'counter', mode: 'rating', U: 38.1, A: 5.176 }),
    oilCoolerParallel: () => mk('Same oil cooler in parallel flow', 'hx', { type: 'parallel', mode: 'rating', U: 38.1, A: 5.176 }),
    shellTube: () => mk('Shell and tube, sized for a target', 'hx', { type: 'shell', shells: 1, hot: { fluid: 'water', mdot: 1.5, cp: 4180, Tin: 90 }, cold: { fluid: 'water', mdot: 2.5, cp: 4180, Tin: 20 }, mode: 'sizing', U: 1200, target: 'Tho', targetVal: 50 }),
    radiator: () => mk('Coolant radiator in crossflow', 'hx', { type: 'crossUU', hot: { fluid: 'glycol', mdot: 0.8, cp: 3400, Tin: 95 }, cold: { fluid: 'air', mdot: 1.6, cp: 1007, Tin: 30 }, mode: 'rating', U: 110, A: 9 }),
    heaterBlock: () => mk('Aluminum heater block, on/off thermostat', 'warm', { control: 'onoff', P: 150, setpoint: 200, hyst: 4 }),
    hotPlate: () => mk('Hot plate with a PI controller', 'warm', { control: 'pi', P: 400, setpoint: 180, Kp: 20, Ti: 60, block: { mat: 'al6061', L: 150, W: 150, H: 10, h: 9, emis: 0.3 } }),
    blockAndLoad: () => mk('Heater block driving a steel part', 'warm', { control: 'pi', P: 200, setpoint: 150, Kp: 15, Ti: 80, sensor: 1, load: { on: true, mat: 'ss304', L: 50, W: 40, H: 15 }, R12: 0.8 }),
    constantPower: () => mk('Constant power: where does it settle?', 'warm', { control: 'constant', P: 25 }),
    coolDown: () => mk('Steel part cooling in air', 'warm', { control: 'constant', P: 0, Tinit: 300, block: { mat: 'steel', L: 80, W: 50, H: 25, h: 12, emis: 0.8 } }),
  };
  const titles = {}; for (const k of Object.keys(list)) titles[k] = list[k]().name;
  const groups = [['Gas cycles', ['otto', 'diesel', 'dual', 'braytonIdeal', 'braytonReal', 'stirling', 'carnot']], ['Moist air', ['comfort', 'coolingCoil', 'winterHeat', 'swamp', 'mixing', 'highAlt']],
    ['Heat exchangers', ['oilCooler', 'oilCoolerParallel', 'shellTube', 'radiator']], ['Heater warm-up', ['heaterBlock', 'hotPlate', 'blockAndLoad', 'constantPower', 'coolDown']]];
  return { base, list, titles, groups };
})();
if (typeof module !== 'undefined') module.exports = Presets;
