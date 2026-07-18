import path, { posix, win32, type PlatformPath } from "node:path";
import type { FilesystemProvider } from "./filesystem-provider.js";
import { FilesystemError } from "./filesystem-errors.js";

export type PathPlatform = "win32" | "linux";

function invalidLogicalPath(): never {
  throw new FilesystemError(
    "INVALID_PATH",
    "The requested library location is invalid.",
  );
}

export class PathService {
  private readonly native: PlatformPath;

  constructor(
    readonly platform: PathPlatform,
    private readonly provider?: FilesystemProvider,
  ) {
    this.native = platform === "win32" ? win32 : posix;
  }

  static forCurrentPlatform(provider?: FilesystemProvider): PathService {
    return new PathService(
      process.platform === "win32" ? "win32" : "linux",
      provider,
    );
  }

  normalizeNativePath(value: string): string {
    if (!value || value.includes("\0"))
      throw new FilesystemError("INVALID_PATH", "A valid folder is required.");
    return this.native.normalize(this.native.resolve(value));
  }

  async canonicalizePath(value: string): Promise<string> {
    const normalized = this.normalizeNativePath(value);
    return this.native.normalize(
      this.provider ? await this.provider.realpath(normalized) : normalized,
    );
  }

  pathKey(value: string): string {
    const normalized = this.normalizeNativePath(value);
    return this.platform === "win32"
      ? normalized.toLocaleLowerCase("en")
      : normalized;
  }

  validateLogicalRelativePath(value: string): string {
    if (value === "") return "";
    if (
      value.includes("\0") ||
      value.startsWith("/") ||
      value.startsWith("\\") ||
      /^[a-z]:/i.test(value) ||
      value.startsWith("//") ||
      value.startsWith("\\\\") ||
      value.includes("\\")
    )
      invalidLogicalPath();
    const segments = value.split("/");
    if (
      segments.some(
        (segment) =>
          segment === "" ||
          segment === "." ||
          segment === ".." ||
          segment.includes(":"),
      )
    )
      invalidLogicalPath();
    return segments.join("/");
  }

  fromLogicalRelativePath(root: string, logicalPath: string): string {
    const valid = this.validateLogicalRelativePath(logicalPath);
    const normalizedRoot = this.normalizeNativePath(root);
    if (!valid) return normalizedRoot;
    return this.native.resolve(normalizedRoot, ...valid.split("/"));
  }

  toLogicalRelativePath(root: string, nativePath: string): string {
    const normalizedRoot = this.normalizeNativePath(root);
    const normalizedPath = this.normalizeNativePath(nativePath);
    if (!this.isWithinSource(normalizedRoot, normalizedPath))
      invalidLogicalPath();
    const relative = this.native.relative(normalizedRoot, normalizedPath);
    if (!relative) return "";
    return relative.split(this.native.sep).join("/");
  }

  async resolveWithinSource(
    canonicalRoot: string,
    logicalPath: string,
  ): Promise<string> {
    const candidate = this.fromLogicalRelativePath(canonicalRoot, logicalPath);
    const canonical = await this.canonicalizePath(candidate).catch(() => {
      throw new FilesystemError(
        "LOCATION_NOT_FOUND",
        "The requested library location is unavailable.",
        404,
      );
    });
    if (!this.isWithinSource(canonicalRoot, canonical)) invalidLogicalPath();
    return canonical;
  }

  isWithinSource(root: string, candidate: string): boolean {
    const normalizedRoot = this.normalizeNativePath(root);
    const normalizedCandidate = this.normalizeNativePath(candidate);
    const relative = this.native.relative(normalizedRoot, normalizedCandidate);
    return (
      relative === "" ||
      (!relative.startsWith(`..${this.native.sep}`) &&
        relative !== ".." &&
        !this.native.isAbsolute(relative))
    );
  }

  basenameForDisplay(value: string): string {
    const normalized = this.normalizeNativePath(value);
    const parsed = this.native.parse(normalized);
    return this.native.basename(normalized) || parsed.root || "Local Folder";
  }

  dirnameLogical(value: string): string {
    const valid = this.validateLogicalRelativePath(value);
    if (!valid) return "";
    const parent = path.posix.dirname(valid);
    return parent === "." ? "" : parent;
  }

  joinLogical(parent: string, name: string): string {
    const validParent = this.validateLogicalRelativePath(parent);
    if (
      !name ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\\") ||
      name.includes("\0")
    )
      invalidLogicalPath();
    return this.validateLogicalRelativePath(
      validParent ? `${validParent}/${name}` : name,
    );
  }

  extension(value: string): string {
    return this.native.extname(value).slice(1).toLowerCase();
  }
}
