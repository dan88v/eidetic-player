# Step 2.4.1 — Folders UI polish & folder actions

Data: 2026-07-19

## Esito

Step 2.4.1 completato senza procedere allo step successivo. La navigazione
filesystem è ora una sezione autonoma chiamata Folders; Library è una rotta
separata con placeholder, pronta per il futuro database. Folders offre root
minimale, sorting e viste List/Grid persistenti, conteggi, anteprime reali,
azioni Play/Add to Queue su cartelle e singoli brani e qualità audio compatta.
I path nativi restano backend-only e non sono state aggiunte dipendenze,
immagini generate, scansioni ricorsive, watcher o database.

## UI Folders e Library

- La root non mostra Back, breadcrumb, hero, descrizione o Add Folder.
- In assenza di sorgenti mostra `No folder sources configured.` e
  `Open Sources`.
- La preferenza `FolderViewMode` usa la chiave
  `eidetic-player.interface.folder-view`, con migrazione dalla vecchia chiave;
  `FolderSortMode` usa `eidetic-player.interface.folder-sort`.
- List/Grid cambia soltanto `data-folder-view`: non esegue browse, metadata,
  artwork, rebuild o reset dello scroll.
- Il sorting, disponibile a sinistra della toolbar in root e directory, offre
  nome A–Z/Z–A e numero file crescente/decrescente.
- Sorgenti e cartelle condividono card più grandi con artwork e body cliccabili,
  nome su due righe, conteggio dei file audio diretti e menu sibling
  `Open` / `Play now` / `Add to Queue`; il Play sovrapposto è stato rimosso.
- Il menu supporta focus iniziale, Escape, focus restoration, click esterno e
  target touch.
- L'header directory dispone Back, titolo `font-size-lg`, sorting, List/Grid e
  Play; la seconda riga contiene soltanto gli antenati e non duplica la cartella
  corrente.
- La lista audio resta separata e stabile. Metadata, artwork e qualità vengono
  aggiornati in place con due worker senza riordino. Ogni riga conserva il click
  principale per la riproduzione e aggiunge un menu sibling `…` con Play now e
  Add to Queue.
- Gli empty state distinguono cartella vuota e assenza di audio supportato.
- Status e breadcrumb vuoti non riservano altezza.
- Now Playing espone pulsanti distinti Library/Folders e non mostra più Open
  Files nello stato iniziale. La Home rimane in basso a destra e riceve un
  trattamento circolare coerente con l'accent color.

## Anteprime cartella

`FolderArtworkPreviewService`:

- legge soltanto i figli diretti;
- esclude file non audio e symlink/junction;
- ordina naturalmente e campiona al massimo i primi 8 audio;
- usa prima `cover`, `folder`, `front` JPEG/PNG/WebP case-insensitive;
- in assenza di sidecar raccoglie fino a 4 artwork embedded unici;
- restituisce soltanto `ArtworkRef` opachi;
- limita a 2 le risoluzioni concorrenti;
- mantiene una LRU di 32 record keyed da source, logical path e revision;
- non conserva buffer/base64 e non genera thumbnail o nuovi asset.

La UI usa un solo `IntersectionObserver` con margine di prossimità e una cache
bounded di 32 preview. Una reference produce cover uniforme; più reference
producono mosaico.

## Azioni cartella e Queue

- Play risolve gli audio diretti in ordine naturale, sostituisce atomicamente la
  Queue, seleziona l'indice 0, avvia MPV e apre Now Playing.
- Add to Queue aggiunge soltanto gli audio diretti, deduplica e resta in
  Folders.
- Il menu della singola riga usa un endpoint dedicato e aggiunge esattamente
  quel file senza espandere la directory.
- Se la Queue è vuota, l'append viene staged nel `PlayerService`: nessun current
  track, playback fermo, `trackTransitionId` invariato, Queue keyed pronta.
- Un append logico produce un solo incremento di `queueRevision`.
- La Queue staged supporta remove, clear, artwork lazy e avvio esplicito di un
  indice; l'avvio materializza poi la playlist MPV attraverso il percorso
  atomico esistente.
- I controlli vengono disabilitati durante la singola azione per evitare doppi
  submit.

## Metadata e dialog Sources

`LibraryMetadataSummary` espone anche codec, container, bitrate, sample rate,
bit depth, lossless e VBR nullable usando lo stesso parse lazy già esistente.
La UI rende esempi come `MPEG · 320 kbps` e
`FLAC · 16-bit · 44.1 kHz`, senza inventare zeri.

Il dialog Remove Source rimuove completamente dal DOM il campo Source name,
include il display name nel titolo, mantiene `files are not deleted`, mette il
focus iniziale su Cancel e conserva Escape/focus trap/focus restoration.

## API aggiunte

- `GET /api/sources/:sourceId/folder-artwork?relativePath=...`
- `POST /api/sources/:sourceId/directory/play`
- `POST /api/sources/:sourceId/directory/queue`
- `POST /api/sources/:sourceId/entries/:entryId/queue`

Le richieste usano soltanto source ID e path logici validati. Le risposte non
contengono root, path assoluti, buffer o base64.

## Test automatici e reali

- `npm test`: 137/137.
- `npm run typecheck`: OK.
- `npm run lint`: OK.
- `npm run format:check`: OK.
- `npm audit --audit-level=high`: 0 vulnerabilità.
- `npm run build`: OK.
- `npm run mpv:doctor`: MPV
  `v0.41.0-744-g304426c39`, IPC headless OK.
- `npm run test:mpv`: 4/4, inclusa Queue staged vuota.
- `npm run ffmpeg:doctor`: build 2026-07-16, esecuzione OK.
- `npm run test:ffmpeg`: 2/2.

Copertura nuova:

- sidecar prioritario e preview opaca;
- conteggio direct-only, sample bound e nessun path nativo;
- Queue diretta della cartella in natural sort;
- unsupported empty state;
- persistenza List/Grid senza richieste;
- root minimale;
- controlli folder sibling e menu accessibile;
- sorting, conteggio file, artwork Open e assenza del Play sovrapposto;
- menu sibling dei brani e risoluzione sicura del singolo entry path;
- rotte distinte Folders/Library e assenza di Open Files nel Now Playing vuoto;
- qualità MP3/FLAC e fallback senza valori inventati;
- Remove Source senza campo nome;
- MPV reale: append su Queue vuota senza current/playback/transition e con un
  solo incremento della revision.

## Verifica reale delle sorgenti configurate

La verifica è stata eseguita in sola lettura. Nessun file o record Source è
stato modificato e nessun brano è stato riprodotto.

| Sorgente                                 | Audio | Browse cold | Preview                 | Preview cold | Qualità campione         |
| ---------------------------------------- | ----: | ----------: | ----------------------- | -----------: | ------------------------ |
| Richard Ashcroft — Acoustic Hymns Vol. 1 |    12 |    17,30 ms | single, 1 ref, sample 8 |      9,56 ms | FLAC · 16-bit · 44.1 kHz |
| Taylor Swift — Midnights Deluxe          |    14 |     7,18 ms | single, 1 ref, sample 8 |    230,85 ms | MPEG · 320 kbps          |
| Kacey Musgraves — Golden Hour            |    13 |     8,84 ms | single, 1 ref, sample 8 |      7,07 ms | MPEG · 320 kbps          |

## Verifica visuale Neutralino

La verifica è stata eseguita avviando il runtime completo con
`npm.cmd run dev` a 1296 × 839. Sono stati osservati direttamente:

- Now Playing vuoto e apertura del menu laterale;
- Folders root in Grid, con sorting, card più grandi, artwork reali e conteggi;
- persistenza List dopo apertura di una sorgente e ritorno alla root;
- apertura della cartella direttamente dall'artwork;
- header directory compatto e righe FLAC con metadata/artwork;
- menu riga Play now / Add to Queue, senza avviare il brano;
- placeholder Library separato;
- Now Playing vuoto con Library/Folders, senza Open Files;
- Home circolare confermata in basso a destra;
- Sources e dialog Remove con nome, avviso e soli Cancel/Remove.

La verifica live ha individuato e corretto due difetti che i test strutturali
non rilevavano:

1. il `display: grid` dell'header sovrascriveva l'attributo `hidden`, lasciando
   Back visibile alla root; ora gli header hidden hanno `display: none`;
2. la qualità audio ereditava la vecchia colonna da 5 rem e andava a capo; ora
   dispone di una colonna da 11 rem non spezzabile, mentre resta nascosta sotto
   50 rem;
3. la semantica Library/Folders era ancora condivisa: ora route, sessione,
   client, screen, classi HTML/CSS e storage corrente sono distinti; resta solo
   la lettura della vecchia chiave storage come migrazione compatibile.

Non sono state confermate azioni distruttive e non è stato avviato alcun brano.

## Bundle

| Asset |              Step 2.4 |            Step 2.4.1 |    Differenza |
| ----- | --------------------: | --------------------: | ------------: |
| HTML  |   0,49 kB / 0,30 gzip |   0,49 kB / 0,30 gzip |     invariato |
| CSS   |  38,22 kB / 6,83 gzip |  40,99 kB / 7,29 gzip | +2,77 / +0,46 |
| JS    | 86,87 kB / 25,06 gzip | 95,79 kB / 27,67 gzip | +8,92 / +2,61 |

## Regressioni e limiti

Restano preservati `playerSessionId`, `trackTransitionId`, apertura atomica,
Queue keyed, current-row in place, metadata/artwork generation guards,
waveform, visualizer, mini-player e superfici scure.

Non sono stati introdotti indice persistente, ricerca Artist/Album/Genre,
ricorsione, watcher, artwork online, thumbnail generation, provider USB/rete,
tag editing, Queue restore o playback restore. La verifica runtime Linux e il
controllo visuale di tutte le ulteriori viewport target restano fuori dalla
copertura reale di questa sessione.

Le opzioni utente per mostrare/nascondere Folders e Library sono rinviate allo
step della Library a database: la separazione di route e controlli realizzata
qui ne costituisce il prerequisito, senza introdurre ora un'impostazione priva
del secondo flusso funzionale.
