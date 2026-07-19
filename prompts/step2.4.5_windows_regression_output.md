# Step 2.4.5-W — Windows x64 automatic regression validation

Data: 19 luglio 2026  
Esito: **PASS per la regressione automatica Windows**, con tre regressioni
corrette. La QA visuale/interattiva 1280 × 800 e i dialoghi nativi restano
**NOT TESTED** perché il controller browser non era disponibile; non vengono
dichiarati PASS. Lo Step 2.5 non è stato iniziato.

Branch: `main`  
HEAD: `9b67fae06eb8cad32e9a9e6d42784b0b0c297d24`

## Ambiente e inventario

- Windows 11 Pro x64, versione 25H2, build `26200.8655`. Il campo legacy
  `ProductName` del registro riporta ancora “Windows 10 Pro”.
- Architettura processo: `AMD64`; filesystem: NTFS; shell: PowerShell.
- Node `v24.18.0`; npm `11.16.0`.
- MPV `v0.41.0-744-g304426c39`, rilevato in `C:\Tools\mpv\mpv.exe`.
- FFmpeg build git `ceabc9b306` del 16 luglio 2026, rilevato in
  `C:\Tools\ffmpeg\ffmpeg.exe`.
- Neutralino CLI `11.7.2`; runtime/client `6.8.0`.
- Stato Git iniziale: pulito, nessun conflitto, nessun `MERGE_HEAD`, nessun
  `Unmerged paths`.
- `APPDATA`: `C:\Users\dan88\AppData\Roaming`.
- `LOCALAPPDATA`: `C:\Users\dan88\AppData\Local`.
- `TEMP`: `C:\Users\dan88\AppData\Local\Temp`.
- PowerShell blocca `npm.ps1` tramite execution policy; tutti i comandi sono
  stati eseguiti correttamente con `npm.cmd`, senza cambiare la policy.

## Installazione, statici e test

- `npm.cmd ci`: **PASS**, 211 pacchetti / 212 controllati, 11,693 s nella run
  finale; nessuna modifica a `package-lock.json`.
- `npm.cmd audit`: **PASS**, 0 vulnerabilità, 2,616 s.
- Gli avvisi `inflight`, `glob@7`, `yaeti` e i quattro install script pendenti
  sono dipendenze dev transitive già documentate nello Step 2.4.5; non sono
  stati approvati né aggiornati.
- `format:check`: **PASS**, 6,234 s.
- `typecheck`: **PASS**, 8,225 s.
- `lint`: **PASS**, 17,857 s.
- `build`: **PASS**, 7,482 s complessivi; fase Vite 472 ms.
- `npm.cmd test`: **PASS**, 183 test totali in 3,664 s
  (181 PASS, 2 SKIPPED Linux/POSIX previsti, 0 FAIL; runner 2,570 s).
- `test:case-sensitive`: **FAIL supplementare/non applicabile su Windows**.
  È una utility Linux-only e, se invocata direttamente su NTFS, interpreta gli
  import con separatori Windows come mismatch. Non fa parte del gate Windows e
  non rompe `npm ci`, build, suite standard o `dev`; non è stata alterata
  artificialmente.

I test automatici preservano splash/bootstrap barrier, Queue keyed e staged,
indice non iniziale, session restore paused-at-zero, artwork/cache/eviction,
waveform, Meter enhanced, Technical/Crest Factor/LUFS-S, visualizer sync,
Folders, Settings/inactivity, toast unico, mini-player e responsive contract.

## Directory Windows, sessione e Queue

- Resolver reale:
  - config: `C:\Users\dan88\AppData\Roaming\Eidetic Player`;
  - cache: `C:\Users\dan88\AppData\Local\Eidetic Player\Cache`;
  - data: `C:\Users\dan88\AppData\Local\Eidetic Player\Data`;
  - runtime: `C:\Users\dan88\AppData\Local\Temp\Eidetic Player\Runtime`.
- È stata aggiunta copertura esplicita `path.win32` per `APPDATA`,
  `LOCALAPPDATA`, `TEMP`, `sources.json` e `player-session.json`.
- XDG, `~/.config`, `~/.cache`, `/home` e `/tmp` non sono usati dal ramo
  Windows di produzione.
- I test di persistenza usano directory temporanee isolate. Lo smoke reale ha
  letto, senza modifiche strutturali, la sessione esistente: 14 elementi,
  indice corrente 2, stato `paused`, posizione `0.000001`, restore
  `restored`, nessun autoplay.
- Nessun path nativo è stato aggiunto ai contratti frontend/SSE.

## MPV e FFmpeg

- `mpv:doctor`: **PASS**, 1,499 s; avvio headless e JSON IPC OK.
- IPC Windows: named pipe `\\.\pipe\eidetic-player-<pid>-<uuid>`, non socket
  Unix.
- `test:mpv`: **PASS 4/4**, 4,349 s: command/reply, selected fifth/ninth item
  diretto, Queue, metadata, artwork, shutdown e riavvio.
- `ffmpeg:doctor`: **PASS**, 1,202 s.
- `test:ffmpeg`: **PASS 3/3**, 3,271 s: waveform reale, massimo un analyzer
  realtime e LUFS-S confrontato con `ebur128`.
- MPV e FFmpeg sono risolti tramite configurazione esistente; non è stato
  aggiunto alcun hardcode personale o path Linux.
- Dopo ogni integrazione: zero MPV e zero FFmpeg residui.

## Artwork e cleanup

- Test artwork: embedded JPEG/PNG/WebP, sidecar case-insensitive, cache
  hit/miss, fingerprint invalidation, eviction/rilettura selettiva e cleanup
  **PASS**.
- Il controllo PID Windows e il cleanup startup/shutdown restano attivi.
- È stata corretta una perdita: il resolver MPV Unix creava la directory
  runtime prima di rifiutare un path socket troppo lungo. Ora valida prima di
  creare directory; il test verifica esplicitamente l’assenza di effetti
  filesystem.
- Cleanup finale: zero directory artwork temporanee e zero directory lunghe
  create dal test.

## Neutralino, WebView2 e font

- `npx.cmd neu build --release`: **PASS**, 4,157 s.
- Artefatto Windows:
  `dist/eidetic-player/eidetic-player-win_x64.exe`, PE machine `0x8664`
  (x86-64), 1.729.024 byte.
- `resources.neu`: 713.790 byte; release ZIP: 5.341.371 byte.
- `binaryName` è `eidetic-player`; la stringa letterale `${OS}_${ARCH}` è
  assente. Gli artefatti Linux/ARM non sono stati rimossi.
- Nessun riferimento obbligatorio GTK/WebKitGTK/WSL nella configurazione
  Windows.
- Smoke reale: una istanza Neutralino Windows x64 e un processo WebView2 figlio
  diretto; CLI collegata all’app.
- Open Sans è locale, `font-display: block`, nessuna richiesta Google Fonts:
  HTML 2,48 kB; CSS 42,84 kB (7,73 gzip); JS 111,57 kB (32,13 gzip);
  TTF 532.636 byte.
- Regressione corretta: la licenza OFL esisteva nel sorgente ma non entrava nel
  bundle. La build copia ora `licenses/OpenSans-OFL.txt` (4.216 byte);
  TTF, licenza e config sono presenti dentro `resources.neu`.

## Smoke development e shutdown

- `npm.cmd run dev`: **PASS** con timeout controllato.
- Backend `/health`: `ok`; UI Vite: HTTP 200; bootstrap: **PASS**; MPV
  disponibile; FFmpeg avviabile; shell Neutralino e WebView2 collegati.
- Vite ready finale: 496 ms. Il tempo esatto backend/Neutralino non era
  strumentato; Neutralino è comunque entrato nello stato collegato entro il
  timeout di 60 s. Una rilevazione processi precedente lo collocava a circa
  9 s dall’avvio del runner.
- Chiusura della sola shell di test: backend ha ricevuto `SIGTERM` tramite il
  percorso di shutdown ordinato; shutdown finale 1,449 s.
- Finale: zero listener 4310/5173, zero processi Node/Vite/backend del progetto,
  zero Neutralino, zero MPV, zero FFmpeg, zero log/PID temporanei creati dallo
  smoke.

## Problemi trovati e correzioni

1. **Test socket Unix eseguito su Windows**: usava filesystem/path host e
   falliva per la lunghezza del path NTFS. Correzione: SKIP previsto su Windows
   per il test realmente Unix; Linux resta invariato.
2. **Copertura directory Windows incompleta**: verificava solo Sources.
   Correzione: test espliciti per config/cache/data/runtime e sessione.
3. **Licenza Open Sans assente dal release**: correzione nel build Vite con
   copia dell’OFL e test del contratto.
4. **Residuo su rifiuto socket lungo**: validazione spostata prima di
   `mkdir/chmod` e test no-side-effect.

Nessuna dipendenza è stata aggiunta o aggiornata. Nessun refactor UI, database,
Library indexing, USB, SMB, output audio, kiosk o packaging Raspberry Pi è
stato implementato.

## File modificati

- `apps/backend/src/player/mpv-endpoint.ts`
- `apps/backend/test/filesystem-path.test.ts`
- `apps/backend/test/linux-platform.test.ts`
- `apps/ui/test/step2.4.4.test.ts`
- `apps/ui/vite.config.ts`
- `prompts/step2.4.5_windows_regression_output.md`

## Limiti e stato finale

- QA visuale/touch a 1280 × 800, dialoghi Open/Add Folder, interazione manuale
  con Settings/Folders/Queue/Technical e transizioni real-media:
  **NOT TESTED** in questa run, perché il controller browser era indisponibile.
  L’avvio Neutralino/WebView2 e i contratti automatici sono PASS ma non
  sostituiscono l’ispezione visiva.
- Audio udibile e selezione device: **NOT TESTED**; le integrazioni usano output
  non udibile.
- `git diff --check`: **PASS**.
- Nessun commit, push, merge, rebase o force-push eseguito.
- Le correzioni Linux restano preservate e lo Step 2.5 non è stato iniziato.
