# Step 2.13.2-R4C — Linux installer non-regression and executable-mode audit

## Decision

Completamento auditato con `no code change` (nessuna modifica applicativa).

Il percorso installer esistente è stato verificato secondo baseline e controlli richiesti.
Nessuna discrepanza concreta riproducibile nel repository richiede una correzione.

## Baseline git

- `git branch --show-current` → `main`
- `git status --short` → pulito
- `git fetch --prune origin` → eseguito
- `git rev-list --left-right --count HEAD...origin/main` → `0 0`
- `git log -5 --oneline` letto
- `git diff --check` → nessun problema prima delle azioni
- `git ls-files -s deploy/linux` letto completamente

## Modalità file sotto `deploy/linux`

- File eseguibili tracciati rilevati: 19.
- Tutti i file direttamente invocabili (install/update/uninstall/doctor, runtime e test shell) risultano `100755` nel repo:
  - `deploy/linux/doctor-installation.sh`
  - `deploy/linux/install-eidetic-player.sh`
  - `deploy/linux/lib/common.sh`
  - `deploy/linux/network/install-network-integration.sh`
  - `deploy/linux/network/uninstall-network-integration.sh`
  - `deploy/linux/restore-system-ui.sh`
  - `deploy/linux/runtime/eidetic-player`
  - `deploy/linux/runtime/eidetic-player-display-policy`
  - `deploy/linux/runtime/eidetic-player-launch`
  - `deploy/linux/runtime/eidetic-player-maintenance`
  - `deploy/linux/runtime/eidetic-player-resume`
  - `deploy/linux/runtime/eidetic-player-smb-helper`
  - `deploy/linux/test-case-sensitive-wsl.sh`
  - `deploy/linux/test-platform-detection.sh`
  - `deploy/linux/test-rpi-keyboard.sh`
  - `deploy/linux/test-staging.sh`
  - `deploy/linux/test-unprivileged-build.sh`
  - `deploy/linux/uninstall-eidetic-player.sh`
  - `deploy/linux/update-eidetic-player.sh`
- Nessun file dati/template/config non deve essere eseguibile e risulta 100644.

## Audit mode/script integrity

### bash/shell check

- `bash -n` su tutti i file eseguibili in `deploy/linux`: superato.
- `shellcheck` non disponibile nell'ambiente corrente; rilevato come `shellcheck unavailable`.

## Standard mode audit

- `install-eidetic-player.sh`:
  - `questions=(autostart fullscreen blanking pointer splash autologin)`
  - in modalità standard tutte le chiavi sono forzate a `no`, poi override a:
    - `fullscreen=yes`, `blanking=yes`
  - `rpi-onscreen-keyboard` rimane `keep`
  - nessun flag desktop-specific oltre quelli già documentati.
- `install.conf` scritto da `install` con chiavi:
  - `EIDETIC_INSTALLATION_MODE`
  - `EIDETIC_FULLSCREEN`
  - `EIDETIC_BORDERLESS`
  - `EIDETIC_HIDE_POINTER`
  - `EIDETIC_DISABLE_BLANKING`
  - `EIDETIC_AUTOSTART`
  - `EIDETIC_SPLASH`
  - `EIDETIC_AUTOLOGIN`
  - `EIDETIC_RUNTIME_USER`
  - `EIDETIC_GIT_REF`
  - `EIDETIC_RPI_ONSCREEN_KEYBOARD`
  - `EIDETIC_TERMINAL`
  - `EIDETIC_MPV_PATH`
- `deploy/linux/README.md` conferma `Standard` come installazione non intrusiva
  (no autostart/fullscreen/bordering/pointer/autologin/splash/keyboard disable forzati).

## Appliance mode audit

- In assenza di `--unattended` ogni scelta appliance chiede input interattivo.
- `--unattended` richiede tutte le opzioni chiave esplicitamente.
- `appliance` propaga gli stessi flag allo `update` e al `restore`/`uninstall` path.
- Nessun flag `panel` ora presente; quindi nessuna evidenza di discrepanza da correggere nello standard richiesto.
- In questa step l’opzione di pannello resta come da stato R4B/precedenti.

## Packaging + binaries

- `install` costruisce:
  - `apps/backend/src/index.js`
  - binary Neutralino scelto da `node_platform` (`linux-arm64` o `linux-x64`)
  - `package.json`
  - `package-lock.json`
  - `node_modules` production in release via `npm ci --omit=dev`
- `doctor-installation` verifica:
  - symlink `current`
  - eseguibili node/neutralino
  - strumenti/servizi manutenzione e manifest

## Systemd, autostart, maintenance/resume

- `install` installa manifest e componenti:
  - `/etc/systemd/user/eidetic-player.service`
  - `/usr/share/applications/eidetic-player.desktop`
  - `/usr/local/bin/eidetic-player-maintenance`
  - `/usr/local/bin/eidetic-player-resume`
  - `/usr/local/bin/eidetic-player-display-policy`
- `update` riutilizza install con i valori correnti dal `install.conf`.
- `restore-system-ui.sh` e `uninstall-eidetic-player.sh` mantengono modalità `--dry-run` e ripristino idempotente del manifest.

## Documentazione

- `deploy/linux/README.md` allineato alle opzioni installatore presenti (`--unattended`,
  `--mode`, `--autostart`, `--fullscreen`, `--disable-blanking`, `--hide-pointer`,
  `--splash`, `--autologin`, `--rpi-onscreen-keyboard`) e al flusso
  Standard/Appliance descritto.
- Nessuna modifica documentale richiesta a questa audit step.

## Test e verifiche eseguite

### Comandi eseguiti e risultati

- `bash -n` (file eseguibili Linux): OK
- `npm.cmd run format:check`: `format:1` (fallito a causa di file markdown non conforme nel workspace, già presente)
- `npm.cmd run typecheck`: OK
- `npm.cmd run lint`: OK
- `npm.cmd run build`: OK
- `npm.cmd test`: OK (436/433 pass, 3 skip)
- `npm.cmd run test:posix`: OK (3/3 pass, 2 skip)
- `npm.cmd run verify:network:deployment`: OK
- `npm.cmd run dev`: avviato in background, listener su `5173` e `4310` osservati;
  processo concluso/interrotto per chiusura pulita manuale.
- `bash deploy/linux/test-staging.sh "$USERNAME"`: parziale, fallisce su controllo utente runtime (`runtime user does not exist`).
- `bash deploy/linux/test-staging.sh root`: fallisce per vincolo `runtime user must not be root`.

### Stato finale di test

- Non eseguite con successo tutte le varianti di staging Raspberry Pi/Ubuntu Appliance/Standard su questa macchina, perché manca un runtime user Linux non-root
  disponibile nel contesto della prova (`dan88` non risolto lato bash).
- Nessun fix speculativo applicato.

## Discrepanze/decisioni

- Nessuna discrepanza concreta che richieda `DECISION REQUIRED` sulla pipeline applicativa corrente.
- `HARDWARE VALIDATION REQUIRED`: verifica completa di staging/maintenance/resume e scenari Raspberry Pi reali resta da eseguire su host Linux reale (utente runtime non-root).

## Rischi evitati

- Nessuna modifica ai percorsi esistenti non necessaria.
- Nessuna alterazione di `installer`, `update`, `restore`, `uninstall` in assenza di difetto riprodotto.
- Nessun uso di workaround distruttivi, polling non autorizzato, `killall/pkill`, workaround speculative.

## File modificati

- `prompts/step2.13.2_r4c_output.md` (nuovo report)

## Comandi finali richiesti

- `git status --short`
- `git diff --stat`
- `git diff --check`

`git diff --stat`: mostra solo il report appena creato.
