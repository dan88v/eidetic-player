import { discoverFfmpeg } from "../apps/backend/src/analysis/ffmpeg-discovery.js";

const discovery = await discoverFfmpeg();
if (!discovery) {
  console.error(
    "[ffmpeg:doctor] FFmpeg not found. Add ffmpeg to PATH or set EIDETIC_FFMPEG_PATH.",
  );
  process.exitCode = 1;
} else {
  console.log(`[ffmpeg:doctor] found: ${discovery.executable}`);
  console.log(`[ffmpeg:doctor] version: ${discovery.version}`);
  console.log("[ffmpeg:doctor] process execution: OK");
}
