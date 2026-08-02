import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { mpvObservedProperties } from "../src/player/mpv-controller.js";
import { createMpvEndpoint } from "../src/player/mpv-endpoint.js";
import {
  MpvTransport,
  type MpvPlaylistEntry,
  type MpvResponse,
} from "../src/player/mpv-transport.js";

void test("controller observes the effective MPV playing position", () => {
  assert.equal(
    mpvObservedProperties.filter(
      (property) => property === "playlist-playing-pos",
    ).length,
    1,
  );
});

void test(
  "transport preserves playlist entry IDs on MPV events and playlist data",
  { timeout: 2_000 },
  async () => {
    const endpoint = await createMpvEndpoint();
    let sendFixture!: (message: MpvResponse) => void;
    let markSocketReady!: () => void;
    const socketReady = new Promise<void>((resolve) => {
      markSocketReady = resolve;
    });
    const server = createServer((socket) => {
      sendFixture = (message) => {
        socket.write(`${JSON.stringify(message)}\n`);
      };
      markSocketReady();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(endpoint.path, resolve);
    });
    const transport = await MpvTransport.connect(endpoint.path);
    try {
      await socketReady;
      const messages: MpvResponse[] = [];
      let markMessagesReceived!: () => void;
      const messagesReceived = new Promise<void>((resolve) => {
        markMessagesReceived = resolve;
      });
      transport.subscribe((message) => {
        messages.push(message);
        if (messages.length === 2) markMessagesReceived();
      });

      const playlist: readonly MpvPlaylistEntry[] = [
        {
          id: 41,
          filename: "C:\\fixture\\A.flac",
          current: true,
          playing: true,
        },
      ];
      sendFixture({
        event: "start-file",
        playlist_entry_id: 41,
      });
      sendFixture({
        event: "property-change",
        id: 6,
        name: "playlist",
        data: playlist,
      });

      await messagesReceived;
      const [startFile, playlistChange] = messages;
      assert.ok(startFile);
      assert.ok(playlistChange);
      assert.equal(startFile.playlist_entry_id, 41);
      assert.equal(playlistChange.id, 6);
      assert.equal(
        (playlistChange.data as readonly MpvPlaylistEntry[])[0]?.id,
        41,
      );
    } finally {
      transport.close();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
      await endpoint.cleanup();
    }
  },
);
