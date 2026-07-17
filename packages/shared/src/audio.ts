export const supportedAudioExtensions = [
  "flac",
  "wav",
  "wave",
  "mp3",
  "m4a",
  "aac",
  "alac",
  "ogg",
  "opus",
  "aiff",
  "aif",
  "wma",
  "ape",
  "wv",
] as const;

export type SupportedAudioExtension = (typeof supportedAudioExtensions)[number];

export function isSupportedAudioPath(path: string): boolean {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) return false;
  const extension = path
    .split(/[./\\]/)
    .at(-1)
    ?.toLowerCase();
  return supportedAudioExtensions.some((candidate) => candidate === extension);
}
