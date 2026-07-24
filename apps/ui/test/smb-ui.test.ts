import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) =>
  readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

void test("Sources owns SMB Add/Edit/Remove and Browse actions", async () => {
  const text = await source("screens/sources.ts");
  assert.match(text, /Network Shares|sources\.networkShares/u);
  assert.match(text, /Add Share/u);
  assert.match(text, /Add Network Share/u);
  assert.match(text, /data-smb-auth="account"/u);
  assert.match(text, /data-smb-auth="guest"/u);
  assert.match(text, /Domain \/ Workgroup/u);
  assert.match(text, /smbServer\.readOnly = mode === "edit"/u);
  assert.match(text, /smbShare\.readOnly = mode === "edit"/u);
  assert.match(text, /smb-retry/u);
  assert.match(text, /smb-remove/u);
});

void test("top bar hides zero SMB state and exposes green/red/neutral summaries", async () => {
  const text = await source("components/top-bar.ts");
  assert.match(text, /smbButton\.hidden = snapshot\.configuredCount === 0/u);
  assert.match(text, /"connected"/u);
  assert.match(text, /"error"/u);
  assert.match(text, /"connecting"/u);
  assert.match(text, /Authentication required/u);
  assert.match(
    text,
    /of \$\{String\(snapshot\.configuredCount\)\} unavailable/u,
  );
  assert.doesNotMatch(text, /Retry|Browse|Settings/u);
});

void test("SMB Quick Browse reuses Folders without Library actions", async () => {
  const text = await source("screens/smb-browse.ts");
  assert.match(text, /createFoldersScreen/u);
  assert.match(text, /smbSession/u);
  assert.match(text, /SMB \/ \$\{options\.connection\.displayName\}/u);
  assert.doesNotMatch(
    text,
    /Favorite|Playlist|History|Most Played|Add this folder to Library/u,
  );
});

void test("SMB is absent from Main Player and drawer navigation", async () => {
  const [main, cassette, menu] = await Promise.all([
    source("main-player/main-player-host.ts"),
    source("cassette/cassette-main-player.ts"),
    source("components/side-menu.ts"),
  ]);
  assert.doesNotMatch(main, /smb/i);
  assert.doesNotMatch(cassette, /smb/i);
  assert.doesNotMatch(menu, /smb/i);
});

void test("app shell owns one SMB EventSource and disconnect toast", async () => {
  const [shell, api] = await Promise.all([
    source("components/app-shell.ts"),
    source("api/smb-api-client.ts"),
  ]);
  assert.equal((shell.match(/smbApi\.subscribe/g) ?? []).length, 1);
  assert.equal((api.match(/new EventSource/g) ?? []).length, 1);
  assert.match(shell, /Network share disconnected\./u);
  assert.match(shell, /currentScreen\?\.updateSmbSnapshot/u);
});
