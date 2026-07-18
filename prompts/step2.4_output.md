# Step 2.4 — Local Sources & hierarchical library browser

Data: 2026-07-18

## Esito

Step 2.4 implementato senza procedere allo Step 2.5. Eidetic Player dispone ora
di Local Sources persistenti e di un browser Library gerarchico, lazy e
non ricorsivo. Le Queue keyed e le transizioni atomiche esistenti restano
l'unico percorso di apertura e playback.

La verifica automatica è completa. La verifica reale ha coperto backend,
persistenza, media, MPV, FFmpeg, apertura del dialogo nativo Neutralino e
shutdown. Il canale di controllo del WebView non era disponibile nella sessione:
Sources/Library responsive, breadcrumb, Back e scroll sono quindi coperti da
contratti automatici/CSS, ma non vengono dichiarati come osservati
interattivamente in tutte le viewport.

## Architettura

- `LocalFilesystemProvider` incapsula esclusivamente API Node standard.
- `PathService` centralizza semantica `path.win32`/`path.posix`, conversione
  logical/native, canonicalizzazione, case rules e containment.
- `SourceRepository` conserva JSON versionato con scrittura temporanea e rename
  atomico; un file corrotto viene preservato come `.corrupt-<timestamp>`.
- `SourceService` gestisce identità, disponibilità, deduplica, Rename display-only,
  Remove non distruttivo e Retry.
- `DirectoryBrowserService` esegue una sola `readdir` per livello, esclude
  hidden/system/symlink/junction, ordina directory prima e file audio dopo,
  mantiene una LRU di 32 directory e limita metadata/artwork a 2+2.
- `LibraryApiClient` è l'unico client UI per Sources/Library.
- `librarySession` conserva source, logical relative path, entry selezionata e
  scroll per directory senza path nativi.
- L'apertura Library risolve `sourceId + entryId`, costruisce la Queue naturale
  della directory e chiama `PlayerService.openResolvedQueue`.

Nessun database, watcher, polling, scansione ricorsiva, framework o dipendenza è
stato aggiunto.

## File creati

- `packages/shared/src/library.ts`
- `apps/backend/src/filesystem/filesystem-provider.ts`
- `apps/backend/src/filesystem/local-filesystem-provider.ts`
- `apps/backend/src/filesystem/path-service.ts`
- `apps/backend/src/filesystem/source-repository.ts`
- `apps/backend/src/filesystem/source-service.ts`
- `apps/backend/src/filesystem/directory-browser-service.ts`
- `apps/backend/src/filesystem/filesystem-errors.ts`
- `apps/backend/src/filesystem/filesystem-types.ts`
- `apps/backend/test/filesystem-path.test.ts`
- `apps/backend/test/directory-browser.test.ts`
- `apps/ui/src/api/library-api-client.ts`
- `apps/ui/src/state/library-session.ts`
- `apps/ui/test/library-browser.test.ts`
- `prompts/step2.4_output.md`

## File modificati

- `README.md`
- `apps/backend/src/index.ts`
- `apps/backend/src/player/player-service.ts`
- `apps/backend/test/mpv.integration.ts`
- `apps/ui/src/components/app-shell.ts`
- `apps/ui/src/components/icons.ts`
- `apps/ui/src/i18n/en.ts`
- `apps/ui/src/platform/browser-platform-bridge.ts`
- `apps/ui/src/platform/neutralino-platform-bridge.ts`
- `apps/ui/src/platform/neutralino-runtime.ts`
- `apps/ui/src/platform/platform-bridge.ts`
- `apps/ui/src/screens/index.ts`
- `apps/ui/src/screens/library.ts`
- `apps/ui/src/screens/sources.ts`
- `apps/ui/src/styles/responsive.css`
- `apps/ui/src/styles/screens.css`
- `apps/ui/test/platform.test.ts`
- `docs/architecture.md`
- `docs/ui.md`
- `docs/development/architecture.md`
- `docs/development/performance.md`
- `docs/development/testing.md`
- `docs/development/ui-ux.md`
- `scripts/generate-neutralino-config.ts`

## API

- `GET /api/sources`
- `POST /api/sources/local`
- `PATCH /api/sources/:sourceId`
- `DELETE /api/sources/:sourceId`
- `POST /api/sources/:sourceId/retry`
- `GET /api/sources/:sourceId/browse?relativePath=...`
- `GET /api/sources/:sourceId/entries/:entryId/metadata`
- `GET|HEAD /api/sources/:sourceId/entries/:entryId/artwork`
- `POST /api/sources/:sourceId/entries/:entryId/open`
- `GET /api/library/diagnostics`

Le risposte pubbliche contengono ID opachi e path logici. Root, path canonici,
stack, errno e path assoluti non compaiono nei nuovi contratti di risposta.

## Persistenza

Schema:

```json
{
  "version": 1,
  "sources": [
    {
      "id": "UUID",
      "type": "local",
      "displayName": "Music",
      "nativeRoot": "<backend-only>",
      "canonicalRoot": "<backend-only>",
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

Percorsi:

- Windows: `%APPDATA%\Eidetic Player\sources.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/eidetic-player/sources.json`

Le due sorgenti reali approvate risultano configurate e disponibili dopo un
riavvio reale dell'app.

## Sicurezza percorsi

I test coprono slash/backslash Neutralino, drive, UNC, POSIX, Unicode, spazi,
case-insensitive Windows, case-sensitive Linux, `/mnt/music`,
`/media/user/USB`, conversioni logical/native, null byte, segmenti vuoti,
separatori misti, `..`, path assoluti, drive/UNC logici, cross-drive,
collisioni `Music`/`MusicBackup`, containment canonico e symlink/junction.

La navigazione non segue link e non costruisce path tramite prefissi stringa.
Remove elimina solo il record JSON.

## UI

- Sources presenta Local Folders reali con Add Folder, Open, Rename, Remove e
  Retry condizionale.
- Rename/Remove usano un dialog accessibile con focus trap, Escape e ritorno
  focus; Remove esplicita che i file restano.
- USB Storage e Network Shares rimangono placeholder statici.
- Library separa griglia cartelle e lista audio a geometria fissa.
- Breadcrumb usa una lista ordinata accessibile e comprime i segmenti centrali
  su viewport strette.
- Back torna al padre e dalla root torna alle sorgenti.
- Il listing corrente resta visibile durante il caricamento successivo; il
  risultato viene applicato in un singolo commit.
- Metadata e artwork aggiornano le righe in place senza riordino.
- Il current track aggiorna solo classe e `aria-current`, senza rebuild.
- Directory, scroll ed entry selezionata restano nello stato sessione.

## Test automatici

- `npm test`: 128/128.
- Path/config/sources: normalizzazione multipiattaforma, traversal, persistenza
  atomica, recovery, deduplica, Rename display-only e Remove non distruttivo.
- Browser: listing one-level, nessuna ricorsione, filtri, natural sort, ID
  stabili, breadcrumb, parent/root, cache hit/invalidation, current e Queue
  esatta.
- UI: scroll/sessione, nessun rebuild current, commit directory unico, due
  worker metadata, geometria stabile, responsive e modal accessibile.
- MPV: 4/4.
- FFmpeg: 2/2.

## Test reali Windows e misure

Media usati in sola lettura:

- Richard Ashcroft FLAC: 12 entry.
- Taylor Swift MP3: 14 entry.
- Non sono stati riprodotti il quinto e l'ottavo FLAC.

Misure:

| Misura                                  |              Risultato |
| --------------------------------------- | ---------------------: |
| Add Source Richard, inclusa persistenza |               77,73 ms |
| Add Source Taylor, inclusa persistenza  |                6,35 ms |
| Caricamento Sources                     |                3,37 ms |
| Listing Richard cold                    |              194,39 ms |
| Listing Taylor cold                     |               28,09 ms |
| Cache hit Richard                       |                6,23 ms |
| Cache hit Taylor                        |                4,50 ms |
| Sei metadata/artwork lazy               |              236,73 ms |
| Concorrenza metadata massima            |                      2 |
| Concorrenza artwork massima             |                      2 |
| Cache misurata, una directory           |            11.904 byte |
| Apertura nona MP3                       |               56,79 ms |
| Queue nona MP3                          |          indice 8 / 14 |
| Primo indice MP3 osservato via SSE      |                 solo 8 |
| FLAC valido aperto                      |    nono, indice 8 / 12 |
| Full rebuild Library su player tick     | 0 nel percorso testato |
| Processi residui finali                 |                      0 |

Ulteriori risultati:

- persistenza verificata dopo arresto e nuovo avvio Neutralino;
- risposta Sources/browse verificata senza path assoluti;
- metadata e artwork reali presenti sugli MP3;
- Previous/Next e `trackTransitionId` hanno mantenuto la macchina atomica;
- Rename Taylor seguito da Remove ha lasciato invariati esistenza e byte del
  file campione; la sorgente è stata poi riaggiunta;
- unavailable è stato simulato spostando una fixture temporanea, Retry ha
  riportato `unavailable`, poi `available` dopo ripristino;
- il dialogo reale `os.showFolderDialog` si è aperto nel runtime Neutralino;
- snapshot nativo Now Playing a 1280x800: superficie scura stabile, nessun frame
  bianco;
- chiusura app e fixture temporanee: cleanup completato.

Il controllo interattivo del WebView non era disponibile. Non dichiaro quindi
come osservati manualmente nelle cinque viewport i layout Sources/Library, il
ritorno scroll o il layout shift Library; questi aspetti hanno copertura
automatica e CSS responsive, ma restano da confermare visivamente sul display.

## Controlli finali

- `npm audit`: 0 vulnerabilità.
- `npm run format:check`: OK.
- `npm run typecheck`: OK.
- `npm run lint`: OK.
- `npm run build`: OK.
- `npm test`: 128/128.
- `npm run mpv:doctor`: OK, MPV `v0.41.0-744-g304426c39`.
- `npm run ffmpeg:doctor`: OK, build 2026-07-16.
- `npm run test:mpv`: 4/4.
- `npm run test:ffmpeg`: 2/2.
- Config Neutralino finale ripristinata in modalità development.
- Node progetto, Neutralino, MPV e FFmpeg residui: 0.

## Bundle

| Asset |        Prima Step 2.4 |         Dopo Step 2.4 |     Differenza |
| ----- | --------------------: | --------------------: | -------------: |
| HTML  |   0,49 kB / 0,30 gzip |   0,49 kB / 0,30 gzip |      invariato |
| CSS   |  30,66 kB / 5,89 gzip |  38,22 kB / 6,83 gzip |  +7,56 / +0,94 |
| JS    | 69,63 kB / 20,81 gzip | 86,87 kB / 25,06 gzip | +17,24 / +4,25 |

## Regressioni controllate

`playerSessionId`, `trackTransitionId`, `TrackTransitionCoordinator`,
preparazione playlist atomica, Queue keyed, artwork generation guard, waveform,
visualizer, mini-player, superfici scure e assenza di EventSource aggiuntivi
restano preservati.

## Limiti

- Linux è coperto da semantica/test `path.posix` e XDG, non da runtime reale.
- USB e Network Shares non hanno provider, detection o mount.
- Nessuna indicizzazione, ricerca, vista Artist/Album/Genre, watcher, scansione
  ricorsiva, thumbnail, tag editing, Queue restore o playback restore.
- Il browser mantiene listing di sessione; non è un catalogo persistente.
- La verifica visuale/interattiva completa Sources/Library nelle cinque
  viewport resta da eseguire quando il controllo WebView è disponibile.
