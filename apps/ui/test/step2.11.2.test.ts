import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string): Promise<string> => readFile(path, "utf8");

void test("USB safe removal controls stay scoped to Sources and browser header", async () => {
  const [sources, usb, folders, styles, api, mainPlayer, queue] =
    await Promise.all([
      read("apps/ui/src/screens/sources.ts"),
      read("apps/ui/src/screens/usb-storage.ts"),
      read("apps/ui/src/screens/folders.ts"),
      read("apps/ui/src/styles/screens.css"),
      read("apps/ui/src/api/removable-storage-api-client.ts"),
      read("apps/ui/src/main-player/main-player-host.ts"),
      read("apps/ui/src/components/queue-drawer.ts"),
    ]);
  assert.match(sources, /device\.capabilities\.canMount/);
  assert.match(sources, /device\.capabilities\.canSafelyRemove/);
  assert.match(sources, /Safely remove USB storage\?/);
  assert.match(sources, /usage\.inUse/);
  assert.match(usb, /usb-directory-safe-remove/);
  assert.match(usb, /Safely remove/);
  assert.match(usb, /All mounted volumes on this device will be removed\./);
  assert.match(usb, /setTitle\(`USB \/ \$\{options\.device\.displayName\}`\)/);
  assert.match(usb, /setTitle\(`USB \/ \$\{device\.displayName\}`\)/);
  assert.match(usb, /includeCurrentBreadcrumb: true/);
  assert.match(usb, /breadcrumbRootLabel: "Root"/);
  assert.match(
    styles,
    /\.resource-browser-screen \.folders-directory-header__primary/,
  );
  assert.match(styles, /grid-template-areas: "back actions"/);
  assert.match(
    styles,
    /\.resource-browser-screen \.folders-directory-title \{\s*display: none/,
  );
  assert.match(
    styles,
    /\.resource-browser-screen \.folders-directory-actions \{[\s\S]*justify-self: end;[\s\S]*justify-content: flex-end;/,
  );
  assert.match(
    styles,
    /\.resource-browser-screen \.folders-breadcrumbs__current/,
  );
  assert.match(folders, /button:not\(\.folders-back\)/);
  assert.match(api, /\/safe-remove/);
  assert.match(api, /\/mount/);
  assert.doesNotMatch(mainPlayer, /Safely remove|Mounting/);
  assert.doesNotMatch(queue, /Safely remove|Mounting/);
});

void test("platform adapters are bounded, non-interactive and never force", async () => {
  const [windows, linux, provider, service, index] = await Promise.all([
    read(
      "apps/backend/src/removable-storage/windows-removable-media-adapter.ts",
    ),
    read("apps/backend/src/removable-storage/linux-removable-media-adapter.ts"),
    read(
      "apps/backend/src/removable-storage/windows-removable-storage-provider.ts",
    ),
    read("apps/backend/src/removable-storage/removable-storage-service.ts"),
    read("apps/backend/src/index.ts"),
  ]);
  assert.match(windows, /CM_Request_Device_EjectW/);
  assert.match(windows, /CM_Get_Parent/);
  assert.match(windows, /EIDETIC_REMOVABLE_DEVICE_ID_BASE64/);
  assert.match(windows, /error\.killed === true/);
  assert.match(windows, /"-NonInteractive"/);
  assert.match(windows, /timeout: 15_000/);
  assert.match(provider, /PNPDeviceID/);
  assert.match(linux, /"--no-user-interaction"/);
  assert.match(linux, /"power-off"/);
  assert.doesNotMatch(linux, /\bsudo\b|--force|["']-f["']/);
  assert.doesNotMatch(windows, /Remove-PartitionAccessPath|Stop-Process/);
  assert.match(service, /activeOperations/);
  assert.match(service, /operationReference/);
  assert.match(index, /prepareRemoval/);
  assert.match(index, /setFolderSourceAvailable/);
});
