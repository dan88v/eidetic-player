# Step 2.8 â€” Favorite Tracks

## Risultato

Implementati Favorite Tracks locali e persistenti, senza iniziare Favorite
Albums/Artists o Step 2.8.1. La nuova route principale `Favorites` segue
Library nella navigazione ed Ã¨ visibile soltanto quando Music browsing consente
Library.

## Schema v3

- `favorite_tracks(track_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`;
- FK verso l'ID Track opaco con `ON DELETE CASCADE`: Source offline/rimossa
  conserva Track e Favorite, mentre una Track realmente eliminata non lascia
  orfani;
- indice `favorite_tracks_created_idx(created_at DESC, track_id ASC)` usato dal
  query plan newest-first;
- migration v2â†’v3 e v1â†’v2â†’v3 nello stesso `BEGIN IMMEDIATE` transazionale;
- nessuna duplicazione metadata e nessuna modifica ai file audio.

## API e performance

- `GET /api/library/favorites/tracks` con limite 48, massimo backend 100,
  cursore keyset opaco e conteggi totale/disponibile;
- `PUT|DELETE /api/library/favorites/tracks/:trackId` idempotenti;
- `POST /api/library/favorites/tracks/status`, massimo 192 ID;
- `POST /api/library/favorites/tracks/play`, con selezione opzionale;
- risposta priva di Source/path nativi;
- cache frontend LRU da 512 Track, richieste status batch fino a 192 ID, nessun
  N+1, polling, localStorage o nuovo EventSource;
- pagina UI da 48 e massimo 192 righe montate con una sentinella.

## UI, cuore, menu e toast

- schermata Tracks-only con Play all, empty state approvato, artwork, metadata,
  durata, unavailable, cuore pieno e menu;
- nessuna Search, Grid/List, hero, statistiche o segmented monopzione;
- cuore semantico sibling del Play, hit area 44 px, `aria-pressed`, label
  Add/Remove dinamica, update ottimistico e rollback errore;
- cuore presente in Library Tracks, Album detail, Artist detail, Search grouped,
  Search View all, Favorites e Queue indicizzata;
- Queue espone il cuore soltanto tramite `libraryTrackId` backend esplicito,
  mai inferito da path, filename, titolo o durata;
- il cuore non mostra toast di successo; il menu usa `Added to Favorites` /
  `Removed from Favorites`; entrambi usano lo store condiviso e il toast host
  esistente;
- unavailable resta visibile e removibile, ma Play/Add to Queue sono
  disabilitati.

### Correzioni visuali successive

- corretto l'allineamento delle righe Favorites: numero Track, titolo e durata
  occupano ora le stesse colonne stabili delle righe Library anche alle
  viewport responsive;
- mini-player e main player Default mostrano un piccolo cuore pieno, passivo e
  non interattivo accanto al titolo quando la Queue corrente espone un
  `libraryTrackId` confermato come Favorite;
- l'indicatore usa lo stesso store condiviso, si aggiorna in-place e non crea
  polling, richieste duplicate o nuovi controlli touch;
- Technical mostra le intestazioni `CREST (dB)` e `LUFS-S (dB)`; le unità
  `dB` e `LUFS` accanto ai due valori variabili sono state rimosse e il valore
  LUFS-S torna allineato al margine destro.
- il pulsante Favorites `Play all` usa ora layout inline non restringibile e
  `white-space: nowrap`, quindi icona e testo restano su una sola riga;
- verificati i quattro Favorite reali: titoli e metadata API sono Unicode
  integri. Corretti nella UI Favorites il separatore mojibake `Â·`, l'em dash
  della durata assente e l'ellissi di caricamento; una regressione vieta le
  sequenze corrotte nella sezione;
- tutte le sottopagine Library con Back (Search, View all, Manage, Album e
  Artist detail) adottano la classe riutilizzabile
  `library-sticky-back-header`; la stessa regola è documentata per le future
  sottopagine.

## Playback Favorites

Il backend ricostruisce tutte le Favorite disponibili nell'ordine corrente,
deduplica per Track ID, rivalida Source/file, calcola direttamente
`selectedIndex` e sostituisce la Queue una volta sola. Play all seleziona zero;
tap/menu su una Track seleziona direttamente quella Track anche oltre la pagina
DOM. Add to Queue risolve soltanto la singola Track. Rimuovere un Favorite non
modifica Queue, current o `trackTransitionId`.

## File modificati

- contratti: `packages/shared/src/library.ts`, `player.ts`;
- backend: migration/database repository/service, REST routing, Queue origin e
  session restore;
- frontend: API client, Favorite store/button/indicatore/screen,
  navigation/shell, Default e mini-player, Technical renderer, Library Track
  rows, Queue drawer, i18n e CSS;
- test: database migration, Favorite repository/store/UI e aspettative Step
  2.6/2.7 aggiornate;
- documentazione: Library index, UI/UX e testing.

## Test automatici

Passano:

- `npm.cmd run format:check`;
- `npm.cmd run typecheck`;
- `npm.cmd run lint`;
- `npm.cmd run build`;
- `npm.cmd test`: 303 test, 301 pass, 2 skip POSIX attesi su Windows, 0 fail;
- `npm.cmd run mpv:doctor` e `npm.cmd run ffmpeg:doctor`;
- `npm.cmd run test:mpv`: 4/4 pass;
- `npm.cmd run test:ffmpeg`: 3/3 pass;
- `git diff --check`.

Copertura specifica: migration v1/v2â†’v3, FK/recovery, idempotenza, timestamp,
tie-breaker, cursor, limite, query plan, unavailable, no path, batch status,
rollback ottimistico, route/visibility, semantica cuore, Queue con Track ID,
empty state, testo Unicode pulito, Play all non-wrapping, header Back sticky e
contesto playback completo.

## QA reale Windows

Eseguito `npm.cmd run dev` con Neutralino, backend reale, database SQLite e MPV:

- REST keyset reale: pagina 2+1, ordine newest-first e batch status coerente;
- tap simulato su Favorite non iniziale: Queue 3, `selectedIndex=1`, current
  `libraryTrackId` esatto senza avvio transitorio della prima Track;
- rimozione Favorite durante playback: Queue, current e transizione invariati;
- fixture unavailable temporanea: Favorite ancora visibile, totale 2 /
  disponibile 1, selected Play rifiutato con Queue/current invariati;
- Play all ha escluso unavailable e creato Queue 1/1;
- Add to Queue ha aggiunto una sola Track e lasciato current invariato;
- database e sessione utente copiati prima della QA e ripristinati dopo:
  `quick_check=ok`, schema originale v2, 44 Track;
- shutdown backend con SIGTERM, zero listener 4310/5173, zero processi progetto,
  MPV, FFmpeg o Neutralino; cartella QA rimossa.

La WebView Neutralino Ã¨ stata avviata, ma il runtime Browser integrato non ha
esposto alcuna sessione controllabile (`agent.browsers.list() = []`). Non Ã¨
quindi stato possibile certificare tramite ispezione automatizzata le viewport
1280Ã—800, 1280Ã—720 e 1024Ã—600, nÃ© le interazioni visive cuore/menu/toast. Non Ã¨
stato sostituito questo controllo con headless. Nei log di playback due file
utente indicizzati hanno prodotto errori metadata/FFmpeg per contenuto audio
non decodificabile; Favorites ha mantenuto l'atomicitÃ  e i dati utente sono
stati ripristinati.

Una seconda esecuzione reale di `npm.cmd run dev` ha verificato dopo le
correzioni l'avvio con backend `ok`, frontend HTTP 200 e shell Neutralino. Il
runtime Browser non ha ancora esposto una sessione controllabile, quindi non si
attribuisce a questa prova una certificazione automatizzata della resa
1280 x 800. La sessione è stata chiusa con zero listener 4310/5173 e zero
processi Eidetic/MPV residui; database, WAL, sessione e sorgenti sono stati
ripristinati con hash identici al backup e la cartella QA temporanea è stata
rimossa.

Una successiva QA reale ha verificato nuovamente backend `ok`, frontend 200,
shell Neutralino e i quattro Favorite reali, inclusa `Bittersweet Symphony`.
Il runtime Browser è rimasto privo di sessioni (`[]`), quindi la resa visuale
non è certificata tramite automazione della WebView. L'istanza è stata chiusa
con zero listener/processi residui; database, sessione e Sources sono stati
ripristinati con hash identici e il backup temporaneo è stato rimosso.

Il salto segnalato su `Lucky Man` non dipende da Eidetic Player. La decodifica
integrale FFmpeg trova più frame FLAC invalidi (`invalid residual`,
`invalid subframe padding`); nell'area segnalata i timestamp audio passano da
circa 128,64 s a 140,99 s, un vuoto di circa 12,35 s. MPV conferma inoltre il
fallimento della lettura timestamp nel mezzo del file. Come richiesto, il file
utente e il comportamento di playback non sono stati modificati.

## Non regressioni e stato

Suite passata per Library Search, Album/Artist detail, Sources/scanner, Queue e
Clear Queue, session restore, Default/Cassette/mini-player, Technical/toast,
visualizer, artwork e waveform. Linux CI resta pending. Nessun commit o push Ã¨
stato eseguito. Step 2.8.1 non Ã¨ stato iniziato.
