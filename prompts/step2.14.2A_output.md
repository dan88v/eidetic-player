# Step 2.14.2A — Power menu UI, safe action contract and graceful preparation

## Esito

PASS su Windows per Power menu, contratto condiviso, validazione backend,
preparazione graceful, Quit reale, restore sessione, compatibilità Maintenance,
QA Neutralino/WebView2 e non-regressione installer.

Restart Eidetic Player, Restart device e Shut down device sono modellati e
testati tramite fixture, ma non sono disponibili né eseguiti nei runtime reali
di Step A. Raspberry Pi non testato. Nessun commit o push eseguito.

## Baseline

- Branch `main`, working tree iniziale pulito.
- HEAD `f2bb6df0a348593981fe16c7e4d1c0237a27e83e`, uguale a
  `origin/main` (`0 0`).
- Step 2.14.1 presente, nessun merge/rebase.
- Ultimo run `Eidetic Player CI` di `main`: run `30197372432`, stesso SHA,
  conclusione `success`.
- `git diff --check`: PASS.
- Baseline reale con `C:\Tools\mpv\mpv.exe`:
  - `mpv:doctor`: PASS;
  - backend 4310, Vite 5173, Neutralino/WebView2 e MPV reale: PASS;
  - sessione corrente con Queue di 5 elementi ripristinata;
  - Play/Pause: PASS;
  - drawer footer: solo testo `MODERN HI-FI`;
  - chiusura normale code 0, backend SIGTERM e porte liberate.

## Audit drawer/footer

`createSideMenu` è il proprietario del drawer. Prima dello step il footer era un
singolo elemento `.side-menu__footer` contenente `t("app.theme")`, il cui valore
è `MODERN HI-FI`. Il testo comunica il tema/identità visiva del prodotto; non è
un controllo e non è stato rinominato, reinterpretato o spostato verticalmente.

Il footer usa ora la stessa riga con:

- `MODERN HI-FI` invariato a sinistra;
- un solo pulsante iconico Power a destra;
- `aria-label="Power"` e `title="Power"`;
- target 48×48 px con `touch-action: manipulation`;
- margine verticale compensato, quindi nessuna nuova riga o crescita
  significativa del footer.

L'icona usa il sistema SVG tipizzato esistente.

## Modello condiviso e capabilities

Tipo chiuso `SystemPowerAction`:

1. `quit`
2. `restart-app`
3. `maintenance`
4. `reboot`
5. `shutdown`

`SystemCapabilities.availablePowerActions` è l'elenco autoritativo. Il frontend
renderizza esclusivamente tale elenco e non deduce disponibilità da sistema
operativo o installation mode.

Capabilities reali Step A:

- Development/Windows: `quit`;
- Linux Standard senza helper B: `quit`;
- Linux Appliance senza helper B: `maintenance`.

Fixture finali:

- Development: `quit`;
- Standard: `quit`, `reboot`, `shutdown`;
- Appliance: `restart-app`, `maintenance`, `reboot`, `shutdown`;
- Appliance non contiene `quit`.

Le fixture sono costanti tipizzate usate dai test, non sono attivabili tramite
environment e non modificano le capabilities production.

## API e sicurezza

Nuovo endpoint:

```text
POST /api/system/power
{"action":"quit|restart-app|maintenance|reboot|shutdown"}
```

La validazione accetta esclusivamente:

- body oggetto non-array;
- una sola proprietà `action`;
- stringa appartenente all'unione chiusa.

Campi extra, command, path, args, valori sconosciuti o payload malformati sono
rifiutati con `INVALID_POWER_ACTION` e status 400. Un'azione valida ma non
disponibile restituisce `ACTION_NOT_AVAILABLE`, status 409. Una seconda
richiesta accettabile durante un'azione restituisce `ACTION_IN_PROGRESS`,
status 409. Una richiesta accettata restituisce 202 senza dettagli host.

Non esistono command/path/argomenti liberi, shell, sudo, systemctl, reboot o
shutdown reali.

Smoke API reale:

- payload `shutdown` con campo `command`: 400 `INVALID_POWER_ACTION`;
- `shutdown` valido ma non disponibile: 409 `ACTION_NOT_AVAILABLE`;
- azione sconosciuta: 400 `INVALID_POWER_ACTION`;
- nessun side effect.

## Coordinator, persistenza e host adapter

`PowerActionCoordinator`:

1. verifica concorrenza;
2. verifica disponibilità;
3. blocca ulteriori azioni;
4. esegue `PlayerSessionService.flush()`;
5. invoca una sola volta l'adapter host.

Se il flush o l'adapter falliscono prima dell'avvio, lo stato torna disponibile
e l'adapter non viene invocato dopo un flush fallito. Dopo un'accettazione lo
stato non viene sbloccato da timeout frontend.

Il formato sessione esistente è stato evoluto atomicamente a versione 2, con
lettura compatibile della versione 1. Conserva:

- Queue e stable item IDs;
- current item;
- posizione;
- volume;
- mute;
- shuffle;
- repeat.

Il flush forza uno snapshot corrente anche quando esiste una scrittura
debounced pendente. Il restore resta sempre in pausa, applica posizione e
preferenze tecniche e non introduce un secondo formato.

## Quit reale

Dopo conferma:

1. appare l'overlay bloccante `Closing Eidetic Player…`;
2. il backend accetta `quit` solo dopo il flush;
3. `PlatformBridge.quit()` delega a `Neutralino.app.exit()`;
4. il dev orchestrator riceve la chiusura Neutralino e termina backend/Vite.

L'allowlist Neutralino è stata estesa, dopo autorizzazione esplicita
dell'utente, con il solo metodo `app.exit`. Non sono stati autorizzati namespace
o metodi aggiuntivi.

Smoke reale:

- conferma obbligatoria;
- Neutralino chiuso con success code 0;
- backend SIGTERM pulito;
- listener 4310/5173 rimossi.

## Restore reale

Snapshot prima del Quit:

- Queue: 5 stable IDs;
- current:
  `queue-2d1368d8-4801-4834-96b9-8799573e822c`;
- posizione: 77,249981 s;
- volume: 64;
- mute: true;
- shuffle: true;
- repeat: one.

Dopo `npm.cmd run dev`:

- restore: `restored`, 5/5;
- Queue IDs e ordine: identici;
- current ID: identico;
- posizione: 77,249961 s;
- volume/mute/shuffle/repeat: identici;
- stato: paused.

Dopo la prova, Queue, current track, posizione, volume, mute, shuffle e repeat
originari dell'utente sono stati ripristinati.

## Maintenance compatibility

`POST /api/system/maintenance` non è stato rimosso. Quando Maintenance è
disponibile delega allo stesso coordinator. Quando non è disponibile mantiene
la risposta legacy 404 `NOT_AVAILABLE`.

Il comando reale resta fisso:
`/usr/local/bin/eidetic-player-maintenance`, senza argomenti frontend. La
fixture non avvia processi host. Nessun terminale Maintenance è stato aperto
durante i test Windows.

## Azioni Step B

`restart-app`, `reboot` e `shutdown` dispongono di:

- tipo e ordine condivisi;
- label, descrizioni, conferme e progress copy;
- fixture Standard/Appliance;
- validazione backend;
- adapter registrabile nei test.

Non sono esposte dalle capabilities reali A e nessun comando host è
implementato. Helper Linux e Polkit non sono stati aggiunti.

## UI, conferme e accessibilità

Power menu:

- modale centrale larga 480 px al target;
- backdrop sopra tutta l'app, mini-player visibile ma non interagibile;
- titolo `Power`;
- sole azioni presenti nelle capabilities;
- chiusura X, backdrop ed Escape;
- focus iniziale sulla prima azione;
- focus trap e ritorno all'icona Power.

Ogni azione apre una conferma separata con testo e pulsanti richiesti. Cancel è
sempre presente. Non esistono countdown o pressione prolungata.

Dopo conferma:

- modale sostituita da overlay bloccante;
- spinner e `aria-live="assertive"`;
- backdrop/Escape non chiudono lo stato progress;
- nessun retry automatico;
- un errore pre-accettazione mostra messaggio tramite `textContent` e pulsante
  Close;
- un errore nativo dopo accettazione non effettua rollback né rimuove
  l'overlay.

Step 2.14.1 è preservato: nessuna selezione globale, nessun
`touch-action: none` globale e nessun `preventDefault` globale.

## File modificati

- `packages/shared/src/system.ts`
- `apps/backend/src/system/power-action-coordinator.ts`
- `apps/backend/src/index.ts`
- `apps/backend/src/player-session/player-session-types.ts`
- `apps/backend/src/player-session/player-session-repository.ts`
- `apps/backend/src/player-session/player-session-service.ts`
- `apps/backend/src/player/player-service.ts`
- `apps/ui/src/api/system-api-client.ts`
- `apps/ui/src/components/power-menu.ts`
- `apps/ui/src/components/side-menu.ts`
- `apps/ui/src/components/app-shell.ts`
- `apps/ui/src/components/icons.ts`
- `apps/ui/src/styles/components.css`
- `apps/ui/src/platform/platform-bridge.ts`
- `apps/ui/src/platform/neutralino-runtime.ts`
- `apps/ui/src/platform/neutralino-platform-bridge.ts`
- `apps/ui/src/platform/browser-platform-bridge.ts`
- `scripts/generate-neutralino-config.ts`
- `docs/development/architecture.md`
- `docs/development/testing.md`
- test mirati backend/UI e aggiornamenti fixture esistenti;
- `prompts/step2.14.2A_output.md`.

## Test

Set mirato finale: 58/58 PASS.

Copertura:

- enum chiuso, ordine e matrici fixture;
- payload valido/malformato/malevolo;
- azione non disponibile e concorrenza;
- flush prima dell'adapter;
- adapter non invocato se flush fallisce;
- nessun host command nelle fixture;
- capabilities production A;
- maintenance legacy;
- persistenza e restore di tutti i campi;
- `PlatformBridge` e `Neutralino.app.exit`;
- footer, icona, copy, conferme, progress/error;
- focus, Escape, backdrop e stato non dismissibile;
- touch scrolling, Queue e Playlist reorder;
- contratti Neutralino/installer esistenti.

I nuovi test system/power non sono nella allowlist install-safe.

## Windows smoke e viewport

App reale Neutralino/WebView2:

- MPV reale disponibile;
- traccia e Queue caricate;
- drawer e footer invariati;
- Development mostra soltanto Quit Eidetic Player;
- X, backdrop, Escape e Cancel: PASS;
- conferma e Quit reale: PASS;
- restore completo: PASS;
- Play/Pause e Previous/Next: PASS;
- Queue reorder reale con handle: revision incrementata e ordine modificato;
  ordine poi ripristinato;
- touch scrolling e on-screen keyboard protetti dai test di non-regressione.

Client area misurata:

- 1024×768: PASS;
- 1280×800: PASS prioritario;
- 1366×768: PASS.

Footer su una riga, testo non tagliato, icona non sovrapposta, modale centrata,
nessun clipping/overflow orizzontale e mini-player invariato.

## Installer firewall e cleanup

- `deploy/linux/`: unchanged.
- `.github/workflows/`: unchanged.
- installer/update/rollback/restore/uninstall: unchanged.
- helper Linux e Polkit: non aggiunti.
- install-safe e allowlist: unchanged.
- release/executable-mode verifier: unchanged.
- Network, SMB, USB, MPV discovery, FFmpeg, readiness e host/port: unchanged.
- nessun Neutralino/backend/Vite/MPV/FFmpeg residuo;
- nessun listener 4310/5173;
- nessun terminale Maintenance;
- screenshot e log temporanei rimossi.

## Gate finali

- `npm run format:check`: PASS;
- `npm run typecheck`: PASS;
- `npm run lint`: PASS;
- `npm run build`: PASS;
- `npm test`: PASS, 471 test totali, 463 pass e 8 skip attesi;
- `npm run test:posix`: PASS;
- `npm run verify:network:deployment`: PASS;
- `npm run verify:linux:executables`: PASS;
- `npm run verify:linux:installer`: PASS;
- `npm run mpv:doctor`: PASS con MPV reale;
- `npm run test:mpv`: PASS;
- `git diff --check`: PASS.

## Raspberry

`RASPBERRY — NOT TESTED`

Il test Raspberry resta successivo a commit, push e CI verde. In Step A
Appliance deve mostrare solo Maintenance; Restart app/reboot/shutdown resteranno
nascosti finché Step B non installerà e rileverà l'helper privilegiato.

Nessun commit o push è stato eseguito.
