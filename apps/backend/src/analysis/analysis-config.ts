const profile =
  process.env.EIDETIC_ANALYZER_PROFILE === "rpi3" ? "rpi3" : "desktop";

export const analysisConfig = Object.freeze({
  profile,
  sampleRate: profile === "rpi3" ? 16_000 : 24_000,
  channels: 2,
  fftSize: 1_024,
  hopSize: 512,
  maximumFramesPerSecond: profile === "rpi3" ? 15 : 20,
  driftRestartSeconds: 1.5,
  driftRestartCooldownMilliseconds: 30_000,
  startupCatchupMaximumSeconds: 1,
  realTimeEnabled: process.env.EIDETIC_ANALYZER_ENABLED !== "false",
  waveformNextPreloadEnabled:
    process.env.EIDETIC_WAVEFORM_PRELOAD_NEXT !== "false",
});
