import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");
const normalize = (source: string) => source.replace(/\r\n/g, "\n");
const contains = (source: string, needle: string, message: string) => {
  assert.ok(source.includes(needle), `${message}: missing ${needle}`);
};

const sectionBetween = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  if (start < 0) {
    return "";
  }
  const end = source.indexOf(to, start + from.length);
  return end < 0 ? source.slice(start) : source.slice(start, end);
};

void test("Neutralino generator reads explicit borderless environment", async () => {
  const [generator, installer] = await Promise.all([
    read("scripts/generate-neutralino-config.ts"),
    read("deploy/linux/install-eidetic-player.sh"),
  ]);

  assert.match(
    generator,
    /borderless:\s*process\.env\.EIDETIC_BORDERLESS\s*===\s*"1"/,
  );
  contains(
    installer,
    'EIDETIC_BORDERLESS="$borderless_value"',
    "installer borderless runtime env",
  );
  assert.doesNotMatch(
    installer,
    /EIDETIC_BORDERLESS=.*\$\{EIDETIC_BORDERLESS:-1\}/,
  );
});

void test("Installer propagates borderless through install runtime build environment", async () => {
  const [installer, common] = await Promise.all([
    read("deploy/linux/install-eidetic-player.sh"),
    read("deploy/linux/lib/common.sh"),
  ]);

  assert.match(installer, /--borderless (yes|no)/);
  contains(
    installer,
    'EIDETIC_BORDERLESS="$borderless_value"',
    "installer borderless export",
  );
  assert.match(common, /EIDETIC_BORDERLESS="\$\{EIDETIC_BORDERLESS:-0\}"/);
});

void test("Update delegates to installer with explicit borderless flag", async () => {
  const update = await read("deploy/linux/update-eidetic-player.sh");

  contains(
    update,
    '"$bootstrap_installer" "${args[@]}"',
    "delegated installer command",
  );
  contains(
    update,
    'bootstrap_installer="$bootstrap_workspace/source/deploy/linux/install-eidetic-player.sh"',
    "installed release bootstrap checkout",
  );
  contains(
    update,
    '--borderless "$(choice_to_flag "$borderless")"',
    "delegated borderless flag",
  );
  assert.doesNotMatch(
    update,
    /EIDETIC_BORDERLESS="\$\{EIDETIC_BORDERLESS:-1\}"/,
  );
});

void test("Update normalizes legacy and preserves appliance semantics", async () => {
  const source = normalize(await read("deploy/linux/update-eidetic-player.sh"));

  contains(
    source,
    'mode="${EIDETIC_INSTALLATION_MODE:-standard}"',
    "default mode",
  );
  assert.match(source, /if \[\[ "\$mode" != "appliance" \]\]; then/);
  contains(source, "mode=standard", "legacy standard normalization");

  const standardSection = sectionBetween(
    source,
    'if [[ "$mode" == "standard" ]]; then',
    "else",
  );
  contains(standardSection, "autostart=0", "standard takeover");
  contains(standardSection, "fullscreen=0", "standard takeover");
  contains(standardSection, "borderless=0", "standard takeover");
  contains(standardSection, "blanking=0", "standard takeover");
  contains(standardSection, "pointer=0", "standard takeover");
  contains(standardSection, "splash=0", "standard takeover");
  contains(standardSection, "autologin=0", "standard takeover");

  const applianceSection = sectionBetween(
    source,
    'else\n  autostart="${EIDETIC_AUTOSTART:-0}"',
    "fi",
  );
  contains(
    applianceSection,
    'if [[ "${EIDETIC_BORDERLESS+x}" == x ]]; then',
    "legacy borderless fallback",
  );
  contains(
    applianceSection,
    'borderless="${EIDETIC_BORDERLESS}"',
    "legacy borderless env",
  );
  contains(applianceSection, "borderless=1", "legacy borderless fallback");

  contains(
    source,
    '--fullscreen "$(choice_to_flag "$fullscreen")"',
    "update fullscreen flag",
  );
  contains(
    source,
    '--disable-blanking "$(choice_to_flag "$blanking")"',
    "update blanking flag",
  );
  contains(
    source,
    '--hide-pointer "$(choice_to_flag "$pointer")"',
    "update pointer flag",
  );
  contains(
    source,
    '--splash "$(choice_to_flag "$splash")"',
    "update splash flag",
  );
  contains(
    source,
    '--autologin "$(choice_to_flag "$autologin")"',
    "update autologin flag",
  );
  contains(
    source,
    '--borderless "$(choice_to_flag "$borderless")"',
    "update borderless flag",
  );
});

void test("Installer keeps standard choices off and adds borderless appliance option", async () => {
  const source = normalize(
    await read("deploy/linux/install-eidetic-player.sh"),
  );

  assert.match(
    source,
    /questions=\(autostart fullscreen borderless blanking pointer splash autologin\)/,
  );

  const standardSection = sectionBetween(
    source,
    'if [[ "$mode" == "standard" ]]; then',
    "else",
  );
  assert.match(standardSection, /for key in "\${questions\[@\]}"; do/);
  contains(standardSection, 'choice["$key"]=no', "standard default choices");

  assert.ok(
    !/choice\["(fullscreen|blanking|borderless|autostart|pointer|splash|autologin)"\]=yes/.test(
      source,
    ),
    "no takeover default override to yes",
  );

  assert.match(
    source,
    /case "\$1" in\n\s*borderless\)\n\s*printf '%s' 'Run Eidetic Player without window borders\?'/,
  );
  contains(
    source,
    'eidetic_prompt_yes_no "$(install_question_prompt "$key")" no',
    "appliance prompt path",
  );
  contains(source, 'choice["$key"]=no', "appliance loop defaults");
});

void test("Installer no longer uses fragile borderless text replacement", async () => {
  const source = await read("deploy/linux/install-eidetic-player.sh");
  assert.doesNotMatch(source, /sed -i\s+.*borderless: false,/);
  assert.doesNotMatch(source, /grep -q 'borderless: true,/);
});
