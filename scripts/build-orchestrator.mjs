import { fstatSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const applicationBuildSteps = Object.freeze([
  Object.freeze({
    id: "clean-build",
    command: "npm",
    arguments: Object.freeze(["run", "clean"]),
  }),
  Object.freeze({
    id: "generate-build-info",
    command: "npm",
    arguments: Object.freeze(["run", "build:info"]),
  }),
  Object.freeze({
    id: "generate-shell-config",
    command: "npm",
    arguments: Object.freeze(["run", "shell:config:prod"]),
  }),
  Object.freeze({
    id: "build-ui",
    command: "npm",
    arguments: Object.freeze(["run", "build:ui"]),
  }),
  Object.freeze({
    id: "build-remote",
    command: "npm",
    arguments: Object.freeze(["run", "build:remote"]),
  }),
  Object.freeze({
    id: "build-backend",
    command: "npm",
    arguments: Object.freeze(["run", "build:backend"]),
  }),
]);

export const linuxPackagingSteps = Object.freeze([
  Object.freeze({
    id: "sync-neutralino",
    command: "npm",
    arguments: Object.freeze(["run", "neutralino:sync"]),
    attempts: 3,
    retryDelaysMilliseconds: Object.freeze([5_000, 10_000]),
  }),
  Object.freeze({
    id: "package-neutralino",
    command: "npm",
    arguments: Object.freeze(["run", "neutralino:build"]),
  }),
]);

function npmInvocation(arguments_, platform = process.platform) {
  if (platform !== "win32") return { executable: "npm", arguments: arguments_ };
  const npmCli = process.env.npm_execpath;
  if (npmCli)
    return {
      executable: process.execPath,
      arguments: [npmCli, ...arguments_],
    };
  return {
    executable: process.env.ComSpec ?? "cmd.exe",
    arguments: ["/d", "/s", "/c", "npm.cmd", ...arguments_],
  };
}

export function progressConfiguration(
  environment,
  ownedStepCount,
  validateDescriptor = (descriptor) => fstatSync(descriptor),
) {
  const descriptorText = environment.EIDETIC_PROGRESS_FD;
  const offsetText = environment.EIDETIC_RUNTIME_PROGRESS_OFFSET;
  const totalText = environment.EIDETIC_RUNTIME_PROGRESS_TOTAL;
  if (
    descriptorText === undefined &&
    offsetText === undefined &&
    totalText === undefined
  )
    return null;
  if (
    !/^[0-9]+$/u.test(descriptorText ?? "") ||
    !/^[0-9]+$/u.test(offsetText ?? "") ||
    !/^[0-9]+$/u.test(totalText ?? "")
  )
    throw new Error("runtime progress configuration must be numeric");
  const descriptor = Number(descriptorText);
  const offset = Number(offsetText);
  const total = Number(totalText);
  if (
    !Number.isSafeInteger(descriptor) ||
    descriptor < 3 ||
    descriptor > 255 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(total) ||
    total < offset + ownedStepCount ||
    total > 64
  )
    throw new Error("runtime progress configuration is out of range");
  validateDescriptor(descriptor);
  return { descriptor, offset, total };
}

export function protocolLine(event, id, index, total, elapsedMilliseconds) {
  if (!["start", "done", "skipped", "failed"].includes(event))
    throw new Error("invalid build progress event");
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(id))
    throw new Error("invalid build progress step ID");
  if (
    !Number.isSafeInteger(index) ||
    index < 1 ||
    !Number.isSafeInteger(total) ||
    total < index
  )
    throw new Error("invalid build progress position");
  const fields = [
    "EIDETIC_PROGRESS_V1",
    "runtime",
    event,
    id,
    String(index),
    String(total),
  ];
  if (event !== "start") {
    if (!Number.isSafeInteger(elapsedMilliseconds) || elapsedMilliseconds < 0)
      throw new Error("invalid build progress duration");
    fields.push(String(elapsedMilliseconds));
  }
  return `${fields.join("\t")}\n`;
}

function emitProtocol(configuration, event, id, index, elapsedMilliseconds) {
  if (!configuration) return;
  writeSync(
    configuration.descriptor,
    protocolLine(event, id, index, configuration.total, elapsedMilliseconds),
  );
}

async function spawnCommand(command, arguments_, platform = process.platform) {
  const invocation =
    command === "npm"
      ? npmInvocation(arguments_, platform)
      : { executable: command, arguments: arguments_ };
  const child = spawn(invocation.executable, invocation.arguments, {
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  const forward = (signal) => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill(signal);
  };
  process.once("SIGINT", forward);
  process.once("SIGTERM", forward);
  try {
    return await new Promise((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code !== null) resolvePromise(code);
        else resolvePromise(signal === "SIGINT" ? 130 : 143);
      });
    });
  } finally {
    process.removeListener("SIGINT", forward);
    process.removeListener("SIGTERM", forward);
  }
}

async function runOwnedSteps(
  steps,
  configuration,
  runner,
  nowNanoseconds,
  wait,
) {
  for (let position = 0; position < steps.length; position += 1) {
    const step = steps[position];
    const index = (configuration?.offset ?? 0) + position + 1;
    const started = nowNanoseconds();
    emitProtocol(configuration, "start", step.id, index);
    console.log(`COMMAND: ${step.command} ${step.arguments.join(" ")}`);
    const attempts = step.attempts ?? 1;
    let status = 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      status = await runner(step.command, [...step.arguments]);
      if (status === 0 || attempt === attempts) break;
      const delay = step.retryDelaysMilliseconds?.[attempt - 1] ?? 0;
      console.warn(
        `[build-orchestrator] ${step.id} attempt ${String(attempt)} failed; retrying in ${String(delay / 1_000)} seconds`,
      );
      await wait(delay);
    }
    const elapsed = Number((nowNanoseconds() - started) / 1_000_000n);
    emitProtocol(
      configuration,
      status === 0 ? "done" : "failed",
      step.id,
      index,
      elapsed,
    );
    if (status !== 0) return status;
  }
  return 0;
}

export async function runBuildOrchestrator(
  mode,
  {
    environment = process.env,
    runner = spawnCommand,
    nowNanoseconds = () => process.hrtime.bigint(),
    wait = (milliseconds) =>
      new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
    validateDescriptor,
  } = {},
) {
  if (mode !== "app" && mode !== "linux")
    throw new Error("build orchestrator mode must be app or linux");
  if (mode === "app") {
    const configuration = progressConfiguration(
      environment,
      applicationBuildSteps.length,
      validateDescriptor,
    );
    return runOwnedSteps(
      applicationBuildSteps,
      configuration,
      runner,
      nowNanoseconds,
      wait,
    );
  }

  const configuration = progressConfiguration(
    environment,
    applicationBuildSteps.length + linuxPackagingSteps.length,
    validateDescriptor,
  );
  console.log("COMMAND: npm run build");
  const buildStatus = await runner("npm", ["run", "build"]);
  if (buildStatus !== 0) return buildStatus;
  const packagingConfiguration = configuration
    ? {
        ...configuration,
        offset: configuration.offset + applicationBuildSteps.length,
      }
    : null;
  return runOwnedSteps(
    linuxPackagingSteps,
    packagingConfiguration,
    runner,
    nowNanoseconds,
    wait,
  );
}

async function main() {
  try {
    const status = await runBuildOrchestrator(process.argv[2]);
    if (status !== 0) process.exitCode = status;
  } catch (error) {
    console.error(
      `[build-orchestrator] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
