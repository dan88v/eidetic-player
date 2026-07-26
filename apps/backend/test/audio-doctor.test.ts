import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import test from "node:test";

const doctorPath = "deploy/linux/doctor-installation.sh";

function runDoctorFunction(
  command: string,
  arguments_: readonly string[] = [],
): string {
  const result = spawnSync(
    "bash",
    [
      "-c",
      `source "${doctorPath}"; ${command}`,
      "audio-doctor-test",
      ...arguments_,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function listen(
  responder: (requestPath: string) => string | null,
): Promise<Server> {
  const server = createServer((request, response) => {
    const body = responder(request.url ?? "");
    if (body === null) return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(4310, "127.0.0.1", resolve);
  });
  return server;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function readAppDiagnostics(): Promise<{
  readonly output: string;
  readonly elapsedMilliseconds: number;
}> {
  const startedAt = performance.now();
  const child = spawn(
    "bash",
    [
      "-c",
      `source "${doctorPath}"; NODE_PATH="$1"; if command -v cygpath >/dev/null; then NODE_PATH="$(cygpath -u "$NODE_PATH")"; fi; eidetic_audio_read_app "$NODE_PATH"`,
      "audio-doctor-test",
      process.execPath,
    ],
    { cwd: process.cwd() },
  );
  let output = "";
  let error = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    error += chunk;
  });
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(status, 0, error);
  return {
    output,
    elapsedMilliseconds: performance.now() - startedAt,
  };
}

void test("audio doctor classifies service stacks without mutating them", () => {
  assert.equal(
    runDoctorFunction("eidetic_audio_stack active active active not-found"),
    "pipewire-pulse",
  );
  assert.equal(
    runDoctorFunction("eidetic_audio_stack active inactive active not-found"),
    "pipewire",
  );
  assert.equal(
    runDoctorFunction("eidetic_audio_stack inactive inactive inactive active"),
    "pulseaudio",
  );
  assert.equal(
    runDoctorFunction(
      "eidetic_audio_stack inactive inactive inactive inactive",
    ),
    "alsa-only",
  );
});

void test("audio doctor distinguishes HDMI PCM from a coherent GPIO I2S DAC", () => {
  const hdmiCards =
    " 0 [vc4hdmi0       ]: vc4-hdmi - vc4-hdmi-0\n" +
    "                      vc4-hdmi-0";
  const hdmiPcm = "00-00: MAI PCM i2s-hifi-0 : : playback 1";
  assert.equal(
    runDoctorFunction(
      `eidetic_audio_hardware_summary "$(printf %s ${Buffer.from(hdmiCards).toString("base64")} | base64 -d)" "$(printf %s ${Buffer.from(hdmiPcm).toString("base64")} | base64 -d)" ""`,
    ),
    "1|detected|not-detected",
  );

  const dacCards =
    `${hdmiCards}\n 1 [sndrpirpidac   ]: simple-card - RPi-DAC\n` +
    "                      RPi-DAC";
  const dacPcm = `${hdmiPcm}\n01-00: RPi-DAC pcm1794a-hifi-0 : : playback 1`;
  assert.equal(
    runDoctorFunction(
      `eidetic_audio_hardware_summary "$(printf %s ${Buffer.from(dacCards).toString("base64")} | base64 -d)" "$(printf %s ${Buffer.from(dacPcm).toString("base64")} | base64 -d)" "snd_soc_rpi_simple_soundcard 16384 0 - Live 0x0"`,
    ),
    "2|detected|detected",
  );
  assert.equal(
    runDoctorFunction(
      `eidetic_audio_hardware_summary "$(printf %s ${Buffer.from(hdmiCards).toString("base64")} | base64 -d)" "$(printf %s ${Buffer.from(hdmiPcm).toString("base64")} | base64 -d)" "snd_soc_rpi_simple_soundcard 16384 0 - Live 0x0"`,
    ),
    "1|detected|not-detected",
  );
});

void test(
  "audio doctor reads sanitized valid app diagnostics",
  { skip: process.platform === "win32" },
  async () => {
    const server = await listen((path) => {
      if (path === "/api/audio-output/state")
        return JSON.stringify({
          ok: true,
          data: {
            mpvAvailable: true,
            effectiveDeviceId: "alsa/default",
            diagnostics: {
              currentAo: "alsa",
              normalizedDeviceCount: 3,
              preferredDeviceAvailable: true,
              initialEnumerationStatus: "ready",
            },
          },
        });
      return JSON.stringify({
        ok: true,
        data: { mpvVersion: 'mpv 0.41.0 "unsafe"' },
      });
    });
    try {
      const result = await readAppDiagnostics();
      assert.match(result.output, /^reachable=reachable$/mu);
      assert.match(result.output, /^mpvAvailable=true$/mu);
      assert.match(result.output, /^currentAo=alsa$/mu);
      assert.match(result.output, /^preferredAvailable=true$/mu);
      assert.match(result.output, /^effectiveOutput=specific$/mu);
      assert.match(result.output, /^deviceCount=3$/mu);
      assert.match(result.output, /^initialEnumerationStatus=ready$/mu);
      assert.match(result.output, /^mpvVersion=mpv 0\.41\.0 unsafe$/mu);
    } finally {
      await close(server);
    }
  },
);

void test(
  "audio doctor bounds malformed, unreachable, and timed-out app reads",
  { skip: process.platform === "win32" },
  async () => {
    const malformed = await listen(() => "{");
    try {
      assert.match(
        (await readAppDiagnostics()).output,
        /^reachable=invalid$/mu,
      );
    } finally {
      await close(malformed);
    }

    assert.match(
      (await readAppDiagnostics()).output,
      /^reachable=unavailable$/mu,
    );

    const hanging = await listen(() => null);
    try {
      const timedOut = await readAppDiagnostics();
      assert.match(timedOut.output, /^reachable=unavailable$/mu);
      assert.ok(timedOut.elapsedMilliseconds < 2_500);
    } finally {
      await close(hanging);
    }
  },
);

void test("audio doctor source remains read-only and does not start playback", async () => {
  const source = await readFile(doctorPath, "utf8");
  for (const mutation of [
    /speaker-test/u,
    /wpctl\s+set-/u,
    /pactl\s+set-/u,
    /systemctl\s+(?:--user\s+)?(?:start|stop|restart|enable|disable)/u,
    /\bsudo\b/u,
    /\bmpv\s+--/u,
  ])
    assert.doesNotMatch(source, mutation);
  assert.match(source, /Read-only:/u);
  assert.match(source, /initialEnumerationStatus/u);
});
