import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";
import {
  AUDIO_OUTPUT_DESCRIPTION_MAX_LENGTH,
  defaultAudioOutputPreference,
  isAudioOutputDeviceId,
  normalizeAudioOutputDescription,
  type AudioOutputPreference,
} from "../../../../packages/shared/src/audio-output.js";
import { resolveAppDirectories } from "../platform/app-directories.js";

interface PersistedAudioOutputPreference {
  readonly version: 1;
  readonly preferredDeviceId: string;
  readonly preferredDeviceDescription: string;
}

export function audioOutputConfigPath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home?: string,
): string {
  const platformPath = platform === "win32" ? win32 : posix;
  return platformPath.join(
    resolveAppDirectories(platform, environment, home ?? undefined).config,
    "audio-output.json",
  );
}

export function parseAudioOutputPreference(
  value: unknown,
): AudioOutputPreference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !isAudioOutputDeviceId(record.preferredDeviceId) ||
    typeof record.preferredDeviceDescription !== "string" ||
    record.preferredDeviceDescription.trim().length === 0 ||
    record.preferredDeviceDescription.length >
      AUDIO_OUTPUT_DESCRIPTION_MAX_LENGTH
  )
    return null;
  return {
    deviceId: record.preferredDeviceId,
    description: normalizeAudioOutputDescription(
      record.preferredDeviceDescription,
      record.preferredDeviceId,
    ),
  };
}

export class AudioOutputRepository {
  constructor(readonly configPath = audioOutputConfigPath()) {}

  async read(): Promise<AudioOutputPreference> {
    let text: string;
    try {
      text = await readFile(this.configPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return defaultAudioOutputPreference;
      throw error;
    }
    try {
      const preference = parseAudioOutputPreference(
        JSON.parse(text) as unknown,
      );
      if (preference) return preference;
    } catch {
      // The invalid file is preserved below before falling back.
    }
    await this.preserveCorrupt();
    console.warn("[audio-output] invalid preference ignored");
    return defaultAudioOutputPreference;
  }

  async write(preference: AudioOutputPreference): Promise<void> {
    const persisted: PersistedAudioOutputPreference = {
      version: 1,
      preferredDeviceId: preference.deviceId,
      preferredDeviceDescription: preference.description,
    };
    const directory = dirname(this.configPath);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.configPath}.${String(process.pid)}-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.configPath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async preserveCorrupt(): Promise<void> {
    const backup = `${this.configPath}.corrupt-${String(Date.now())}`;
    await copyFile(this.configPath, backup).catch(() => undefined);
    await rm(this.configPath, { force: true }).catch(() => undefined);
  }
}
