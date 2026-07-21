# Step 2.6.3 — esito finale

- **Data:** 21 luglio 2026.
- **Esito:** completato nel working tree non committato; nessuno step successivo iniziato.
- **Ambiente:** Windows, Node `v24.18.0`, npm `11.16.0`, branch `main`, HEAD `1392e88239fade6d52c2eeb9200ff95da7f81fb9` (`first cassette player implementation`). `HEAD...origin/main` era ed è `0 0`; nessun merge/rebase in corso.
- **CI iniziale:** il check GitHub “Linux checks” di HEAD risultava riuscito in 40 s il 21 luglio 2026 ([GitHub Actions](https://github.com/dan88v/eidetic-player/commit/1392e88239fade6d52c2eeb9200ff95da7f81fb9/checks)). Non dichiaro una CI Linux post-modifica: non è stato eseguito alcun push.
- **Stato Git iniziale:** esclusivamente i due asset utente non tracciati: `apps/ui/public/assets/main-player/cassette/cassette-frame.png` e `design/cassette/cassette-master-original.png`.

## Asset e architettura

Il frame runtime è un PNG RGBA 8-bit valido, 1070×710, 904.936 byte, con trasparenza reale; il master è un PNG RGB 8-bit valido, 1586×992, 1.950.151 byte. Il master resta solo riferimento in `design/` e non viene importato né copiato nella build. L’unico raster Cassette distribuito è `/assets/main-player/cassette/cassette-frame.png`; il file nella build ha lo stesso SHA-256 dell’originale (`F59D60D5E5C1896F469E1FB2ECC2623370E140EA52DA88D60AA8B2F724AC4A09`). Nessun reel/overlay separato, URL remoto, base64 o path assoluto è stato introdotto.

La scena usa un box unico con `aspect-ratio: 1070 / 710`: un solo SVG dinamico sottostante e il PNG sopra. Il viewBox è `0 0 1070 710`; reel sinistro/destination `(290,388)`, destro/source `(776,388)`, core 28, full radius 56. La clip centrale usa tutti i 20 punti approvati. Il flusso è destra → sinistra. Lo SVG contiene solo masse, reel/hub e tape texture centrale; non contiene testina, capstan, pinch roller, meccanismi sospesi, controlli o testo. Il prototipo usa lo stesso box e la stessa geometria e non reintroduce parti meccaniche eliminate.

Queue progress e formula area-based dello Step 2.6.2 sono riutilizzati. Gli angoli restano integrati dal controller e non derivati dal seek; la velocità resta inversa al raggio. Un solo controller viene ritargetizzato dal prototipo al premium dopo `HTMLImageElement.decode()`, senza secondo rAF. Il limite è 30 fps; il tape centrale avanza solo in Play, i reel decelerano brevemente in Pause/Stop e il loop termina a riposo. Animations Off, reduced motion, hidden e destroy cancellano il lavoro continuo. Nessun timer periodico, layout read per frame, Canvas, worker, observer, FFmpeg o EventSource visualizer è stato aggiunto.

Il fallback è finito e ordinato: premium → prototipo → Default. Il prototipo resta visibile durante load/decode; lo swap premium è atomico. Un errore asset mantiene il prototipo e usa al massimo un toast passivo condiviso per sessione; un errore premium riusa il controller sul prototipo; solo il fallimento del modulo ripristina Default. Playback, traccia, Queue e `queueRevision` non vengono mutati.

La root Cassette conserva una descrizione accessibile sintetica; frame e parti dinamiche sono `aria-hidden`, senza tab stop o controlli. Il mini-player resta l’unica superficie di controllo.

## File

Nuovi file Cassette: `cassette-assets.ts`, `cassette-geometry.ts`, `cassette-premium-scene.ts`, `cassette-reel-layer.ts` e `step2.6.3.test.ts`, oltre ai due asset forniti dall’utente. Modificati nel modulo: `cassette-main-player.ts`, `cassette-animation-controller.ts`, `cassette-physics.ts`, `cassette-player.css` e il test Step 2.6.2.

Integrazioni esterne minime e motivate: `main-player-host.ts` e `screens/index.ts` inoltrano il solo callback di errore asset; `app-shell.ts` deduplica il toast per l’intera sessione; `i18n/en.ts` aggiunge il messaggio neutro. Default Player, mini-player, Queue, PlayerService, MPV, REST/SSE, visualizer coordinator e ciclo Mono → Stereo → Meter → Technical → None non sono stati modificati. Aggiornati in modo mirato `docs/ui.md`, `docs/development/cassette-player.md`, `performance.md` e `testing.md`.

## QA e misure

`npm.cmd run dev` è stato eseguito tre volte attraverso Neutralino → backend → MPV. Nella finestra WebView2 reale sono stati verificati Default, Settings → Interface, Default → Cassette, premium, Play/Pause, seek a inizio/metà/fine e ripristino della posizione, mini-player, ritorno a Default e successivo ritorno a Cassette. Track e Queue sono rimaste invariate. Il frame è fedele al master, reel e finestre sono allineati, non compaiono scritte o meccanismi aggiuntivi, flash bianchi, overflow o overlap.

Cassette e Default sono stati ispezionati realmente a 1280×800, 1366×768, 1600×900, 1280×720 e 1024×600. Aspect ratio, top bar, testi originali, centri reel, clip centrale e mini-player restano stabili. Il fallback reale è stato provato rimuovendo temporaneamente e poi ripristinando il frame: il prototipo è rimasto visibile, il playback è proseguito, è comparso un solo warning di decode e non è partito FFmpeg.

Misure Windows: asset 904.936 byte su disco; decoded RGBA stimato 3.038.800 byte (circa 2,90 MiB); scena premium 37 nodi DOM; 5 sole proprietà `transform` scritte per frame; un rAF, target massimo 30 fps; zero processi FFmpeg in Cassette; zero timer periodici e zero layout read nel percorso caldo. Non sono stati raccolti CPU/fps effettivi perché il binding del Browser in-app non era disponibile; il cap e il lifecycle sono coperti da sorgente e test. Non vengono dichiarate misure Raspberry Pi.

Build: 74 moduli; JS 162,89 kB (45,00 kB gzip), CSS 58,24 kB (10,07 kB gzip), frame servito separatamente; master assente da `dist/ui`.

## Verifiche

- `npm.cmd ci`: PASS; 212 pacchetti verificati.
- `npm.cmd audit`: PASS, 0 vulnerabilità.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd test`: PASS, 244 pass / 2 skip POSIX attesi / 0 fail su 246 test.
- Test Cassette mirati: 16/16 PASS.
- `npm.cmd run mpv:doctor`: PASS; MPV `v0.41.0-744-g304426c39`, IPC OK.
- `npm.cmd run ffmpeg:doctor`: PASS; FFmpeg build 2026-07-16, esecuzione OK.
- `npm.cmd run test:mpv`: PASS, 4/4.
- `npm.cmd run test:ffmpeg`: PASS, 3/3.
- `git diff --check`: PASS.

Le regressioni Step 2.6.1-R e l’intera suite UI/backend passano, incluse mini-player a due colonne, Home/Previous/Play-Pause/Next, seekbar/waveform, Queue, Library/Manage, toast passivo senza pulsanti, Sources/Folders/Settings, artwork, session restore, visualizer e shutdown.

## Cleanup e stato finale

Tre shutdown reali hanno lasciato zero Neutralino, MPV e FFmpeg, zero listener 4310/5173 e nessun file `.qa-*` o hold temporaneo. Il frame approvato è stato ripristinato con dimensione e hash invariati. Nessuno screenshot QA è versionato.

`git diff --stat` per i 13 file tracciati riporta 408 inserimenti e 230 rimozioni; i nuovi file e asset sono ancora untracked come previsto. `git diff --check` è pulito. Nessun commit, push, merge, rebase, reset, restore, stash o clean è stato eseguito.

Limiti espliciti: il Browser in-app non esponeva una sessione controllabile, quindi splash frame-by-frame, FPS/CPU reali e `prefers-reduced-motion` non sono stati misurati visualmente; bootstrap e shutdown sono confermati dai log reali, mentre reduced motion/Animations Off, singolo rAF, idle e fallback sono coperti dai test. La validazione Raspberry Pi e la CI Linux delle modifiche restano successive a un eventuale commit/push autorizzato.
