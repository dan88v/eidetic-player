# Step 2.13.2-R4B — Raspberry Pi OS panel hiding (OPTIONAL)

## Decision

`BLOCKED — TARGET SESSION NOT PROVEN`

La sessione desktop/pannello Raspberry Pi OS non è determinabile con certezza dal codice/fixture disponibili nel repository, quindi non viene implementata una logica di hide/show del pannello. Viene mantenuto intatto il percorso standard e non viene alterata la compatibilità esistente.

## Baseline (eseguita prima di qualsiasi modifica)

- `git branch --show-current` → `main`
- `git status --short` → working tree pulito
- `git fetch --prune origin` → completato
- `git rev-list --left-right --count HEAD...origin/main` → `0 0`
- `git log -5 --oneline` esaminato
- `git diff --check` nessun problema di whitespace o merge marker

## Evidenze verificate nel repository

- `AGENTS.md` letto (requisiti architetturali e workflow)
- `deploy/linux/lib/common.sh`
- `deploy/linux/install-eidetic-player.sh`
- `deploy/linux/update-eidetic-player.sh`
- `deploy/linux/uninstall-eidetic-player.sh`
- `deploy/linux/restore-system-ui.sh`
- `deploy/linux/runtime/eidetic-player-maintenance`
- `deploy/linux/runtime/eidetic-player-resume`
- `deploy/linux/runtime/eidetic-player-display-policy`
- `deploy/linux/templates/*`
- `apps/backend/test/linux-installation.test.ts`
- `deploy/linux/test-platform-detection.sh`
- `deploy/linux/test-rpi-keyboard.sh`
- `deploy/linux/test-staging.sh`
- `deploy/linux/README.md`
- `deploy/linux/doctor-installation.sh`

## Esito della verifica sessione/pannello

- Confermata la presenza di gestione già valida e robusta per `rpi_keyboard` e restore tramite manifest.
- Nessuna evidenza verificabile nel repo su:
  - nome sessione desktop deterministico del Raspberry Pi OS da usare per panel hide/show;
  - panel effettivamente in uso e percorso di configurazione comprovato;
  - metodo reversibile di hide/show basato su file/drop-in allowlist con backup originale;
  - test/fixture che coprano restore/maintenance/resume con questo caso d’uso;
  - metodo idempotente e non intrusivo equivalente a quello già approvato per la tastiera.
- Non sono disponibili dati sufficienti per identificare in modo certo sessione/pannello; implementare ora comporterebbe supposizioni non consentite.

## Stato rispetto ai requisiti chiave

- Opzione installer: **non aggiunta** (`--hide-desktop-panel`) in assenza di prova tecnica certa.
- Default `hide desktop panel = no`: mantenuto, nessuna modifica al flusso esistente.
- Installer/Build/Services/maintenance/restore/uninstall con opzione no: invariati.
- Compatibilità unattended: mantenuta (nessun cambiamento delle opzioni esistenti).
- Ubuntu: nessuna alterazione introdotta.
- MPV/backend/frontend/packaging: non toccati.

## Cosa sarebbe stato necessario prima di implementare

Necessarie conferme tecniche dal Raspberry Pi reale:

1. Sessione desktop corrente (`echo $XDG_CURRENT_DESKTOP`, `loginctl`, `ps e.g., lswc` se pertinente) con mapping a ambiente provato.
2. Identificazione del pannello attivo (es. file/service di autostart/sessione specifica dell’installazione Raspberry Pi OS Trixie target).
3. Posizione file/drop-in deterministica + proprietà/permessi + stato preesistente registrabile in manifest.
4. Metodo hide/show reversibile comprovabile con prova pratiche `install -> maintenance -> resume -> restore -> uninstall`.
5. Conferma che il flusso non impatti non-Pi o ambienti non supportati.

## Proposta di diagnostica da eseguire su Raspberry Pi reale (read-only se possibile)

- `lsb_release -a`
- `echo "$XDG_SESSION_DESKTOP $XDG_CURRENT_DESKTOP $DESKTOP_SESSION $XDG_SESSION_TYPE"`
- `ps -eo pid,comm,args | rg -i 'openbox|mate-session|lxsession|wayfire|labwc|openbox|mutter|gnome-shell'`
- `find "$HOME" -maxdepth 4 -path '*autostart*' -o -path '*systemd/user*' | rg -i 'panel|lxpanel|wayfire|labwc|taskbar'`
- `ls -la "$HOME/.config/autostart"`, `ls -la "$HOME/.config/autostart --color=never"`
- `ls -la "$XDG_CONFIG_HOME" "$HOME/.config" | rg -i 'rpi|panel|desktop|wayfire|openbox|openbox'`
- `find /var/lib/systemd /etc/xdg /usr/share/xsessions /usr/share/wayland-sessions -maxdepth 4 -type f | rg -i 'pi|rpi|desktop|session|wayfire|labwc|openbox|xsession'`
- `grep -R --line-number --exclude-dir=.git -i 'panel' /etc/xdg /usr/share /usr/local/share 2>/dev/null | head`
- `systemctl --user list-unit-files --type=service | rg -i 'lxsession|panel|autostart|x11|wayland|eidetic'`
- `journalctl -u eidetic-player -n 80 --no-pager`
- `rg -n --glob 'linux/install*' --glob 'linux/README.md' --glob 'linux/doctor-installation.sh' 'rpi_keyboard|display-policy|appliance|autologin|restore-system-ui|install.conf|panel'`

## File modificati

- Nessun file applicativo modificato.
- Aggiunto solo questo report.

## Prove eseguite

Per questa decisione:
- Non sono stati eseguiti build/test del codice applicativo, poiché non è stato applicato alcun cambio funzionale.
- Nessun test aggiuntivo da aggiornare per assenza di implementazione.
- Nessun commit/push effettuato.

## Comandi finali (richiesti)

- `git status --short`
- `git diff --stat`
- `git diff --check`

`git diff --stat` su questo step: (nessuna modifica applicativa)

`git status --short`: nessuna modifica tranne questo nuovo report

## Rischi evitati

- Evitata introduzione di logica non verificata su sessione/processi desktop.
- Evitato il rischio di regressione installer su Raspberry Pi e pipeline unattended.
- Evitata modifica distruttiva o non reversibile di comandi desktop non target.

## Note finali

- `Raspberry Pi reale non testato`.
- `BLOCKED — TARGET SESSION NOT PROVEN` conforme alle istruzioni fornite.
- Nessun commit creato.
