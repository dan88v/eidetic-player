import { constants } from "node:fs";
import { access, lstat, readdir, realpath, stat } from "node:fs/promises";
import type { FilesystemProvider } from "./filesystem-provider.js";

export class LocalFilesystemProvider implements FilesystemProvider {
  readonly platform = process.platform;

  stat(path: string) {
    return stat(path);
  }

  lstat(path: string) {
    return lstat(path);
  }

  readdir(path: string) {
    return readdir(path, { withFileTypes: true });
  }

  realpath(path: string) {
    return realpath(path);
  }

  access(path: string) {
    return access(path, constants.R_OK);
  }
}
