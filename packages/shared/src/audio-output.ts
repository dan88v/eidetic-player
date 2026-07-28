export const AUDIO_OUTPUT_DEVICE_ID_MAX_LENGTH = 512;
export const AUDIO_OUTPUT_DESCRIPTION_MAX_LENGTH = 256;
export const AUDIO_OUTPUT_DEVICE_LIMIT = 64;
export const AUDIO_OUTPUT_CURRENT_AO_MAX_LENGTH = 128;

export const audioOutputInitialEnumerationStatuses = [
  "ready",
  "timed-out",
  "unavailable",
] as const;

export type AudioOutputInitialEnumerationStatus =
  (typeof audioOutputInitialEnumerationStatuses)[number];

export const audioOutputStatuses = [
  "active",
  "system-default",
  "pending-playback",
  "preferred-unavailable",
  "mpv-unavailable",
  "switching",
  "error",
] as const;

export type AudioOutputStatus = (typeof audioOutputStatuses)[number];

export interface AudioOutputDevice {
  readonly id: string;
  readonly description: string;
  readonly available: boolean;
  readonly systemDefault?: boolean;
}

export type AudioOutputRouteKind =
  "system" | "pipewire" | "pulse" | "alsa" | "other";

export interface AudioOutputRoute {
  readonly id: string;
  readonly description: string;
  readonly kind: AudioOutputRouteKind;
  readonly available: boolean;
}

export interface CanonicalAudioOutput {
  readonly id: string;
  readonly description: string;
  readonly available: boolean;
  readonly systemDefault?: boolean;
  readonly routes: readonly AudioOutputRoute[];
}

export interface AudioOutputPreference {
  readonly deviceId: string;
  readonly description: string;
}

export interface AudioOutputDiagnostics {
  readonly currentAo: string | null;
  readonly normalizedDeviceCount: number;
  readonly preferredDeviceAvailable: boolean;
  readonly initialEnumerationStatus: AudioOutputInitialEnumerationStatus;
}

export interface AudioOutputState {
  readonly mpvAvailable: boolean;
  readonly devices: readonly AudioOutputDevice[];
  readonly preferredDevice: AudioOutputPreference;
  readonly effectiveDeviceId: string;
  readonly status: AudioOutputStatus;
  readonly switching: boolean;
  readonly revision: number;
  readonly notice: "preferred-unavailable" | null;
  readonly noticeRevision: number;
  readonly diagnostics: AudioOutputDiagnostics;
  readonly canonicalOutputs: readonly CanonicalAudioOutput[];
  readonly selectedPhysicalOutputId: string;
}

export interface AudioOutputSelectionResult {
  readonly changed: boolean;
  readonly deviceId: string;
}

export const systemDefaultAudioOutputDevice: AudioOutputDevice = {
  id: "auto",
  description: "System default",
  available: true,
  systemDefault: true,
};

export const defaultAudioOutputPreference: AudioOutputPreference = {
  deviceId: systemDefaultAudioOutputDevice.id,
  description: systemDefaultAudioOutputDevice.description,
};

export const disconnectedAudioOutputState: AudioOutputState = {
  mpvAvailable: false,
  devices: [systemDefaultAudioOutputDevice],
  preferredDevice: defaultAudioOutputPreference,
  effectiveDeviceId: "auto",
  status: "mpv-unavailable",
  switching: false,
  revision: 0,
  notice: null,
  noticeRevision: 0,
  diagnostics: {
    currentAo: null,
    normalizedDeviceCount: 1,
    preferredDeviceAvailable: false,
    initialEnumerationStatus: "unavailable",
  },
  canonicalOutputs: [
    {
      id: "system-default",
      description: "System default",
      available: true,
      systemDefault: true,
      routes: [
        {
          id: "auto",
          description: "System default",
          kind: "system",
          available: true,
        },
      ],
    },
  ],
  selectedPhysicalOutputId: "system-default",
};

function boundedText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > maximumLength) return null;
  return text;
}

export function isAudioOutputDeviceId(value: unknown): value is string {
  return (
    boundedText(value, AUDIO_OUTPUT_DEVICE_ID_MAX_LENGTH) !== null &&
    value === (value as string).trim()
  );
}

export function normalizeAudioOutputDescription(
  value: unknown,
  fallback: string,
): string {
  return (
    boundedText(value, AUDIO_OUTPUT_DESCRIPTION_MAX_LENGTH) ??
    boundedText(fallback, AUDIO_OUTPUT_DESCRIPTION_MAX_LENGTH) ??
    "Audio output"
  );
}

export function normalizeMpvCurrentAo(value: unknown): string | null {
  const currentAo = boundedText(value, AUDIO_OUTPUT_CURRENT_AO_MAX_LENGTH);
  if (!currentAo) return null;
  for (const character of currentAo) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127))
      return null;
  }
  return currentAo;
}

export function normalizeMpvAudioOutputDevices(
  value: unknown,
): readonly AudioOutputDevice[] {
  const devices: AudioOutputDevice[] = [systemDefaultAudioOutputDevice];
  if (!Array.isArray(value)) return devices;
  const seen = new Set<string>(["auto"]);
  for (const record of value.slice(0, AUDIO_OUTPUT_DEVICE_LIMIT)) {
    if (!record || typeof record !== "object") continue;
    const candidate = record as {
      readonly name?: unknown;
      readonly description?: unknown;
    };
    const id = boundedText(candidate.name, AUDIO_OUTPUT_DEVICE_ID_MAX_LENGTH);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    devices.push({
      id,
      description: normalizeAudioOutputDescription(candidate.description, id),
      available: true,
    });
  }
  return devices;
}

function routeKind(id: string): AudioOutputRouteKind {
  const prefix = id.split("/", 1)[0];
  if (prefix === "pipewire" || prefix === "pulse" || prefix === "alsa")
    return prefix;
  return id === "auto" ? "system" : "other";
}

function physicalIdentity(device: AudioOutputDevice): {
  readonly id: string;
  readonly description: string;
} {
  if (device.id === "auto")
    return { id: "system-default", description: "System default" };
  const evidence = `${device.id} ${device.description}`.toLowerCase();
  if (/sndrpirpidac|soc_sound|rpi[- ]?dac|pcm1794/.test(evidence))
    return { id: "gpio-i2s-dac", description: "GPIO / I2S DAC" };
  if (/vc4hdmi|hdmi|digital stereo/.test(evidence))
    return { id: "hdmi", description: "HDMI" };
  if (/headphones|mailbox|analog/.test(evidence))
    return { id: "analog-output", description: "Analog output" };
  if (device.id === "pipewire" || device.id === "pulse" || device.id === "alsa")
    return {
      id: `backend-default:${device.id}`,
      description: device.description,
    };
  return {
    id: `raw:${device.id}`,
    description: device.description,
  };
}

export function canonicalizeAudioOutputs(
  devices: readonly AudioOutputDevice[],
): readonly CanonicalAudioOutput[] {
  const groups = new Map<string, CanonicalAudioOutput>();
  for (const device of devices) {
    if (/^(?:pipewire|pulse|alsa|openal|jack|sdl|sndio)$/u.test(device.id))
      continue;
    const identity = physicalIdentity(device);
    const route: AudioOutputRoute = {
      id: device.id,
      description: device.description,
      kind: routeKind(device.id),
      available: device.available,
    };
    const existing = groups.get(identity.id);
    groups.set(identity.id, {
      id: identity.id,
      description: identity.description,
      available: (existing?.available ?? false) || device.available,
      ...(device.id === "auto" ? { systemDefault: true } : {}),
      routes: [...(existing?.routes ?? []), route],
    });
  }
  return [...groups.values()].sort((left, right) => {
    if (left.systemDefault) return -1;
    if (right.systemDefault) return 1;
    return left.description.localeCompare(right.description, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

export function physicalOutputIdForRoute(
  outputs: readonly CanonicalAudioOutput[],
  routeId: string,
): string {
  return (
    outputs.find((output) =>
      output.routes.some((route) => route.id === routeId),
    )?.id ?? "system-default"
  );
}

export function audioOutputDevicesEqual(
  left: readonly AudioOutputDevice[],
  right: readonly AudioOutputDevice[],
): boolean {
  return (
    left.length === right.length &&
    left.every((device, index) => {
      const other = right[index];
      return (
        other?.id === device.id &&
        other.description === device.description &&
        other.available === device.available &&
        other.systemDefault === device.systemDefault
      );
    })
  );
}
