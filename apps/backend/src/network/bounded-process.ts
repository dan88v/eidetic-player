import { spawn } from "node:child_process";

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export function runBoundedProcess(
  executable: string,
  args: readonly string[],
  options: {
    readonly input?: string;
    readonly timeoutMs?: number;
    readonly env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env,
    });
    const limit = 512 * 1024;
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length + chunk.length > limit) {
        child.kill();
        finish(() => {
          reject(new Error("Network helper output exceeded limit"));
        });
      } else stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < limit)
        stderr += chunk.slice(0, limit - stderr.length);
    });
    child.once("error", (error) => {
      finish(() => {
        reject(error);
      });
    });
    child.once("close", (code) => {
      finish(() => {
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
    const timer = setTimeout(() => {
      child.kill();
      finish(() => {
        reject(new Error("Network helper timed out"));
      });
    }, options.timeoutMs ?? 12_000);
    timer.unref();
  });
}
