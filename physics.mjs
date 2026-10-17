// Physically constrained educational kernels, not validated manufacturer digital twins.
export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sliderCrank = (theta, radius, rodLength) => {
  if (!(radius > 0 && rodLength > radius)) throw new RangeError('rod length must exceed crank radius');
  const s = radius * Math.sin(theta);
  const y = radius * Math.cos(theta) + Math.sqrt(rodLength ** 2 - s ** 2);
  return { x: radius * Math.sin(theta), pinY: radius * Math.cos(theta), wristY: y,
    displacement: radius + rodLength - y };
};
export const sweptVolume = (engine) => Math.PI / 4 * (engine.bore / 1000) ** 2 * engine.stroke / 1000;
export const cylinderVolume = (engine, crankDegrees) => {
  const radius = engine.stroke / 2000, rod = radius * engine.rodRatio;
  const disp = sliderCrank(crankDegrees * Math.PI / 180, radius, rod).displacement;
  const swept = sweptVolume(engine);
  const clearance = swept / Math.max(0.05, (engine.compression - 1));
  return { volume: clearance + (Math.PI / 4 * (engine.bore / 1000) ** 2) * disp, min: clearance, max: clearance + swept };
};
export const phaseLabel = degrees => {
  const d = ((degrees % 720) + 720) % 720;
  return d < 180 ? 'INTAKE' : d < 360 ? 'COMPRESSION' : d < 540 ? 'POWER' : 'EXHAUST';
};
export function samplePhysics(engine, angle, rpm, throttle, mode = 'deploy', soc = 0.66) {
  const deg = ((angle * 180 / Math.PI) % 720 + 720) % 720;
  const family = engine.family, layout = engine.layout;
  const electric = family === 'Electric';
  const steam = family === 'Steam' || family === 'External heat';
  const jet = family === 'Turbine';
  const combustion = family === 'Combustion' || family === 'Hybrid';
  const fourStroke = combustion && layout !== 'twostroke';
  const volume = cylinderVolume(engine, deg);
  const gamma = 1.34; // representative, not a universal gas-specific calibration
  const cr = Math.max(1.5, engine.compression);
  let state, pressure, temperature, heatFlow, efficiency;
  if (fourStroke) {
    state = phaseLabel(deg);
    const ratio = volume.max / volume.volume;
    const intakeBar = engine.id.startsWith('f1') ? 2.1 : 0.99;
    const heatGain = 1.0 + 2.25 * clamp(throttle, 0, 1);
    const compressPeak = intakeBar * cr ** gamma;
    pressure = state === 'INTAKE' ? intakeBar : state === 'COMPRESSION' ? intakeBar * ratio ** gamma
      : state === 'POWER' ? compressPeak * heatGain * (volume.min / volume.volume) ** gamma
      : 1.12;
    temperature = state === 'INTAKE' ? 310 : state === 'COMPRESSION' ? 310 * ratio ** (gamma - 1)
      : state === 'POWER' ? 310 * cr ** (gamma - 1) * heatGain * (volume.min / volume.volume) ** (gamma - 1)
      : 590;
    heatFlow = state === 'POWER' ? clamp(throttle, 0, 1) : 0;
    efficiency = 1 - Math.pow(cr, 1 - gamma);
  } else if (layout === 'twostroke') {
    state = deg % 360 < 180 ? 'EXPANSION + EXHAUST' : 'TRANSFER + COMPRESSION';
    pressure = state.startsWith('EXPANSION') ? (18 + throttle * 34) * (volume.min / volume.volume) ** 1.25 : Math.max(1, 1.15 * (volume.max / volume.volume) ** 1.25);
    temperature = 340 + 650 * throttle * Math.max(0, Math.sin(deg * Math.PI / 180)); heatFlow = throttle; efficiency = .27;
  } else if (steam) {
    const wave = Math.cos(angle);
    state = layout === 'reaction' ? 'STEAM REACTION' : layout === 'turbine' ? 'STEAM EXPANSION' : wave > 0 ? 'STEAM ADMISSION' : 'CONDENSATION / EXHAUST';
    pressure = layout === 'beam' && engine.id === 'newcomen' ? (wave > 0 ? 1.0 : 0.18) : 1 + throttle * (layout === 'reaction' ? 1.6 : 5.0);
    temperature = 373 + throttle * 85; heatFlow = throttle; efficiency = .08 + throttle * .08;
  } else if (jet) {
    state = 'BRAYTON CYCLE'; pressure = 1 + 15 * throttle; temperature = 320 + 1250 * throttle; heatFlow = throttle; efficiency = .28 + .13 * throttle;
  } else {
    state = 'ELECTROMAGNETIC TORQUE'; pressure = 1; temperature = 310 + 60 * throttle; heatFlow = 0; efficiency = .9 + .05 * (1 - throttle);
  }
  const hybrid = family === 'Hybrid';
  // Public rules-level 2026 figures; representative power envelope only.
  const iceCap = engine.id === 'f1-2026' ? 400 : engine.id === 'f1-2014' ? 550 : engine.id === 'prius' ? 75 : 0;
  const motorCap = engine.id === 'f1-2026' ? 350 : engine.id === 'f1-2014' ? 120 : engine.id === 'prius' ? 50 : electric ? 180 : 0;
  const iceKw = hybrid ? iceCap * throttle * clamp(rpm / 9000, .28, 1) : 0;
  const motorKw = (electric || hybrid) ? (mode === 'regen' ? -motorCap * .45 * (rpm > 300 ? 1 : 0) : motorCap * throttle * (soc > .03 ? 1 : 0)) : 0;
  const netKw = iceKw + motorKw;
  return { deg, state, pressure, temperature, heatFlow, efficiency, volume: volume.volume * 1e6,
    volumeMin: volume.min * 1e6, volumeMax: volume.max * 1e6, iceKw, motorKw, netKw,
    soc, rpm, throttle, mode, powerSource: electric ? 'ELECTRIC' : steam ? 'EXTERNAL HEAT' : jet ? 'BRAYTON GAS' : 'COMBUSTION',
    phase: ((deg % 360) / 360), fourStroke, cylinder: volume,
  };
}
export function stepEnergy(soc, sample, dt, engine) {
  if (engine.family !== 'Hybrid' && engine.family !== 'Electric') return soc;
  // Synthetic 4 MJ reference store for the sandbox only. Not a certified F1 battery spec.
  const storeKJ = engine.id === 'prius' ? 4500 : engine.id === 'ev' ? 60 * 3600000 / 1000 : 4000;
  return clamp(soc - (sample.motorKw * dt / storeKJ), 0, 1);
}
export function tracePV(engine, throttle = .65) {
  const out = [];
  for (let i = 0; i <= 144; i++) {
    const deg = i * 5;
    const physics = samplePhysics(engine, deg * Math.PI / 180, 4500, throttle);
    out.push({ x: physics.volume, y: physics.pressure, deg });
  }
  return out;
}