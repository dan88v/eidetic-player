# Step 2.7 — Library Search and compact Library toolbar

Data: 2026-07-21  
Esito: completato sul working tree non committato, con il limite prestazionale estremo documentato sotto.

## Ambiente e baseline

- Windows, branch `main`, HEAD `132e991` (`Complete Cassette player`), sincronizzato con `origin/main` (`0 0`).
- Node `v24.18.0`, npm `11.16.0`.
- Baseline iniziale pulita; nessun merge/rebase in corso.
- Ultima Linux CI conosciuta: run `29788891003`, PASS sul commit `df2c08e`; non riguarda HEAD `132e991`, quindi la CI Linux di queste modifiche resta pending.

## Implementazione

- Search on-demand nell’header Library, con focus iniziale, minimo 2 caratteri, debounce 250 ms, Enter immediato, Clear, Escape, AbortController e sequence guard.
- Risultati raggruppati nell’ordine Artists → Albums → Tracks, conteggi, righe touch compatte e View all paginato. Una sola sentinella e massimo 192 nodi per categoria.
- Stato tipizzato in memoria di sessione: query, risultati, categoria, pagine e scroll; nessuna persistenza al riavvio. Back da View all e dai detail ripristina Search; chiudere Search ripristina segmento, Grid/List e scroll Library.
- Album e Artist riusano i detail esistenti. Add Track/Album/Artist resta nel menu secondario `⋯`. Unavailable resta visibile, attenuato e non azionabile.
- Toolbar root su una riga: segmented a sinistra, Grid/List solo per Albums e Manage Library vicino al toggle. Rescan/Cancel sono stati rimossi dalla root e restano esclusivamente in Manage Library.
- Corrette durante QA anche la doppia X nativa/custom del campo Search e la duplicazione dell’header in View all.

## Backend, API e query

- Nuovi contratti condivisi typed per pagine Search, grouped results, categorie e playback.
- Endpoint bounded:
  - `GET /api/library/search?q=&limitPerGroup=`;
  - `GET /api/library/search/{artists|albums|tracks}?q=&cursor=&limit=`;
  - `POST /api/library/search/play`.
- Limiti grouped: 5 Artists, 6 Albums, 8 Tracks; pagine standard 48, massimo backend 100; cursor keyset opaco legato alla query.
- Ranking deterministico: exact → prefix → word-prefix → contains; poi priorità campo, chiavi alfabetiche e ID persistente.
- Campi: Artist name; Album title/album artist; Track title/artist/album/album artist, con filename solo se manca il title metadata. Nessun path o dato tecnico nelle risposte.
- Normalizzazione NFKD, rimozione diacritici, punteggiatura/whitespace normalizzati e lowercase; `bjork`, `anti hero` e whitespace multiplo sono coperti dai test.
- Schema Library v2 con search-key materializzate e migrazione v1→v2 transazionale; scan/upsert mantiene le chiavi. La baseline con normalizzazione per riga era circa 227–442 ms p95 sul fixture, quindi la migrazione è motivata e testata.
- Search playback ricostruisce lato backend l’intero contesto corrente, esclude unavailable, ricontrolla fingerprint e file, risolve direttamente selectedIndex e usa l’unico percorso atomico `PlayerService`/MPV. Nessun contesto dipende dal DOM o dalla pagina caricata.

## Benchmark ed EXPLAIN

- Script riproducibile: `npm.cmd run benchmark:library-search`.
- Fixture: 10.000 Tracks, 1.000 Albums, 500 Artists, 104 unavailable, accenti, compilation, duplicati e metadata mancanti; DB 6.561.792 byte.
- P95 finali Windows grouped / prima pagina Track:
  - exact: `83,737 / 61,902 ms`;
  - prefix: `82,038 / 63,463 ms`;
  - word-prefix: `110,437 / 97,669 ms` (mediana grouped `67,492 ms`);
  - contains: `82,570 / 68,996 ms`;
  - accented: `76,584 / 56,723 ms`;
  - absent: `68,541 / 88,964 ms`.
- View all prima pagina: Artists `3,122 ms`, Albums `9,543 ms`, Tracks `99,986 ms` p95. Pagine successive: `3,490 / 11,789 / 94,799 ms`.
- Context p95 tipici: exact `74,052 ms`, word-prefix `90,296 ms`, contains `72,791 ms`; viene misurato separatamente e senza troncamento.
- Limite: la query volutamente molto comune che abbina 8.928/10.000 Tracks misura grouped `114,542 ms` e context completo di 8.834 file `180,636 ms` p95. Non viene dichiarata performance Raspberry Pi.
- `EXPLAIN QUERY PLAN` documenta scan delle tabelle e B-tree temporanei per l’ordinamento. Nessuna virtual table, trigger o FTS5: FTS resta rinviato e richiede approvazione separata.

## Test e build

- `npm.cmd ci`: PASS; `npm.cmd audit`: 0 vulnerabilità.
- `format:check`, `typecheck`, `lint`, `build`, `git diff --check`: PASS.
- Suite: 280 test, 278 PASS, 0 FAIL, 2 skip POSIX previsti.
- `mpv:doctor` e `ffmpeg:doctor`: PASS.
- MPV reale: 4/4 PASS; FFmpeg reale: 3/3 PASS.
- Build UI: 79 moduli; JS 182,49 kB (49,32 kB gzip), CSS 64,17 kB (10,99 kB gzip); font locali invariati.
- Test nuovi coprono migrazione, normalizzazione, ranking, campi, keyset/invalid cursor, unavailable/Source unavailable, assenza FTS, API/state/Search UI, toolbar, singolo SSE e playback contestuale.

## QA Neutralino e responsive

- Avvio reale con `npm.cmd run dev`, splash/bootstrap, backend 4310, Vite 5173, MPV e FFmpeg verificati nella finestra Neutralino/WebView2.
- Catalogo reale: 44 Tracks, 4 Albums, 5 Artists. Query `golden hour`: 1 Album e 13 Tracks.
- Tap sul secondo risultato `Butterflies`: Queue completa di 13 elementi e `currentQueueIndex = 1`, senza avvio dell’indice zero.
- Verificati grouped, View all, Back, query restaurata, Album detail e ritorno a Search, focus, stato a un carattere, no-results, Manage, Rescan e toast di completamento.
- La scansione reale di 44 file è terminata troppo rapidamente per osservare Cancel; cancellazione e stato cancelling restano coperti dai test automatici. Il catalogo reale aveva 0 unavailable; il caso unavailable è coperto dalle fixture automatiche.
- Ispezionati Default Player, Cassette Player, mini-player a due colonne e ripristino finale di Default. Il ciclo visualizer canonico e le altre baseline congelate sono coperti dalla suite di non regressione.
- Verificati realmente 1280×800, 1366×768, 1600×900, 1280×720 e 1024×600 sia su Search/View all sia sulla toolbar root: nessun overflow, overlap, riga vuota o contenuto sotto il mini-player.
- Il browser integrato non esponeva istanze; la QA è stata eseguita direttamente sulla finestra Neutralino tramite automazione e screenshot Windows.

## File

- Creati: `apps/backend/test/library-search.test.ts`, `apps/ui/test/step2.7.test.ts`, `scripts/library-search-benchmark.ts`, `prompts/step2.7_output.md`.
- Backend Search: `packages/shared/src/library.ts`, `apps/backend/src/index.ts`, `apps/backend/src/library/library-{database,migrations,normalization,repository,service}.ts`.
- Frontend Search/toolbar: `apps/ui/src/api/library-api-client.ts`, `apps/ui/src/components/icons.ts`, `apps/ui/src/i18n/en.ts`, `apps/ui/src/screens/library.ts`, `apps/ui/src/styles/screens.css`.
- Test aggiornati: `apps/backend/test/library-database.test.ts`, `apps/ui/test/step2.6.1.test.ts`.
- Documentazione: `docs/ui.md`, `docs/architecture.md`, `docs/development/{architecture,library-index,performance,testing}.md`, `package.json`.

## Cleanup e stato finale

- Chiusura reale completata: zero processi progetto Node, Neutralino, MPV o FFmpeg; zero listener 4310/5173; fixture e screenshot QA rimossi.
- Working tree intenzionalmente non committato; `git diff --check` PASS. La QA richiesta ha aggiornato soltanto lo stato runtime esterno dell’app (generazione/timestamp del catalogo dopo Rescan e sessione Queue con i 13 risultati); nessun media dell’utente è stato modificato.
- Nessun commit, push, merge, rebase, reset, restore, stash o clean eseguito.
- Nessun nuovo step (Favorites, Recently Played, Playlist, Vinyl Player o altro) iniziato.
