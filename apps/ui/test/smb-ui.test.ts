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

void test("Sources separates indexed Library Sources from live resources", async () => {
  const [text, styles] = await Promise.all([
    source("screens/sources.ts"),
    source("styles/screens.css"),
  ]);
  const library = text.indexOf("Library Sources");
  const resources = text.indexOf("Available Resources");
  const local = text.indexOf("Local Storage");
  const usb = text.indexOf('id="usb-storage-heading"');
  const smb = text.indexOf('id="network-shares-heading"');
  assert.ok(
    library >= 0 &&
      library < resources &&
      resources < local &&
      local < usb &&
      usb < smb,
  );
  assert.match(text, /sources-list--library/u);
  assert.match(text, /No Library sources configured\./u);
  assert.match(text, /No USB storage connected\./u);
  assert.match(text, /sources-local-add/u);
  assert.match(text, /sources-smb-add/u);
  assert.doesNotMatch(
    text,
    /USB Library Folders|sources-list--removable-library/u,
  );
  assert.doesNotMatch(text, /<h1/u);
  assert.match(styles, /--sources-icon-size: 5\.5rem/u);
  assert.match(
    styles,
    /\.sources-section__intro h3[\s\S]*margin: 0;[\s\S]*line-height: 1\.9/u,
  );
  assert.match(
    styles,
    /\.source-card__copy h3[\s\S]*margin: 0;[\s\S]*line-height: 1\.9/u,
  );
  assert.match(styles, /\.source-card__copy p[\s\S]*line-height: 1\.9/u);
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

void test("SMB Quick Browse reuses Folders with the canonical Library action", async () => {
  const [text, usb, styles] = await Promise.all([
    source("screens/smb-browse.ts"),
    source("screens/usb-storage.ts"),
    source("styles/screens.css"),
  ]);
  assert.match(text, /createFoldersScreen/u);
  assert.match(text, /smbSession/u);
  assert.match(text, /SMB \/ \$\{options\.connection\.displayName\}/u);
  assert.match(text, /resource-browser-screen/u);
  assert.match(usb, /resource-browser-screen/u);
  assert.match(styles, /\.resource-browser-screen \.folders-directory-title/u);
  assert.match(text, /Network share folder actions/u);
  assert.match(text, /Add this folder to Library/u);
  assert.match(text, /In Library/u);
  assert.match(text, /Covered/u);
  assert.match(text, /libraryCoverage/u);
  assert.match(text, /addLibrarySource/u);
  assert.match(
    styles,
    /\.folders-folder-card__art-button[\s\S]*padding: var\(--space-2\) var\(--space-2\) 0/u,
  );
  assert.doesNotMatch(text, /Favorite|Playlist|History|Most Played/u);
});

void test("SMB Library Sources remain distinct from live Network Shares", async () => {
  const [sources, folders, api] = await Promise.all([
    source("screens/sources.ts"),
    source("screens/folders.ts"),
    source("api/smb-api-client.ts"),
  ]);
  assert.match(sources, /typeLabel: "SMB"/u);
  assert.match(sources, /Indexed folder on a network share/u);
  assert.match(sources, /iconName: "ethernet"/u);
  assert.match(folders, /SMB Library folder/u);
  assert.match(folders, /source\.type === "smb"/u);
  assert.match(folders, /target\.iconName !== "ethernet"/u);
  assert.match(api, /library-coverage/u);
  assert.match(api, /library-sources/u);
  assert.doesNotMatch(api, /nativeRoot|canonicalRoot|credentialReference/u);
});

void test("SMB dialog uses canonical visible auth and keyboard-aware regions", async () => {
  const [text, styles, adapter] = await Promise.all([
    source("screens/sources.ts"),
    source("styles/screens.css"),
    source("components/eidetic-keyboard-adapter.ts"),
  ]);
  assert.match(text, /smb-dialog__header/u);
  assert.match(text, /smb-dialog__body/u);
  assert.match(text, /smb-dialog__footer/u);
  assert.match(text, /smb-dialog__auth-choice--selected/u);
  assert.match(
    text,
    /button\.classList\.toggle\([\s\S]*"smb-dialog__auth-choice--selected"/u,
  );
  assert.match(text, /field\.hidden = mode === "guest"/u);
  assert.match(text, /smbPassword\.value = ""/u);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u);
  assert.match(styles, /\.smb-dialog__body[\s\S]*overflow-y: visible/u);
  assert.match(styles, /\.smb-dialog__auth-choices[\s\S]*justify-self: end/u);
  assert.match(
    styles,
    /\.smb-dialog__footer[\s\S]*margin-top: var\(--space-3\)/u,
  );
  assert.match(
    styles,
    /data-keyboard-open="true"\] \.smb-dialog__body[\s\S]*overflow-y: auto/u,
  );
  assert.match(styles, /\.app-root\[data-keyboard-open="true"\] \.smb-dialog/u);
  assert.match(styles, /--eidetic-keyboard-height/u);
  assert.match(adapter, /--eidetic-keyboard-height/u);
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

void test("Library Source cards keep Open in overflow and settle after scans", async () => {
  const text = await source("screens/sources.ts");
  assert.doesNotMatch(text, /data-source-action="open"/u);
  assert.match(text, /action: "open"[\s\S]*label: t\("sources\.open"\)/u);
  assert.match(text, /if \(action === "open"\)[\s\S]*options\.openSource/u);
  assert.match(
    text,
    /const availability =[\s\S]*source\?\.availability === "available"[\s\S]*status\.dataset\.availability = availability/u,
  );
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
