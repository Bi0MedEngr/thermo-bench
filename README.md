# Thermo Bench

Gas power cycles, psychrometrics, heat exchangers and heater warm-up, with the math shown

- Live (installable on iPad: Safari → Share → Add to Home Screen): https://bi0medengr.github.io/thermo-bench/
- One self-contained HTML file, no network use. Units: °C, kPa, kJ/kg, W, mm, kg/s.

## Labs
- **Gas cycles** — Otto, Diesel, dual, Brayton (compressor/turbine efficiencies, regenerator), Stirling and Carnot on P–v and T–s diagrams with a moving state, state and process tables, efficiency and net work versus ratio.
- **Moist air** — psychrometric chart with a draggable state; dew point, wet bulb, enthalpy, volume; heating/cooling, cooling coil with bypass factor, evaporative cooler, steam humidifier and mixing, with loads and water rates. Sea level or any altitude.
- **Heat exchanger** — effectiveness–NTU rating and sizing for counterflow, parallel flow, shell and tube (1–4 shells) and three crossflow cases; temperature profiles, LMTD and correction factor.
- **Warm-up** — one or two lumped thermal masses with convection and radiation, constant power, on/off thermostat or PI control; time to setpoint, overshoot, holding power, Biot check, energy books.

Every lab has a "Show the math" drawer with the equations and your numbers.

## Files
- `core.js` — the engineering model (pure, no DOM). `explain.js` — the math drawer text. `presets.js` — worked examples. `app.js` — UI. `page.html` — layout and styles.
- `build.sh` — inlines everything into `thermo-bench.html` (claude.ai artifact) and `docs/` (GitHub Pages web app).
- `tests/test_core.js` — model vs closed-form answers. `tests/browser_test.py` — UI smoke test (light, dark, iPad, phone).
- `web/` — web app manifest, offline service worker, icon (`icon.svg` → `render_icons.py`).
- `fonts/` — IBM Plex (SIL Open Font License, `fonts/OFL.txt`), embedded at build time.

## Method and limits
- Gas cycles: ideal gas, constant specific heats (air-standard), no friction or heat loss except the stated machine efficiencies. Real engines reach roughly half to two thirds of these efficiencies.
- Moist air: ASHRAE ideal-gas psychrometric relations with the Hyland–Wexler saturation pressure. The cooling coil is the bypass-factor model. Fog and frost are flagged, not modeled.
- Heat exchangers: constant U and specific heats, no phase change, no heat loss. Crossflow with both streams unmixed uses the standard approximate formula. U is an input.
- Warm-up: each part is one temperature (check the Biot number), constant h, room-temperature material properties, ideal sensor and heater.

## Validation
`node tests/test_core.js` runs 197 checks against closed forms, hand calculations and published values: cycle efficiencies (Otto, Diesel, dual, Brayton with and without losses and regeneration, Stirling, Carnot), ∫T ds and ∫P dv along every drawn path, saturation pressures, the 25 °C / 50 % chart point, mixing and coil balances, a textbook oil-cooler problem, the shell-and-tube F factor from the P–R formula, exponential warm-up and Newton cooling, radiation-only steady state, a two-mass network solved by hand, and energy conservation in every simulation.
