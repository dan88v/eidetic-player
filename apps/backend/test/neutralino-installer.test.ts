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
  assert.match(
    installer,
    /EIDETIC_BORDERLESS=\$\(\[\[ "\$\{choice\[borderless\]\}" == yes \]\] && printf 1 \|\| printf 0\)/,
  );
  assert.doesNotMatch(installer, /EIDETIC_BORDERLESS=.*\$\{EIDETIC_BORDERLESS:-1\}/);
});

void test("Installer propagates borderless through install runtime build environment", async () => {
  const [installer, common] = await Promise.all([
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/lib/common.sh"),
  ]);

  assert.match(installer, /--borderless (yes|no)/);
  assert.match(installer, /EIDETIC_BORDERLESS=\$\(\[\[ "\$\{choice\[borderless\]\}" == yes/);
  assert.match(common, /EIDETIC_BORDERLESS="\$\{EIDETIC_BORDERLESS:-0\}"/);
});

void test("Update delegates to installer with explicit borderless flag", async () => {
  const [update, installer] = await Promise.all([
    read("deploy/linux/update-eidetic-player.sh"),
    read("deploy/linux/install-eidetic-player.sh"),
  ]);

  assert.match(update, /install-eidetic-player\.sh" "\$\{args\[@\]\}"/);
  assert.match(update, /--borderless "\$\(choice_to_flag \"\$borderless\"\)"/);
  assert.doesNotMatch(update, /EIDETIC_BORDERLESS="\$\{EIDETIC_BORDERLESS:-1\}"/);
  assert.match(installer, /--borderless (yes|no)/);
});

void test("Update normalizes legacy and preserves appliance semantics", async () => {
  const update = await read("deploy/linux/update-eidetic-player.sh");

  assert.match(update, /mode="\$EIDETIC_INSTALLATION_MODE"/);
  assert.match(update, /if \[\[ "\$mode" != "appliance" \]\]; then/);
  assert.match(update, /--fullscreen "\$\(choice_to_flag \"\$fullscreen\"\)"/);
  assert.match(update, /--autologin "\$\(choice_to_flag \"\$autologin\"\)"/);
  assert.match(update, /if \[\[ "\$mode" == "standard" \]\]/);
});

void test("Installer keeps standard choices off and adds borderless appliance option", async () => {
  const installer = await read("deploy/linux/install-eidetic-player.sh");

  assert.match(installer, /questions=\(autostart fullscreen borderless blanking pointer splash autologin\)/);
  assert.match(installer, /choice\["fullscreen"\]=no/);
  assert.match(installer, /choice\["blanking"\]=no/);
  assert.match(installer, /choice\["borderless"\]=no/);
  assert.match(installer, /Run Eidetic Player without window borders\? \[y\/N\]/);
  assert.doesNotMatch(installer, /choice\["fullscreen"\]=yes/);
  assert.doesNotMatch(installer, /choice\["blanking"\]=yes/);
});

void test("Installer no longer uses fragile borderless text replacement", async () => {
  const source = await read("deploy/linux/install-eidetic-player.sh");
  assert.doesNotMatch(source, /sed -i\s+.*borderless: false,/);
  assert.doesNotMatch(source, /grep -q 'borderless: true,/);
});
