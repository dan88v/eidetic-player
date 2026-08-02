import type { AirPlayDocument } from "./airplay-store.js";
import type { ExternalPlaybackRoute } from "../playback-source/external-playback-provider.js";

function quoted(value: string): string {
  let result = '"';
  for (const character of value.normalize("NFC")) {
    if (character === "\\" || character === '"') result += `\\${character}`;
    else if (character === "\n" || character === "\r" || character === "\0")
      throw new Error("AirPlay configuration contains an invalid character.");
    else result += character;
  }
  return `${result}"`;
}

export interface AirPlayRuntimePaths {
  readonly controlSocket: string;
  readonly metadataPipe: string;
  readonly hookExecutable: string;
}

export function renderAirPlayConfig(
  document: AirPlayDocument,
  route: ExternalPlaybackRoute,
  paths: AirPlayRuntimePaths,
): string {
  if (route.routeKind !== "alsa" && route.routeKind !== "pipewire")
    throw new Error("The selected output route is not supported by AirPlay.");
  const backend = route.routeKind === "pipewire" ? "pw" : "alsa";
  const hook = paths.hookExecutable;
  const fixed = route.levelMode === "fixed";
  return [
    "general =",
    "{",
    `  name = ${quoted(document.receiverName)};`,
    '  service_type = "auto";',
    `  output_backend = ${quoted(backend)};`,
    `  ignore_volume_control = ${quoted(fixed ? "yes" : "no")};`,
    "};",
    "sessioncontrol =",
    "{",
    `  run_this_before_play_begins = ${quoted(`${hook} before`)};`,
    `  run_this_after_play_ends = ${quoted(`${hook} after`)};`,
    '  wait_for_completion = "yes";',
    "  session_timeout = 15;",
    '  allow_session_interruption = "yes";',
    "};",
    "metadata =",
    "{",
    '  enabled = "yes";',
    '  include_cover_art = "yes";',
    `  pipe_name = ${quoted(paths.metadataPipe)};`,
    "  pipe_timeout = 1000;",
    "  progress_interval = 0.25;",
    "};",
    ...(route.routeKind === "alsa"
      ? [
          "alsa =",
          "{",
          `  output_device = ${quoted(route.providerTarget.replace(/^alsa\//u, ""))};`,
          "};",
        ]
      : [
          "pipewire =",
          "{",
          `  application_name = ${quoted(document.receiverName)};`,
          `  node_name = ${quoted("Eidetic Player AirPlay")};`,
          `  sink_target = ${quoted(route.providerTarget.replace(/^pipewire\//u, ""))};`,
          "};",
        ]),
    "",
  ].join("\n");
}
