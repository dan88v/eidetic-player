export const AIRPLAY_RECEIVER_NAME_MAX_LENGTH = 40;
export const airPlayAudioBufferSecondsChoices = [1, 2, 4] as const;

export type AirPlayAudioBufferSeconds =
  (typeof airPlayAudioBufferSecondsChoices)[number];

export type AirPlayReceiverNameOrigin = "generated" | "user";
export type AirPlayProtocol = "airplay2" | "classic" | "unavailable";
export type AirPlayServiceStatus =
  "unavailable" | "off" | "starting" | "ready" | "active" | "error";

export interface AirPlaySettings {
  readonly enabled: boolean;
  readonly receiverName: string;
  readonly receiverNameOrigin: AirPlayReceiverNameOrigin;
  readonly audioBufferSeconds: AirPlayAudioBufferSeconds;
}

export interface AirPlayState extends AirPlaySettings {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly available: boolean;
  readonly protocol: AirPlayProtocol;
  readonly serviceStatus: AirPlayServiceStatus;
  readonly integrationVersion: string;
  readonly audioBufferPendingRestart: boolean;
  readonly message: string | null;
}

export interface AirPlaySettingsPatch {
  readonly enabled?: boolean;
  readonly receiverName?: string;
  readonly audioBufferSeconds?: AirPlayAudioBufferSeconds;
  readonly expectedRevision?: number;
}

export function isAirPlayAudioBufferSeconds(
  value: unknown,
): value is AirPlayAudioBufferSeconds {
  return airPlayAudioBufferSecondsChoices.some((choice) => choice === value);
}

export function normalizeAirPlayReceiverName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length < 1 ||
    normalized.length > AIRPLAY_RECEIVER_NAME_MAX_LENGTH
  )
    return null;
  let visible = 0;
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint === 0 ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    )
      return null;
    visible += 1;
  }
  return visible > 0 ? normalized : null;
}
