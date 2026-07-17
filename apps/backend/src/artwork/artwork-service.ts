import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ArtworkRef } from "../../../../packages/shared/src/player.js";
import type { PictureCandidate } from "../metadata/types.js";

export const MAX_ARTWORK_BYTES = 15 * 1024 * 1024;
export const MAX_ARTWORK_RECORDS = 64;
export const MAX_ARTWORK_CACHE_BYTES = 128 * 1024 * 1024;

export type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp";

export interface ArtworkResource {
  readonly path: string;
  readonly mimeType: SupportedImageMime;
  readonly size: number;
  readonly etag: string;
}

interface RegistryRecord extends ArtworkResource {
  readonly ref: ArtworkRef;
  readonly embedded: boolean;
  readonly fingerprint: string;
  readonly expectedMtimeMs: number | null;
  lastAccess: number;
}

const folderCandidates = [
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "cover.webp",
  "folder.jpg",
  "folder.jpeg",
  "folder.png",
  "folder.webp",
  "front.jpg",
  "front.jpeg",
  "front.png",
  "front.webp",
] as const;

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeDeclaredMime(value: string): SupportedImageMime | null {
  const mime = value.trim().toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg" || mime === "jpeg")
    return "image/jpeg";
  if (mime === "image/png" || mime === "png") return "image/png";
  if (mime === "image/webp" || mime === "webp") return "image/webp";
  return null;
}

export function detectImageMime(data: Uint8Array): SupportedImageMime | null {
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return "image/jpeg";
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  )
    return "image/png";
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}

export function validatePicture(
  picture: PictureCandidate,
  maxBytes = MAX_ARTWORK_BYTES,
): SupportedImageMime | null {
  if (picture.data.byteLength > maxBytes) return null;
  const declared = normalizeDeclaredMime(picture.mimeType);
  const detected = detectImageMime(picture.data);
  return declared && declared === detected ? detected : null;
}

export function selectEmbeddedPicture(
  pictures: readonly PictureCandidate[],
): PictureCandidate | null {
  const valid = pictures.filter((picture) => validatePicture(picture));
  const score = (picture: PictureCandidate): number => {
    const description =
      `${picture.type ?? ""} ${picture.description ?? ""}`.toLowerCase();
    if (description.includes("front")) return 0;
    if (description.includes("cover")) return 1;
    return 2;
  };
  return valid.sort((left, right) => score(left) - score(right))[0] ?? null;
}

export function isOpaqueArtworkId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );
}

export class ArtworkService {
  readonly maxRecords = MAX_ARTWORK_RECORDS;
  readonly maxBytes = MAX_ARTWORK_CACHE_BYTES;
  readonly tempDirectory = join(
    tmpdir(),
    `eidetic-player-artwork-${String(process.pid)}-${randomUUID()}`,
  );
  private readonly records = new Map<string, RegistryRecord>();
  private readonly fingerprintIds = new Map<string, string>();
  private readonly mediaArtwork = new Map<string, ArtworkRef | null>();
  private readonly pinned = new Set<string>();
  private readonly warnings = new Set<string>();
  private totalBytes = 0;
  private closed = false;

  has(id: string): boolean {
    return this.records.has(id);
  }

  setPinned(refs: readonly (ArtworkRef | null)[]): void {
    this.pinned.clear();
    for (const ref of refs) if (ref) this.pinned.add(ref.id);
  }

  async resolve(
    audioPath: string,
    mediaKey: string,
    pictures: readonly PictureCandidate[],
  ): Promise<ArtworkRef | null> {
    if (this.closed) return null;
    const cached = this.mediaArtwork.get(mediaKey);
    if (cached && (await this.getResource(cached.id))) return cached;
    this.mediaArtwork.delete(mediaKey);

    const selected = selectEmbeddedPicture(pictures);
    if (selected) {
      const ref = await this.registerEmbedded(selected);
      this.mediaArtwork.set(mediaKey, ref);
      return ref;
    }
    const folder = await this.findFolderArtwork(audioPath);
    if (folder) this.mediaArtwork.set(mediaKey, folder);
    return folder;
  }

  async getResource(id: string): Promise<ArtworkResource | null> {
    if (!isOpaqueArtworkId(id)) return null;
    const record = this.records.get(id);
    if (!record) return null;
    try {
      const file = await stat(record.path);
      if (
        file.size !== record.size ||
        (record.expectedMtimeMs !== null &&
          file.mtimeMs !== record.expectedMtimeMs)
      ) {
        await this.removeRecord(record);
        return null;
      }
      record.lastAccess = Date.now();
      return {
        path: record.path,
        mimeType: record.mimeType,
        size: record.size,
        etag: record.etag,
      };
    } catch {
      await this.removeRecord(record);
      return null;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.records.clear();
    this.fingerprintIds.clear();
    this.mediaArtwork.clear();
    this.pinned.clear();
    this.totalBytes = 0;
    const resolvedTemp = resolve(this.tempDirectory);
    const safeParent = resolve(tmpdir());
    if (
      dirname(resolvedTemp) === safeParent &&
      basename(resolvedTemp).startsWith("eidetic-player-artwork-")
    )
      await rm(resolvedTemp, { recursive: true, force: true }).catch(
        (error: unknown) => {
          console.warn("[artwork] temporary cleanup failed", error);
        },
      );
  }

  private async registerEmbedded(
    picture: PictureCandidate,
  ): Promise<ArtworkRef | null> {
    const mimeType = validatePicture(picture);
    if (!mimeType) {
      this.warnOnce("invalid-embedded", "embedded artwork is invalid");
      return null;
    }
    const fingerprint = digest(picture.data);
    const existing = this.refForFingerprint(fingerprint);
    if (existing) return existing;
    await mkdir(this.tempDirectory, { recursive: true });
    const extension =
      mimeType === "image/jpeg" ? "jpg" : (mimeType.split("/")[1] ?? "img");
    const path = join(this.tempDirectory, `${randomUUID()}.${extension}`);
    await writeFile(path, picture.data);
    const ref = this.register({
      path,
      mimeType,
      size: picture.data.byteLength,
      fingerprint,
      sourceType: "embedded",
      embedded: true,
      expectedMtimeMs: null,
    });
    await this.trim();
    return ref;
  }

  private async findFolderArtwork(
    audioPath: string,
  ): Promise<ArtworkRef | null> {
    const audioDirectory = dirname(await realpath(audioPath));
    let entries;
    try {
      entries = await readdir(audioDirectory, { withFileTypes: true });
    } catch {
      this.warnOnce(`folder:${audioDirectory}`, "folder artwork lookup failed");
      return null;
    }
    const files = new Map(
      entries
        .filter((entry) => entry.isFile())
        .map((entry) => [entry.name.toLowerCase(), entry.name]),
    );
    for (const candidate of folderCandidates) {
      const actualName = files.get(candidate);
      if (!actualName) continue;
      const path = join(audioDirectory, actualName);
      const registered = await this.registerFolder(path);
      if (registered) return registered;
    }
    return null;
  }

  private async registerFolder(path: string): Promise<ArtworkRef | null> {
    try {
      const canonicalPath = await realpath(path);
      const file = await stat(canonicalPath);
      if (!file.isFile() || file.size > MAX_ARTWORK_BYTES) {
        this.warnOnce(`size:${canonicalPath}`, "folder artwork is too large");
        return null;
      }
      const handle = await open(canonicalPath, "r");
      const signature = Buffer.alloc(12);
      try {
        await handle.read(signature, 0, signature.length, 0);
      } finally {
        await handle.close();
      }
      const mimeType = detectImageMime(signature);
      if (!mimeType) {
        this.warnOnce(`mime:${canonicalPath}`, "folder artwork is invalid");
        return null;
      }
      const fingerprint = digest(
        `${canonicalPath}\0${String(file.size)}\0${String(file.mtimeMs)}`,
      );
      const existing = this.refForFingerprint(fingerprint);
      if (existing) return existing;
      const ref = this.register({
        path: canonicalPath,
        mimeType,
        size: file.size,
        fingerprint,
        sourceType: "folder",
        embedded: false,
        expectedMtimeMs: file.mtimeMs,
      });
      await this.trim();
      return ref;
    } catch {
      this.warnOnce(`io:${path}`, "folder artwork could not be read");
      return null;
    }
  }

  private register(input: {
    readonly path: string;
    readonly mimeType: SupportedImageMime;
    readonly size: number;
    readonly fingerprint: string;
    readonly sourceType: ArtworkRef["sourceType"];
    readonly embedded: boolean;
    readonly expectedMtimeMs: number | null;
  }): ArtworkRef {
    const id = randomUUID();
    const ref: ArtworkRef = {
      id,
      mimeType: input.mimeType,
      sourceType: input.sourceType,
      revision: input.fingerprint,
    };
    const record: RegistryRecord = {
      ref,
      path: input.path,
      mimeType: input.mimeType,
      size: input.size,
      etag: `"${input.fingerprint}"`,
      fingerprint: input.fingerprint,
      embedded: input.embedded,
      expectedMtimeMs: input.expectedMtimeMs,
      lastAccess: Date.now(),
    };
    this.records.set(id, record);
    this.fingerprintIds.set(input.fingerprint, id);
    this.totalBytes += input.size;
    return ref;
  }

  private refForFingerprint(fingerprint: string): ArtworkRef | null {
    const id = this.fingerprintIds.get(fingerprint);
    const record = id ? this.records.get(id) : null;
    if (!record) return null;
    record.lastAccess = Date.now();
    return record.ref;
  }

  private async trim(): Promise<void> {
    while (
      this.records.size > this.maxRecords ||
      this.totalBytes > this.maxBytes
    ) {
      const candidate = [...this.records.values()]
        .filter((record) => !this.pinned.has(record.ref.id))
        .sort((left, right) => left.lastAccess - right.lastAccess)[0];
      if (!candidate) break;
      await this.removeRecord(candidate);
    }
  }

  private async removeRecord(record: RegistryRecord): Promise<void> {
    this.records.delete(record.ref.id);
    this.fingerprintIds.delete(record.fingerprint);
    this.totalBytes = Math.max(0, this.totalBytes - record.size);
    if (record.embedded)
      await rm(record.path, { force: true }).catch(() => {
        this.warnOnce(
          `cleanup:${record.ref.id}`,
          "embedded artwork cleanup failed",
        );
      });
  }

  private warnOnce(key: string, message: string): void {
    if (this.warnings.has(key)) return;
    this.warnings.add(key);
    console.warn(`[artwork] ${message}`);
  }
}
