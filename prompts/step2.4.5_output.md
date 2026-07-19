# Step 2.4.5 — Linux/Debian/Raspberry Pi runtime compatibility audit

Data: 19 luglio 2026  
Esito: completato per Debian 13 amd64/WSL2 con limiti espliciti. Raspberry Pi,
Linux arm64 runtime, Debian bare metal e regressione Windows reale non sono
dichiarati verificati. Non è stato avviato lo Step 2.5.

Commit iniziale e finale del branch: `043e62d842888af865a517e31278bba9afe1f9a4`.
Non sono stati eseguiti commit, push o merge; tutte le modifiche restano nel
working tree di `audit/linux-compat-2.4.5`.

## Ambiente reale

- Clone Linux ext4: `/home/daniele/src/eidetic-player`.
- Debian GNU/Linux 13.6 Trixie, WSL2 kernel 6.18.33.2, x86_64, systemd PID 1.
- Node 24.18.0, npm 11.16.0, MPV 0.40.0, FFmpeg 7.1.5.
- GTK 3.24.49, WebKitGTK 4.1/2.52.3, DISPLAY `:0`, Wayland `wayland-0`.
- WSLg PulseAudio server con `RDPSink`; nessuna scheda ALSA fisica, come
  previsto in WSL.
- Neutralino CLI 11.7.2, runtime 6.8.0.

## Matrice di compatibilità

| Area                   | Windows x64                        | Debian 13 WSL2 amd64        | Debian VM/bare metal | Linux arm64 / Pi OS 64    | Pi 3B reale | armhf        |
| ---------------------- | ---------------------------------- | --------------------------- | -------------------- | ------------------------- | ----------- | ------------ |
| npm install/build/test | PARTIAL: test statici              | PASS                        | NOT TESTED           | PARTIAL: audit JS/ELF     | NOT TESTED  | PARTIAL: ELF |
| backend/filesystem/XDG | PARTIAL: contratti                 | PASS                        | NOT TESTED           | PARTIAL: audit statico    | NOT TESTED  | PARTIAL      |
| MPV/IPC                | PARTIAL: named-pipe test esistenti | PASS: MPV + Unix socket     | NOT TESTED           | PARTIAL: codice portabile | NOT TESTED  | NOT TESTED   |
| FFmpeg/analyzer        | PARTIAL: test precedenti           | PASS                        | NOT TESTED           | PARTIAL: spawn portabile  | NOT TESTED  | NOT TESTED   |
| Neutralino/GUI         | PARTIAL: QA Step 2.4.4             | PASS smoke WSLg             | NOT TESTED           | PARTIAL: ELF arm64        | NOT TESTED  | PARTIAL: ELF |
| audio                  | PARTIAL: QA precedente             | PASS RDPSink/null; ALSA N/A | NOT TESTED           | NOT TESTED                | NOT TESTED  | NOT TESTED   |
| systemd                | N/A                                | PASS verify prototipo       | PARTIAL              | PARTIAL                   | NOT TESTED  | PARTIAL      |
| packaging              | PARTIAL: artefatto generato        | PASS                        | NOT TESTED           | PASS statico              | NOT TESTED  | PASS statico |

`PARTIAL` non equivale a compatibilità runtime. Raspberry Pi OS arm64 e Pi 3B
restano predisposti, non verificati.

## Problemi trovati e corretti

- MPV Linux creava socket direttamente nella temp globale. Ora usa
  `$XDG_RUNTIME_DIR/eidetic-player`, oppure un fallback temp per utente/processo,
  directory mode 0700, PID+UUID, limite conservativo di 100 byte, cleanup stale
  e cleanup allo shutdown. Due endpoint simultanei non collidono.
- Config, cache, data e runtime non avevano un resolver unico. Il nuovo
  `resolveAppDirectories` centralizza XDG e mantiene APPDATA/LOCALAPPDATA su
  Windows. Sources e sessione player restano in config; artwork rigenerabile
  passa alla cache; data è riservata; socket e token runtime non finiscono in
  config.
- Il runner development chiedeva lo shutdown HTTP ordinato soltanto su Windows.
  Ora lo fa su ogni piattaforma prima del fallback a segnale.
- Il `binaryName` Neutralino conteneva letteralmente `${OS}_${ARCH}`; Neu non lo
  espandeva e generava pacchetti con quel testo. Ora è `eidetic-player` e Neu
  produce correttamente `eidetic-player-linux_x64`, `-linux_arm64`, `-linux_armhf`
  e gli altri artefatti.
- La UI dipendeva dal font di sistema (`Inter` non bundled), producendo metriche
  diverse fra WebView2 e WebKitGTK. È incluso Open Sans variable 300–800 dal
  repository ufficiale Google Fonts, con licenza SIL OFL e `font-display:
block`; i font di sistema sono solo fallback. SHA-256 TTF:
  `36643644f318a812aab2d2ed3bb98f8cf0872527f835fe9398d95fe6b9adb878`.
- Mancavano doctor, smoke, test POSIX, controllo case-sensitive e audit ARM
  riutilizzabili. Sono disponibili come script npm senza sudo, PowerShell o
  `.cmd`.

## Audit Windows e processi

Le occorrenze `.exe`, `.cmd`, PowerShell, WebView2 e path Windows sono nei
report/documentazione, negli esempi oppure negli adapter Windows. `taskkill.exe`
rimane isolato nel runner development esclusivamente dietro `win32`; Linux usa
SIGTERM. MPV/FFmpeg/analyzer/waveform usano `spawn`/`execFile` con array di
argomenti e senza concatenazione shell. Discovery prova variabile ambiente e
poi PATH; FFmpeg può inoltre essere adiacente a MPV. Non sono stati rimossi
fallback Windows.

SIGTERM e SIGINT del backend sono stati provati separatamente: entrambi
completano shutdown con exit 0. SIGKILL resta fallback. Dopo smoke e WSLg:
zero Node/Vite/Neutralino/MPV/FFmpeg residui, zero listener 4310/5173, zero
socket MPV e zero directory artwork residue.

## XDG e filesystem POSIX

Testati XDG custom e fallback, home Unicode/spazi, directory assenti, creazione
ricorsiva, mode 0600 dei file atomici, runtime 0700, rename atomico, path socket
troppo lungo e cleanup. Config non scrivibile propaga l’errore senza spostare i
dati in directory errate.

Le fixture native sotto `/tmp`/ext4 coprono nomi case-distinct
`Album.flac`/`album.flac`, Unicode, spazi, hidden, newline, directory mode 000,
symlink interno/esterno/broken e FIFO. I test browser esistenti coprono inoltre
listing non ricorsivo, esclusione symlink/junction, containment canonico,
traversal, file eliminati/mancanti e risposte con soli ID/path logici. Nessun
path Linux nativo è stato aggiunto ai contratti pubblici.

`test:case-sensitive` risolve gli import relativi TypeScript/JavaScript e
verifica ogni segmento con il case reale. `.gitattributes`, `.editorconfig`,
BOM/CRLF e bit eseguibili sono stati auditati; non esistono script shell da
normalizzare e non è stata fatta una riscrittura indiscriminata.

## MPV, FFmpeg e audio

- `mpv:doctor`: PASS, avvio headless e JSON IPC Unix.
- Integrazione MPV: 4/4, incluso selected-index diretto, Queue, metadata/artwork
  e shutdown.
- `ffmpeg:doctor`: PASS.
- Integrazione FFmpeg: 3/3, inclusi waveform reale, massimo un analyzer e
  confronto LUFS-S con `ebur128`.
- MPV elenca PipeWire, PulseAudio, ALSA, JACK, SDL, sndio e null; non è
  hardcodato alcun output. In WSLg rileva `auto`, `pulse/RDPSink` e fallback
  generici. PipeWire non ha configurazione client WSLg e `aplay -l` non trova
  hardware ALSA: non sono errori dell’app.
- Tutti i test automatici audio hanno usato output null. Non è stato emesso
  audio udibile.

## Neutralino, WSLg e ARM

`neu update` ha ottenuto gli artefatti ufficiali 6.8.0. `build:linux` genera
risorse e pacchetto release con nomi corretti. La finestra Linux x64 è partita
realmente sotto WSLg, CLI/WebView si sono collegate, Vite e backend erano
raggiungibili, bootstrap ha restituito MPV disponibile e Queue vuota. È comparso
un warning GDK `gdk_monitor_get_scale_factor` specifico del monitor WSLg, senza
blocco dell’avvio.

Non erano disponibili strumenti per pilotare o acquisire la finestra: dialoghi
Open/Add Folder, cancellazione, navigazione Folders/Settings/Technical e QA
visuale 1280×800 dopo Open Sans sono quindi NOT TESTED, non PASS. Contratti,
layout e font sono coperti da test statici, ma non sostituiscono l’ispezione.

Audit `file`/`readelf`:

- arm64: ELF64 AArch64, interpreter `/lib/ld-linux-aarch64.so.1`, executable;
- armhf: ELF32 ARM EABI5, interpreter `/lib/ld-linux-armhf.so.3`, executable;
- dipendenze ELF: GTK3/GDK/Cairo/GLib/X11 e librerie standard Linux, nessuna
  DLL Windows.

I binari ARM non sono stati eseguiti su x86_64 e `ldd` non è stato usato
cross-architecture. Non risultano dipendenze npm runtime native x64-only.

## Dipendenze, performance profile, systemd e CI

`.nvmrc` fissa la baseline 24.18.0; `engines` resta `>=22.12.0`. `npm ci`
segnala `yaeti`, `glob@7` e `inflight`: sono dipendenze dev transitive di
`@neutralinojs/neu` (`websocket` e `@electron/asar`), non entrano nel runtime
app e `npm audit` riporta zero vulnerabilità. Gli install script segnalati sono
`esbuild`, i moduli websocket opzionali `bufferutil`/`utf-8-validate` e
`es5-ext`; non sono stati approvati o aggiornati indiscriminatamente.

Il profilo opt-in esistente `EIDETIC_ANALYZER_PROFILE=rpi3` usa 16 kHz/15 fps
contro 24 kHz/20 fps desktop. Restano due worker metadata/artwork, cache
bounded, un analyzer, un waveform, un EventSource e un rAF. Non è abilitato
automaticamente e non usa detection fragile.

`deploy/linux/` contiene un service backend non-root, environment example e
istruzioni. `systemd-analyze verify` passa su una copia `.service`; nulla è
stato installato, abilitato o avviato. La GUI resta nella sessione utente.

Non esiste GitHub Actions. È documentata una futura matrice minima Linux amd64
con npm ci/static/test POSIX/case-sensitive; non è stata creata una pipeline
sproporzionata. ARM resta audit statico.

## Misure e bundle

- Build UI: 350 ms Vite nella run finale.
- Bundle: HTML 2,48 kB; CSS 42,84 kB (7,73 gzip); JS 111,57 kB
  (32,13 gzip); Open Sans TTF 532,64 kB.
- Aggiunta font: +532.636 byte asset e circa +198 byte CSS rispetto alla build
  precedente. Nessun costo CPU/runtime continuo.
- Test completi: 183/183 in circa 2,0 s nella run finale.
- Integrazione MPV: circa 2,39 s complessivi; FFmpeg: circa 2,63 s.
- Smoke WSLg osservato: backend Node circa 89,6 MiB RSS, MPV 53,5 MiB,
  Neutralino 199,2 MiB. Sono valori WSLg development con inspector/Vite, non
  misure Raspberry Pi e non isolano analyzer/LUFS.
- `/usr/bin/time` non era installato. La misura dettagliata CPU/RSS automatica
  è SKIPPED; comando opzionale: `sudo apt install time`. Non è stato installato.

## Verifiche Debian

- `npm ci`: PASS, 212 pacchetti.
- `npm audit`: PASS, 0 vulnerabilità.
- `format:check`, `typecheck`, `lint`: PASS.
- `build` e `build:linux`: PASS.
- `npm test`: PASS, 183/183.
- `doctor:linux`, `test:posix` 5/5, `test:case-sensitive`: PASS.
- `mpv:doctor`, `test:mpv` 4/4: PASS.
- `ffmpeg:doctor`, `test:ffmpeg` 3/3: PASS.
- `smoke:linux`: PASS per SIGTERM e SIGINT.
- `verify:arm`: PASS statico arm64 e armhf.
- `systemd-analyze verify`: PASS.
- `git diff --check`: PASS.
- Neutralino Linux x64 WSLg startup/bootstrap/shutdown: PASS smoke.
- Cleanup finale: PASS.

## Regressioni e limiti

I 183 test preservano bootstrap barrier, restore paused-at-zero, Queue keyed e
staged, session/transition ID, Folders/Sources/Settings, toast unico, artwork,
waveform, meter, Technical, LUFS-S, visualizer sync e limiti di stream/processi.
Non sono stati aggiunti database, scansione, nuove UI funzionali, audio-device
selection, kiosk o funzioni Step 2.5.

La regressione Windows reale non è eseguibile dal clone Linux e resta NOT
TESTED. Sono passati typecheck/build/test multipiattaforma e test espliciti
`path.win32`, APPDATA, named pipe/config e shutdown runner; serve comunque la
checklist reale Windows: npm ci, statici, build, 183 test, doctor MPV/FFmpeg,
dev startup, Queue/restore/artwork/visualizer e shutdown.

## Raccomandazione e test Raspberry Pi rimanenti

Neutralino Linux arm64 resta il percorso primario: mantiene bridge/dialoghi e
ha un footprint architetturale minore. Browser kiosk con backend separato è il
fallback solo se test hardware dimostrano un blocco WebKitGTK/Neutralino; può
semplificare recovery systemd ma perde il percorso nativo attuale e introduce
un lifecycle browser separato.

Su Pi 3B reale con Raspberry Pi OS 64-bit restano obbligatori: esecuzione e
`ldd` arm64, cold/warm startup, CPU/RAM sostenute, analyzer/LUFS, touch fisico
1280×800, resa Open Sans, MP3/FLAC, Queue/restore/artwork/waveform/Technical,
ALSA/PipeWire/USB DAC, dialoghi o workflow kiosk, boot/autostart, crash/power
loss, SIGTERM, stale cleanup e almeno 20 transizioni rapide con un solo
MPV/analyzer/EventSource/rAF. Nessuna compatibilità hardware è dichiarata prima
di tali prove.

## File

Creati: `.nvmrc`, `.gitattributes`,
`apps/backend/src/platform/app-directories.ts`,
`apps/backend/test/linux-platform.test.ts`, font/licenza Open Sans,
`scripts/doctor-linux.ts`, `scripts/linux-smoke.ts`,
`scripts/test-case-sensitive.ts`, `scripts/verify-arm.ts`, i tre file
`deploy/linux/`, `docs/development/linux-debian.md` e questo report.

Modificati: repository Sources/session, artwork service/test, MPV endpoint,
runner dev, generatore Neutralino, base CSS/test UI, `package.json`, README,
architettura e documentazione development. Nessuna dipendenza npm è stata
aggiunta o rimossa.
