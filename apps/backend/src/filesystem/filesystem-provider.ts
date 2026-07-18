import type {
  FilesystemDirectoryEntry,
  FilesystemStat,
} from "./filesystem-types.js";

export interface FilesystemProvider {
  readonly platform: NodeJS.Platform;
  stat(path: string): Promise<FilesystemStat>;
  lstat(path: string): Promise<FilesystemStat>;
  readdir(path: string): Promise<readonly FilesystemDirectoryEntry[]>;
  realpath(path: string): Promise<string>;
  access(path: string): Promise<void>;
}
