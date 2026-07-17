import { discoverMpv } from "../apps/backend/src/player/mpv-discovery.js";
import { MpvController } from "../apps/backend/src/player/mpv-controller.js";

const discovery = await discoverMpv();
if (!discovery) {
  console.error(
    "[mpv:doctor] MPV not found. Add mpv to PATH or set EIDETIC_MPV_PATH.",
  );
  process.exitCode = 1;
} else {
  console.log(`[mpv:doctor] found: ${discovery.executable}`);
  console.log(`[mpv:doctor] version: ${discovery.version}`);
  const controller = new MpvController();
  try {
    await controller.start({
      executable: discovery.executable,
      extraArguments: ["--ao=null"],
    });
    await controller.getProperty("mpv-version");
    console.log("[mpv:doctor] headless startup and JSON IPC: OK");
  } catch (error) {
    console.error("[mpv:doctor] IPC check failed", error);
    process.exitCode = 1;
  } finally {
    await controller.stop().catch(() => {
      // The primary diagnostic above determines the exit status.
    });
  }
}
