# Step 2.14.2B — Linux power helper, Polkit integration and real capabilities

## Esito

Implementazione locale completata per i tre percorsi Power separati:

- Quit frontend-owned tramite `Neutralino.app.exit()`;
- Restart Eidetic Player user-level tramite il servizio systemd utente;
- reboot/shutdown tramite helper root-owned, `pkexec` e policy Polkit dedicata.

La UI autoritativa dello Step 2.14.2A non è stata ridisegnata. Nessun comando
distruttivo è stato eseguito. Nessun commit o push è stato eseguito.

Stato locale: `READY FOR CI VALIDATION`.

## Baseline

- branch: `main`;
- working tree iniziale: pulito;
- HEAD e `origin/main`:
  `fdb0e80f4b0aeea4d8220f7b66f648ece705caa7`;
- divergenza: `0 0`;
- nessun merge/rebase;
- Step 2.14.2A presente e committato;
- GitHub Actions `Eidetic Player CI` run `30199259468`, numero `#57`:
  `success`;
- job Linux checks: tutti gli step `success`;
- `git diff --check`: PASS iniziale.

Baseline Windows reale:

- `C:\Tools\mpv\mpv.exe`: disponibile;
- backend `127.0.0.1:4310`: PASS;
- Vite `127.0.0.1:5173`: PASS;
- Neutralino/WebView2: PASS;
- MPV reale: PASS;
- sessione v2 ripristinata, Queue 5/5, traccia corrente in pausa;
- matrice Development iniziale: solo `quit`;
- Power menu reale: solo Quit Eidetic Player;
- Quit reale: Neutralino code 0, backend SIGTERM;
- restart dev: sessione 5/5 ripristinata;
- cleanup: nessun processo o listener residuo.

## Audit

Sono stati verificati:

- contratto condiviso e `PowerActionCoordinator`;
- bootstrap, capabilities ed endpoint Power/legacy Maintenance;
- flush sessione v2;
- launcher e servizio systemd utente;
- Maintenance/Resume;
- installer, update, rollback, restore, uninstall e doctor;
- managed-file manifest e backup originali;
- staging Standard/Appliance;
- executable-mode e release verifier;
- helper SMB e relativa policy come riferimento.

Path fissi preesistenti rilevanti:

- `/usr/bin/systemctl`;
- `/usr/bin/pkexec`;
- `/usr/local/bin/eidetic-player-maintenance`;
- `/etc/systemd/user/eidetic-player.service`;
- `/usr/libexec/eidetic-player-smb-helper`.

Il manifest `system-ui-manifest-v1.tsv` registra originale, mode, ownership e
SHA-256. Update delega all'installer; rollback scambia soltanto
`current`/`previous`; uninstall usa restore e conserva i dati XDG.

## Architettura helper e Polkit

I percorsi restano indipendenti.

Quit:

- nessun helper;
- nessun privilegio;
- backend flush prima dell'accettazione;
- chiusura frontend tramite PlatformBridge/Neutralino.

Restart app:

- executable fisso `/usr/bin/systemctl`;
- unit fissa `eidetic-player.service`;
- solo `--user`;
- nessun helper root e nessun Polkit.

Reboot/shutdown:

- executable fisso `/usr/bin/pkexec`;
- opzione fissa `--disable-internal-agent`;
- helper fisso `/usr/libexec/eidetic-player-power-helper`;
- policy exact-match;
- nessun `sudo`, shell dinamica, PATH lookup sensibile o input libero.

## Helper CLI

File sorgente:
`deploy/linux/runtime/eidetic-player-power-helper`

Contratto:

- shebang `#!/usr/bin/env bash`;
- `set -euo pipefail`;
- esattamente un argomento;
- azioni ammesse: `probe`, `reboot`, `shutdown`;
- root obbligatorio;
- `/usr/bin/systemctl` deve essere executable;
- `probe`: nessun side effect;
- `reboot`: `/usr/bin/systemctl --no-block reboot`;
- `shutdown`: `/usr/bin/systemctl --no-block poweroff`.

Exit:

- 0 successo;
- 64 uso/azione non valida;
- 69 systemctl non disponibile;
- 77 esecuzione non-root.

Zero/due argomenti, azione sconosciuta, `restart-app`, option injection e path
sono rifiutati. I mapping distruttivi sono verificati staticamente e tramite
adapter fake, mai eseguiti.

## Path, ownership e mode

Installazione:

- helper: `/usr/libexec/eidetic-player-power-helper`;
- ownership reale attesa: `root:root`;
- mode installato: `0755`;
- Git mode: `100755`;
- policy: `/etc/polkit-1/rules.d/49-eidetic-player-power.rules`;
- mode installato: `0644`;
- template Git mode: `100644`.

L'installer rifiuta symlink, mode errati, helper non root-owned sul target
reale, placeholder residui e `/usr/bin/pkexec` non executable prima
dell'attivazione della release.

## Policy exact-match

Template:
`deploy/linux/templates/eidetic-player-power.polkit.rules`

Placeholder unico: `__EIDETIC_RUNTIME_USER__`.

La rule autorizza soltanto:

- action ID `org.freedesktop.policykit.exec`;
- program `/usr/libexec/eidetic-player-power-helper`;
- utente runtime esatto validato dall'installer;
- subject locale e attivo.

Ogni mismatch restituisce `polkit.Result.NOT_HANDLED`. Non sono autorizzati
directory, wildcard, shell, systemctl, pkexec, utenti generici, `sudo`, `wheel`
o gruppi amministrativi. L'helper rivalida comunque l'azione.

## Package pkexec

Il piano APT include esplicitamente `pkexec` oltre a `polkitd`.

Fonti ufficiali verificate:

- Debian Trixie: il package `pkexec` fornisce `/usr/bin/pkexec`;
- Ubuntu 26.04 Resolute: package `pkexec` disponibile per amd64 e arm64;
- `polkitd` non garantisce da solo il binary.

L'installer reale verifica `[[ -x /usr/bin/pkexec ]]` subito dopo APT e di
nuovo prima dell'attivazione.

## Capability detection e matrici finali

Il frontend continua a renderizzare esclusivamente
`system.availablePowerActions`.

Development/Windows:

1. `quit`

Linux Standard senza integrazione completa:

1. `quit`

Linux Standard completa:

1. `quit`
2. `reboot`
3. `shutdown`

Linux Appliance senza helper/Polkit:

1. `restart-app`, soltanto se `/usr/bin/systemctl` è executable
2. `maintenance`

Linux Appliance completa:

1. `restart-app`
2. `maintenance`
3. `reboot`
4. `shutdown`

Appliance non contiene mai `quit`. Reboot/shutdown richiedono simultaneamente
pkexec executable, helper executable e policy leggibile. I dettagli host non
sono esposti nel bootstrap.

## Host adapter, probe e timing 202

L'adapter Linux separa:

- filesystem capability probe;
- execFile preflight;
- scheduling;
- spawn dell'azione.

Dipendenze sostituibili soltanto nei test:

- filesystem probe;
- execFile;
- spawn;
- scheduler.

Production usa esclusivamente path e argomenti costanti, `shell: false` e
nessun override environment dei path.

Sequenza:

1. body validato;
2. availability verificata;
3. coordinator bloccato;
4. sessione flushata;
5. preflight non distruttivo con timeout 2000 ms;
6. azione programmata a 200 ms;
7. endpoint restituisce 202;
8. callback avvia una sola azione.

Il probe device è:

```text
/usr/bin/pkexec
--disable-internal-agent
/usr/libexec/eidetic-player-power-helper
probe
```

Un errore preflight produce 503 `POWER_ACTION_FAILED` e messaggio pubblico
`The system action could not be started.`. Il log contiene soltanto action,
fase ed exit code sanitizzato. Il coordinator viene sbloccato solo per errori
prima del 202; dopo accettazione resta bloccato.

## Restart app

Preflight:

```text
/usr/bin/systemctl
--user
show
--property=LoadState
--value
eidetic-player.service
```

È accettato solo `loaded`.

Azione ritardata:

```text
/usr/bin/systemctl
--user
--no-block
restart
eidetic-player.service
```

Nessun privilegio root, Polkit, unit dinamica o argomento frontend. systemd
sostituisce il servizio e il launcher chiude backend/MPV tramite il normale
percorso SIGTERM.

## Maintenance compatibility

Maintenance resta:

- solo Appliance;
- non privilegiata;
- comando fisso `/usr/local/bin/eidetic-player-maintenance`;
- nessun argomento;
- preceduta dal flush;
- coordinata dallo stesso `PowerActionCoordinator`;
- compatibile con `POST /api/system/maintenance`.

Non è stata incorporata nell'helper root.

## Reboot e shutdown

Dopo probe riuscito vengono programmati rispettivamente:

```text
/usr/bin/pkexec --disable-internal-agent \
  /usr/libexec/eidetic-player-power-helper reboot
```

```text
/usr/bin/pkexec --disable-internal-agent \
  /usr/libexec/eidetic-player-power-helper shutdown
```

Nessun test ha eseguito questi comandi.

## Session flush e restore

Il formato sessione v2 resta invariato. Prima del preflight vengono salvati:

- Queue e stable IDs;
- current item;
- posizione;
- volume;
- mute;
- shuffle;
- repeat.

Il restore resta in pausa.

## Installer e lifecycle

Installer:

- aggiunge `pkexec` alla lista APT;
- genera la policy senza `eval` usando l'utente già validato;
- installa helper e policy tramite `eidetic_install_managed`;
- verifica pkexec, helper, rule, mode, ownership reale e placeholder;
- esegue soltanto il probe diretto non distruttivo sul target reale;
- attiva la release soltanto dopo le verifiche.

Update:

- delega all'installer;
- aggiorna helper e policy;
- non aggiunge flag persistenti;
- conserva dati e sessione.

Rollback:

- non builda e non testa;
- cambia soltanto `current`/`previous`;
- helper e policy restano installati;
- una release Step A non li rileva e non espone azioni Step B.

Restore system UI:

- resta idempotente;
- non rimuove helper/policy Power;
- conserva i relativi record nel manifest;
- non è uninstall.

Uninstall:

- include esplicitamente l'integrazione Power nel restore managed;
- ripristina originali, mode e ownership registrati;
- rimuove i file Eidetic quando non esistevano originali;
- è idempotente;
- non esegue azioni Power.

## Doctor

`doctor-installation.sh` controlla senza eseguire azioni:

- `/usr/bin/pkexec`;
- helper executable, non-symlink e mode;
- ownership root sul target reale;
- policy leggibile, non-symlink e mode;
- placeholder assente;
- `/usr/bin/systemctl`;
- capability attesa per Standard/Appliance.

JSON espone soltanto stati sintetici e non include username, contenuto policy,
stderr o environment.

## Staging

La matrice esistente non è stata ridotta. Le fixture ora controllano:

- Standard e Appliance;
- helper 0755;
- policy 0644;
- runtime user renderizzato;
- nessun nuovo flag in `install.conf`;
- install ripetuto;
- update e update `--full-verify`;
- rollback;
- restore ripetuto con integrazione Power preservata;
- uninstall ripetuto;
- ripristino di helper/policy preesistenti;
- rimozione senza originali;
- marker che fallisce se pkexec/systemctl fixture vengono eseguiti.

Linux root staging: `NOT RUN`.

Motivo: le distro WSL disponibili non hanno un runtime Node Linux; non sono
stati installati strumenti. In WSL Ubuntu sono passati `bash -n`, Git mode
100755 e il guard non-root reale per shutdown (exit 77).

ShellCheck: `NOT AVAILABLE` localmente.

## Test helper, Polkit, backend e UI

Helper:

- arity e azioni chiuse;
- exit 64 per input invalido;
- guard non-root exit 77 su Linux;
- path systemctl assoluto;
- mapping statici;
- assenza di sudo/eval/shell/PATH lookup.

Polkit:

- template renderizzato ed eseguito in sandbox JavaScript;
- exact action/program/user/local/active;
- shell, systemctl, pkexec, altri utenti/programmi rifiutati;
- nessuna wildcard o gruppo amministrativo.

Backend:

- tutte le matrici e ordine esatto;
- Appliance mai Quit;
- path/args fissi e `shell: false`;
- timeout preflight;
- probe prima della schedule;
- nessuno spawn prima del callback ritardato;
- una sola action;
- concorrenza bloccata;
- failure sanitizzata e coordinator sbloccato;
- Maintenance legacy preservata.

UI:

- render esclusivo da capabilities;
- matrici Development/Standard/Appliance;
- testi, conferme, overlay e footer Step A invariati;
- errore tramite `textContent`;
- progress non dismissibile e secondo input neutralizzato;
- touch scrolling protetto dai test esistenti.

## Windows real smoke

App reale Neutralino/WebView2 a 1280×800:

- backend, Vite e MPV reale: PASS;
- restore 5/5: PASS;
- Development mostra soltanto Quit: PASS;
- nessun pkexec/systemctl: PASS;
- payload Linux valido ma indisponibile: 409 senza side effect;
- payload con campo command: 400;
- Cancel, X, backdrop ed Escape: PASS;
- Power menu e footer visivamente invariati: PASS;
- Play/Pause: PASS;
- Previous/Next: PASS;
- Queue reorder via handle: revision 1 → 2, ordine modificato;
- ordine Queue originale ripristinato;
- Quit reale: code 0 e backend SIGTERM;
- riavvio: stessa Queue/current/settings, in pausa;
- listener 4310/5173 rimossi.

Touch scrolling e on-screen keyboard non sono stati modificati; sono coperti
dai test di non-regressione. Nessun reboot/shutdown Windows è stato tentato.

## Build Linux, release verifier e gate

Shell e mode:

- `bash -n` sui file richiesti: PASS su Windows/Git Bash e WSL Ubuntu;
- ShellCheck: NOT AVAILABLE localmente;
- helper zero/due argomenti, `restart-app` e option injection: exit 64;
- helper shutdown non-root in WSL: exit 77;
- `verify:linux:executables`: PASS, 35 file deploy verificati;
- helper Git mode 100755 e policy template 100644.

Build:

- `npm.cmd run build`: PASS;
- `npm.cmd run build:linux`: PASS;
- backend compilato presente;
- Neutralino artifact generato;
- helper e policy non inclusi nella release applicativa.

Release verifier:

- backend entrypoint: PASS;
- Neutralino x64 ed ELF header: PASS;
- configuration e UI build: PASS;
- resource archive e asset: PASS.

Matrice finale:

- `npm.cmd run format:check`: PASS;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS;
- `npm.cmd run build:linux`: PASS;
- `npm.cmd test`: PASS, 478 totali, 470 pass, 8 skip attesi;
- `npm.cmd run test:posix`: PASS, 3 pass, 2 skip platform-specific;
- `npm.cmd run verify:network:deployment`: PASS;
- `npm.cmd run verify:linux:executables`: PASS;
- `npm.cmd run verify:linux:installer`: PASS, install-safe 52 pass e 11
  skip platform-specific;
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`:
  PASS;
- `npm.cmd run mpv:doctor`: PASS con MPV reale;
- `npm.cmd run test:mpv`: PASS, 8/8;
- `git diff --check`: PASS;
- `git diff --cached --check`: PASS.

Linux root staging resta NOT RUN e non viene trasformato in un PASS.

## Diff

File applicativi:

- `apps/backend/src/index.ts`;
- `apps/backend/src/system/power-action-coordinator.ts`;
- nuovo `apps/backend/src/system/linux-power-adapter.ts`.

Deploy:

- helper e template Polkit nuovi;
- installer, doctor, restore, uninstall e staging;
- README Linux;
- executable-mode e installer-contract verifier.

Test:

- nuovo `apps/backend/test/linux-power-adapter.test.ts`;
- test system Power, installer Linux, UI Power e Linux verifier aggiornati.

Documentazione/report:

- architecture, Linux/Debian e testing;
- questo report.

Non sono cambiati workflow CI, package lock, frontend layout/CSS, Neutralino
config, Network, SMB, USB, MPV, visualizer, Library o Queue.

## Cleanup

- nessun Neutralino/backend/Vite/MPV/FFmpeg del progetto;
- nessun listener 4310/5173;
- nessun pkexec/systemctl;
- nessun terminale Maintenance;
- file media e dati XDG non modificati.

## Raspberry handoff

`RASPBERRY — NOT TESTED`

Dopo commit, push e nuovo CI verde, l'utente verificherà:

1. matrice Appliance senza Quit;
2. Restart Eidetic Player e restore completo;
3. Maintenance e ritorno;
4. Restart device, autostart e restore;
5. Shut down device come ultimo test, riaccensione e restore;
6. playback, touch, Queue reorder, OSK, USB, SMB e Network;
7. assenza di prompt Polkit/password.

Non è stato usato SSH e non è stato contattato il Raspberry.

## Git

Nessun commit, push, merge, rebase, reset, restore, stash o clean eseguito.
