# Step 2.4.5-W — Windows x64 regression validation

Data: 19 luglio 2026  
Esito: **PASS per la regressione automatica e manuale Windows**, con cinque
regressioni corrette. La QA è stata eseguita nell'app Neutralino reale avviata
con `npm.cmd run dev`, inclusi 1280 × 800, layout di fallback, dialoghi nativi,
Queue, Folders, Settings e visualizzatori. Lo Step 2.5 non è stato iniziato.

Branch: `main`  
HEAD durante la QA finale: `03a10c50633291e1eddb7889a189e67d0e882fa3`

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

- `npm.cmd ci`: **PASS**, 211 pacchetti / 212 controllati, 13,164 s nella run
  finale; nessuna modifica a `package-lock.json`.
- `npm.cmd audit`: **PASS**, 0 vulnerabilità, 2,540 s.
- Gli avvisi `inflight`, `glob@7`, `yaeti` e i quattro install script pendenti
  sono dipendenze dev transitive già documentate nello Step 2.4.5; non sono
  stati approvati né aggiornati.
- `format:check`: **PASS**, 6,243 s.
- `typecheck`: **PASS**, 8,338 s.
- `lint`: **PASS**, 17,501 s.
- `build`: **PASS**, 7,876 s complessivi; fase Vite 519 ms.
- `npm.cmd test`: **PASS**, 183 test totali in 3,933 s
  (181 PASS, 2 SKIPPED Linux/POSIX previsti, 0 FAIL; runner 2,819 s).
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

- `mpv:doctor`: **PASS**, 1,398 s; avvio headless e JSON IPC OK.
- IPC Windows: named pipe `\\.\pipe\eidetic-player-<pid>-<uuid>`, non socket
  Unix.
- `test:mpv`: **PASS 4/4**, 4,390 s: command/reply, selected fifth/ninth item
  diretto, Queue, metadata, artwork, shutdown e riavvio.
- `ffmpeg:doctor`: **PASS**, 1,187 s.
- `test:ffmpeg`: **PASS 3/3**, 3,244 s: waveform reale, massimo un analyzer
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

- `npx.cmd neu build --release`: **PASS**, 4,311 s.
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
  HTML 2,48 kB; CSS 42,84 kB (7,73 gzip); JS 111,47 kB (32,13 gzip);
  TTF 532.636 byte.
- Regressione corretta: la licenza OFL esisteva nel sorgente ma non entrava nel
  bundle. La build copia ora `licenses/OpenSans-OFL.txt` (4.216 byte);
  TTF, licenza e config sono presenti dentro `resources.neu`.

## QA manuale nell'app Neutralino

- `npm.cmd run dev`: **PASS**; area client misurata esattamente 1280 × 800
  (finestra esterna 1296 × 839), con Open Sans locale, artwork, waveform e
  trasporto centrato. Nessun flash bianco, overflow, salto o superficie vuota
  osservato durante navigazione e caricamenti.
- Side menu, Queue drawer reale con 14 righe keyed e miniature, Settings root,
  Interface, Sources, Folders grid/list e directory sono stati aperti e
  ispezionati. La vista Folders è stata ripristinata su grid.
- Il dialogo Windows **Open Files** è stato aperto da Queue > Add Files e
  annullato; il dialogo Windows **Add Folder** è stato aperto da Sources e
  annullato. Nessun file o source è stato modificato.
- Selezione reale di un elemento non iniziale della Queue: **PASS**. La sessione
  è stata poi ripristinata su indice 2, pausa attiva e mute disattivato.
- Technical in stato neutro e popolato: **PASS**; rilevati Crest 9,1 dB e
  LUFS-S -13,9 durante la prova, con un solo FFmpeg. Meter enhanced popolato:
  **PASS**, barre L/R attive e un solo FFmpeg.
- Toast singolo: **PASS**. Il tentativo di aggiungere da Folders un brano già
  presente ha mostrato una sola notifica “Track is already in Queue” e la Queue
  è rimasta a 14 elementi.
- Ciclo visualizzatore reale verificato dopo la correzione:
  Mono → Stereo → Meter → Technical → None → Mono. Tre tap partendo da Mono
  raggiungono Technical, quindi Meter non viene più saltato.
- Stress reale sotto `npm.cmd run dev`: 20 comandi Queue/play in 66 ms, Queue
  invariata a 14 elementi, ID stabili, ultimo indice richiesto corretto, un
  MPV, un FFmpeg e nessun errore. Il backend ha coalesciuto correttamente le
  richieste rapide in un solo cambio di stato pubblicato.
- Layout ispezionati anche a 1366 × 768, 1600 × 900, 1280 × 720 e 1024 × 600:
  **PASS**. Il layout emergency riduce i dettagli tecnici mantenendo controlli
  touch ampi e senza overflow. La finestra è stata ripristinata a 1280 × 800.

## Smoke development e shutdown

- `npm.cmd run dev`: **PASS** con timeout controllato.
- Backend `/health`: `ok`; UI Vite: HTTP 200; bootstrap: **PASS**; MPV
  disponibile; FFmpeg avviabile; shell Neutralino e WebView2 collegati.
- Vite ready nella prova finale: 455 ms. Il tempo esatto backend/Neutralino non era
  strumentato; Neutralino è comunque entrato nello stato collegato entro il
  timeout di 60 s. Una rilevazione processi precedente lo collocava a circa
  9 s dall’avvio del runner.
- Chiusura della sola shell di test tramite `WM_CLOSE`: backend ha ricevuto
  `SIGTERM` tramite il percorso di shutdown ordinato; l'ultima chiusura è
  terminata senza residui.
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
5. **Ciclo touch del visualizzatore incoerente**: il Canvas passava da Stereo
   direttamente a Technical e rendeva Meter raggiungibile solo da Settings.
   Correzione: una funzione pura condivisa definisce l'ordine canonico usato
   sia dal tap sia dall'etichetta accessibile, con test comportamentale.

Nessuna dipendenza è stata aggiunta o aggiornata. Nessun refactor UI, database,
Library indexing, USB, SMB, output audio, kiosk o packaging Raspberry Pi è
stato implementato.

## File modificati

- `apps/backend/src/player/mpv-endpoint.ts`
- `apps/backend/test/filesystem-path.test.ts`
- `apps/backend/test/linux-platform.test.ts`
- `apps/ui/src/components/visualizer.ts`
- `apps/ui/src/visualizer/visualizer-mode.ts`
- `apps/ui/test/step2.4.4.test.ts`
- `apps/ui/vite.config.ts`
- `prompts/step2.4.5_windows_regression_output.md`

## Limiti e stato finale

- Touchscreen fisico Raspberry Pi: **NOT TESTED**; la QA touch è stata eseguita
  nella WebView2 Windows con input puntatore reale.
- Audio udibile e selezione device: **NOT TESTED**; durante le prove di
  riproduzione l'output è stato intenzionalmente silenziato.
- `git diff --check`: **PASS**.
- Nessun nuovo commit, push, merge, rebase o force-push è stato eseguito
  durante questa integrazione manuale; la correzione del ciclo visualizzatore
  resta nel working tree.
- Le correzioni Linux restano preservate e lo Step 2.5 non è stato iniziato.
