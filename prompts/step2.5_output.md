# Step 2.5 — Indexed Library foundation

## Esito

Step 2.5 è completato nel working tree, senza commit, push, merge o rebase.
Eidetic Player dispone ora di un catalogo SQLite persistente per le Source
locali, scansione ricorsiva incrementale e cancellabile, stato/progresso
persistito, API REST/SSE dedicate, recovery controllato e una schermata Library
di riepilogo e controllo. La navigazione indicizzata di Track/Album/Artist
rimane correttamente fuori scope per Step 2.6.

Durante il collaudo reale con `npm.cmd run dev` è stato trovato un difetto non
coperto dai fixture: alcuni FLAC esponevano un bitrate decimale e SQLite
`STRICT` rifiutava l'inserimento nella colonna intera. I campi tecnici interi
vengono ora normalizzati al confine metadata e una regressione dedicata
impedisce il ritorno del problema. È stata inoltre resa terminale una scansione
anche se una transazione batch fallisce, senza lasciare stato `scanning`.

## Implementazione

- Il backend usa il `node:sqlite` integrato in Node, senza nuove dipendenze.
  Il requisito dichiarato è Node `>=24.15.0`; `.nvmrc` resta Node 24.18.0.
- `library.db` vive nella directory dati dell'applicazione:
  `%LOCALAPPDATA%\Eidetic Player\Data` su Windows e
  `${XDG_DATA_HOME:-~/.local/share}/eidetic-player` su Linux.
- Lo schema v1 usa tabelle `STRICT` per Source, Track, Album, Artist,
  associazioni Track/Artist e scan run, con foreign key e indici mirati.
- La connessione singola usa WAL, `synchronous=NORMAL`, foreign key abilitate,
  busy timeout 2,5 s e transazioni `BEGIN IMMEDIATE` limitate a 32 elementi
  desktop o 16 nel profilo Raspberry.
- Migrazioni e `PRAGMA user_version` sono transazionali. Una versione futura
  viene rifiutata senza riscrittura. Un database corrotto viene chiuso,
  preservato come `library.corrupt-<timestamp>.db` e ricostruito, con una sola
  notifica UI priva di percorso.
- L'identità Track stabile deriva da `(sourceId, logicalRelativePath)`.
  Dimensione e mtime decidono l'incrementalità; un file invariato non esegue
  parsing metadata.
- La scansione è iterativa, ricorsiva, naturalmente ordinata, non segue
  symlink/junction ed esclude elementi dot e di sistema. Metadata e artwork
  embedded vengono letti in serie e senza buffer persistenti nel catalogo.
- Solo una traversata interamente riuscita marca indisponibili i file non più
  visti. Cancel, Source offline, errore transazionale e traversata parziale
  conservano l'ultimo insieme disponibile.
- Un solo scheduler ammette una scansione attiva. La prima scansione di ogni
  Source parte automaticamente una volta; le successive sono manuali.
  `AbortSignal` gestisce Cancel e shutdown. Il lavoro cede priorità
  all'arricchimento della transizione di playback.
- Le run non terminali sono recuperate come `interrupted` al riavvio. Lo
  shutdown cancella/attende lo scanner, chiude SSE, esegue il checkpoint WAL e
  chiude il database.
- REST espone snapshot, summary, Sources, status, scan, cancel e acknowledge
  recovery. Library SSE è low-frequency, ha una sola subscription/keepalive
  solo quando esiste almeno un client e non usa polling.
- Contratti pubblici, SSE e diagnostica non espongono root native, percorsi del
  database, buffer artwork o immagini base64.
- Library aggiorna in place Tracks, Albums, Artists, Unavailable, Source,
  stato, progress, contatori, tempo e ultimo successo. Rescan diventa Cancel
  solo durante una run attiva e resta disabilitato quando il lavoro è queued.
- Sources riusa il menu popup esistente per Rescan Library, Retry condizionale,
  Rename e Remove. Una scansione in corso/queued disabilita i nuovi Rescan.
- Remove non modifica media e conserva il catalogo come storico
  rimosso/indisponibile. Non è stato aggiunto alcun watcher.

La documentazione è aggiornata in README, architettura, UI, performance,
testing, Linux e nella nuova guida
`docs/development/library-index.md`.

## Test automatici

| Comando                     | Esito                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| `npm.cmd run format:check`  | PASS                                                                       |
| `npm.cmd run typecheck`     | PASS                                                                       |
| `npm.cmd run lint`          | PASS                                                                       |
| `npm.cmd run build`         | PASS; 63 moduli, JS 120,96 kB / 34,56 kB gzip, CSS 45,48 kB / 8,04 kB gzip |
| `npm.cmd test`              | PASS: 205 totali, 203 pass, 2 skip POSIX attesi su Windows, 0 fail         |
| `npm.cmd run test:posix`    | PARTIAL su Windows: 3 pass, 2 skip host-specific                           |
| `npm.cmd run mpv:doctor`    | PASS; MPV 0.41, startup headless e JSON IPC                                |
| `npm.cmd run test:mpv`      | PASS: 4/4                                                                  |
| `npm.cmd run ffmpeg:doctor` | PASS                                                                       |
| `npm.cmd run test:ffmpeg`   | PASS: 3/3                                                                  |

Le nuove regressioni coprono schema/pragmas/FK, rollback, reopen, corruzione,
versione futura, path Windows/POSIX, recovery run interrotta, normalizzazione
Unicode, identità Album/Artist/compilation, 1.000 Track, scansione ricorsiva,
filtri, bitrate frazionario, metadata malformati, batch failure, traversata
parziale, incrementale new/modified/missing/reappearing, Source offline/return,
cancel senza falsi unavailable, scheduler singolo, prima scansione automatica,
manual rescan e Remove non distruttivo.

`npm.cmd run test:case-sensitive`, eseguito direttamente sul clone NTFS
Windows, non è considerato un test Linux valido e fallisce perché l'host
case-insensitive non risolve il mirror degli import `.js` verso sorgenti `.ts`.
Il test su filesystem Linux reale resta **NOT TESTED**, non PASS.

## Collaudo reale Windows con `npm.cmd run dev`

Il comando richiesto è stato usato per avviare l'intero percorso
Neutralino → backend → SQLite/MPV.

- Prima scansione reale: 44 Track, 4 Album, 5 Artist, 4 Source, 0 unavailable.
  Due FLAC con metadata malformati hanno usato il fallback per-file senza
  interrompere la scansione dopo la correzione del bitrate.
- Una scansione Library completa è stata eseguita mentre MPV riproduceva un
  MP3 reale; playback e UI sono rimasti attivi.
- Il menu `…` di Sources ha riscansionato soltanto la Source scelta, verificato
  dall'incremento della sua sola generation.
- Il secondo scan reale invariato ha saltato tutti i metadata.
- La UI è stata ispezionata realmente a 1280×800, 1366×768, 1600×900,
  1280×720 e 1024×600. Nessun flash bianco, overflow orizzontale o layout shift;
  a 1024×600 il contenuto scorre senza coprire il mini-player.
- La diagnostica pubblica non contiene il path locale del database.
- Il riavvio finale ha riaperto 44 Track senza auto-rescan, con integrità
  valida.

Per rendere osservabili progresso e cancellazione è stato creato fuori dal
repository un fixture temporaneo di 4.000 WAV validi, poi eliminato:

| Misura Windows desktop                        |                                  Risultato |
| --------------------------------------------- | -----------------------------------------: |
| Prima scansione / metadata parse              |                              4.000 / 4.000 |
| Prima scansione                               |              22.651 ms, circa 176,6 file/s |
| Scan invariato                                | 4.000 file in 1.951 ms, circa 2.050 file/s |
| Metadata parse scan invariato                 |                                          0 |
| Transazioni scan invariato                    |                                        127 |
| Transazione max / media                       |                       23,103 ms / 1,320 ms |
| Latenza Cancel osservata                      |                                      55 ms |
| Unavailable dopo Cancel                       |                                          0 |
| Massimo scheduler concorrente                 |                                          1 |
| Working set backend massimo osservato         |                                   74,5 MiB |
| CPU backend scan invariato                    |                                    1,922 s |
| Database 4.000 Track                          |                             1.937.408 byte |
| Apertura database popolato / migrazione no-op |                      127,386 ms / 0,370 ms |
| Shutdown durante scan                         |                                   2.657 ms |

Dopo lo shutdown durante una scansione non erano presenti Neutralino, MPV,
FFmpeg, backend, Vite, porte 4310/5173 o fixture residui. Il riavvio ha mostrato
la run come `cancelled`, 4.000 Track persistenti, zero unavailable, nessun
auto-rescan e `quick_check` valido.

Nessun file musicale è stato modificato, rinominato o eliminato.

## Linux e Raspberry Pi

Le modifiche Step 2.5 non sono state eseguite nel clone Debian/WSLg né su
Raspberry Pi: entrambi restano **NOT TESTED** per questa step. Dopo
l'integrazione del working tree in un branch sincronizzato, eseguire dal clone
Linux nativo:

```bash
cd ~/src/eidetic-player
git status --short --branch
git pull --ff-only
nvm install
nvm use
node --version
npm --version
npm ci
npm run doctor:linux
npm run test:linux
npm run build:linux
npm run smoke:linux
npm run verify:arm
```

Poi avviare `npm run dev` in WSLg/Debian e verificare first scan, restart senza
auto-rescan, manual rescan, Cancel, database XDG, corruption recovery,
WebKitGTK, shutdown e assenza di socket/processi residui. Sul Raspberry Pi 3B
restano obbligatori CPU/RAM reali, storage/SD, touch 1280×800, ALSA/USB DAC,
power-loss recovery e profilo analyzer `rpi3`.

## Stato repository

Il working tree contiene esclusivamente le modifiche Step 2.5 elencate da
`git status`; non è stato creato alcun commit e non è stata eseguita alcuna
operazione remota.
