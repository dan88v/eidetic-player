import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

void test("Neutralino generator reads explicit borderless environment", async () => {
  const [generator, installer] = await Promise.all([
    read("scripts/generate-neutralino-config.ts"),
    read("deploy/linux/install-eidetic-player.sh"),
  ]);

  assert.match(
    generator,
    /borderless:\s*process\.env\.EIDETIC_BORDERLESS\s*===\s*"1"/,
  );
  assert.match(installer, /EIDETIC_BORDERLESS=.*\${EIDETIC_BORDERLESS:-1}/);
});

void test("Installer propagates borderless through install runtime build environment", async () => {
  const [installer, common] = await Promise.all([
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/lib/common.sh"),
  ]);

  assert.match(installer, /EIDETIC_BORDERLESS=\$\{EIDETIC_BORDERLESS:-1\}/);
  assert.match(installer, /EIDETIC_BORDERLESS=\$EIDETIC_BORDERLESS/);
  assert.match(common, /EIDETIC_BORDERLESS="\$\{EIDETIC_BORDERLESS:-0\}"/);
});

void test("Update continues to delegate to installer without a new borderless flag", async () => {
  const [update, installer] = await Promise.all([
    read("deploy/linux/update-eidetic-player.sh"),
    read("deploy/linux/install-eidetic-player.sh"),
  ]);

  assert.match(update, /install-eidetic-player\.sh" "\$\{args\[@\]\}"/);
  assert.doesNotMatch(update, /--borderless/);
  assert.match(update, /EIDETIC_BORDERLESS="\$\{EIDETIC_BORDERLESS:-1\}"/);
  assert.match(installer, /EIDETIC_BORDERLESS=\$\{EIDETIC_BORDERLESS:-1\}/);
});

void test("Installer no longer uses fragile borderless text replacement", async () => {
  const source = await read("deploy/linux/install-eidetic-player.sh");
  assert.doesNotMatch(source, /sed -i\s+.*borderless: false,/);
  assert.doesNotMatch(source, /grep -q 'borderless: true,/);
});

void test("Installer records and reuses baseline Standard/Appliance install settings", async () => {
  const installer = await read("deploy/linux/install-eidetic-player.sh");

  assert.match(installer, /for key in "\${questions\[@\]}"; do/);
  assert.match(installer, /choice\["\$key"\]=no/);
  assert.match(installer, /choice\["fullscreen"\]=yes/);
  assert.match(installer, /choice\["blanking"\]=yes/);
  assert.match(installer, /EIDETIC_BORDERLESS=\$EIDETIC_BORDERLESS/);
  assert.match(installer, /EIDETIC_BORDERLESS=\$\{EIDETIC_BORDERLESS:-1\}/);
});
