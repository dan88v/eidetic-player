# Step 2.6 — Library browsing

Step 2.6 è completato nel worktree, senza commit, push, merge o rebase. La Library ora consente di esplorare Album, Artisti e Tracce e di usare i contesti indicizzati attraverso il percorso reale Neutralino → backend → PlayerService → MPV.

## Risultato

- Ho aggiunto contratti condivisi tipizzati e REST per pagine Album/Artisti/Tracce, dettagli Album/Artista, artwork opaco e comandi Play/Add. Le risposte di browsing non contengono root, path nativi, path logici, buffer o base64.
- Le query SQLite usano ordinamenti deterministici e cursori keyset base64url opachi, con pagina predefinita 48 e limite massimo 100. Non sono stati aggiunti schema, migration, indici, dipendenze native o runtime.
- I dettagli Album rispettano disco, numero traccia, titolo e ID stabile. Gli Artisti uniscono contributi diretti e proprietà album-artist, deduplicano per Track ID, gestiscono compilation e mantengono in coda stabile le tracce senza album.
- La disponibilità effettiva combina Track, Source e file reale. I contesti vengono risolti interamente prima di mutare la coda, ricontrollano il fingerprint del catalogo, containment, file regolare e leggibilità con otto worker limitati, escludono gli unavailable e riusano esclusivamente `PlayerService`.
- Il play diretto di una traccia porta `selectedTrackId` al backend e apre subito l’indice risolto, senza avviare brevemente il primo elemento. Add usa la coda esistente e non interrompe la riproduzione.
- L’artwork Library riusa `MetadataService`, `ArtworkService`, registry, cache e limiti già esistenti; le superfici hanno geometria riservata e l’immagine diventa visibile solo dopo `decode()`.
- La UI touch-first conserva separatamente segmento Library e vista Album Grid/List. Include dettagli interni Album/Artista, titolo top-bar contestuale, Back con ripristino dello scroll, menu sibling semantici, stato unavailable disabilitato, paginazione e limite di 192 nodi.
- Scan summary, Rescan/Cancel e unico EventSource restano in place. Il progresso non ricarica le entità; solo il completamento invalida le pagine Library correnti.
- Durante la QA ho trovato e corretto un difetto reale: il dettaglio Artista ereditava lo scroll della lista e poteva aprirsi a metà. Ora ogni dettaglio parte dall’alto e Back ripristina la posizione di provenienza; è presente un test di regressione dedicato.
- Sono aggiornati README, architettura, UI, performance, testing e guida Indexed Library.

## Verifiche automatiche

| Verifica                    | Esito                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| `npm.cmd ci`                | PASS, 212 package verificati                                       |
| `npm.cmd audit`             | PASS, 0 vulnerabilità                                              |
| `npm.cmd run format:check`  | PASS                                                               |
| `npm.cmd run typecheck`     | PASS                                                               |
| `npm.cmd run lint`          | PASS                                                               |
| `npm.cmd run build`         | PASS, 63 moduli                                                    |
| `npm.cmd test`              | PASS: 215 totali, 213 pass, 2 skip POSIX attesi su Windows, 0 fail |
| Test focalizzati Step 2.6   | PASS: 10/10                                                        |
| `npm.cmd run mpv:doctor`    | PASS, MPV v0.41.0 e JSON IPC                                       |
| `npm.cmd run test:mpv`      | PASS: 4/4                                                          |
| `npm.cmd run ffmpeg:doctor` | PASS                                                               |
| `npm.cmd run test:ffmpeg`   | PASS: 3/3                                                          |
| `git diff --check`          | PASS                                                               |

La copertura nuova comprende query/cursori, confini pagina, ordering, dettagli multi-disc, compilation e album-artist, join duplicati, coda album-less, disponibilità effettiva, Source rimossa, assenza di path pubblici, contesti Queue, selected index, persistenza UI, semantica touch, limite DOM, singolo SSE e scroll dei dettagli.

## QA Windows reale

La QA è stata eseguita più volte con `npm.cmd run dev` nella finestra Neutralino/WebView2 reale a 1280×800, 1366×768, 1600×900, 1280×720 e 1024×600. Grid a quattro colonne, List, Album detail, Artist list/detail, Tracks, menu, artwork, mini-player e layout non hanno mostrato overflow orizzontale, flash bianchi o collassi dei target.

- Album Play ha creato 10 elementi; il tap su una traccia non iniziale ha aperto direttamente l’indice 3.
- Tracks Play ha creato 44 elementi e aperto direttamente “Anti-Hero” all’indice 4.
- Artist Play All ha creato 13 elementi e avviato “Slow Burn” all’indice 0.
- Add Album ha portato la coda da 10 a 23 mantenendo “Bittersweet Symphony” corrente e in riproduzione.
- Un rescan reale di 44 tracce è terminato senza interrompere “Slow Burn” e senza smontare la lista; il catalogo è rimasto 44/4/5/0.
- Folders popolato, ripristino sessione, mini-player e navigazione sono rimasti invariati. Cinque cambi consecutivi del visualizzatore hanno mantenuto un solo MPV e al massimo un FFmpeg.
- Il riavvio ha confermato la persistenza indipendente del segmento Library e della vista Album.
- Nessun file musicale è stato modificato, rinominato o eliminato.

Il catalogo reale aveva zero elementi unavailable. Per non alterare media o configurazione persistente dell’utente, la UI unavailable reale non è stata forzata: filtro dei contesti, entità parziali/totali, Source rimossa e fallimento prima della mutazione Queue sono coperti da fixture temporanee automatiche.

## Misure Windows

Mediane REST reali su catalogo 44 tracce, sette campioni caldi:

| Operazione                            |                Mediana |
| ------------------------------------- | ---------------------: |
| Albums / Artists / Tracks             |  3,76 / 3,36 / 9,89 ms |
| Album detail / Artist detail          |         4,96 / 4,07 ms |
| Queue context Album / Artist / Tracks | 8,10 / 7,20 / 19,92 ms |
| Play Tracks con selected index        |              140,33 ms |

Il play selezionato reale ha risolto “Lonely Weekend” all’indice 17 di 44. Sul fixture sintetico da 1.000 tracce: prima/seconda pagina Album 3,91/2,47 ms, Artists 1,05 ms, Tracks 5,18 ms, Album/Artist detail 1,16/11,72 ms, contesti catalogo Album/Artist/Tracks 1,63/8,20/16,21 ms e heap backend 18.552.352 byte. Sono misure desktop Windows, non evidenza Raspberry Pi 3B.

Il database reale è 118.784 byte, integro, schema v1, WAL, apertura 76,81 ms, migrazione no-op 0,29 ms e concorrenza scanner massima 1. Vite ha riportato ready in 575 ms; non è stata ricavata una misura affidabile end-to-end fino al primo frame della finestra.

Bundle produzione: JS 135,37 kB / 37,91 kB gzip e CSS 52,60 kB / 8,95 kB gzip. Rispetto a Step 2.5: +14,41 kB / +3,35 kB gzip JS e +7,12 kB / +0,91 kB gzip CSS.

## Cleanup, CI e limiti

Dopo lo shutdown controllato risultano zero processi Node dell’app, Neutralino, MPV e FFmpeg, zero listener 4310/5173; `library.db` si apre con condivisione esclusiva, quindi non resta alcun handle SQLite dell’app.

Branch `main`, baseline `b227b61`, divergenza iniziale da `origin/main` 0/0. La run Linux upstream della baseline è verde ([GitHub Actions run 29722419996](https://github.com/dan88v/eidetic-player/actions/runs/29722419996)). Il codice Step 2.6 non è stato pubblicato per rispettare il divieto di push: la sua CI Linux resta quindi PENDING e non dichiaro Linux PASS. Non erano richiesti WSL manuale, nuove migration o dipendenze native.

La skill browser non ha trovato un browser collegato (`browsers: []`); l’ispezione è stata quindi svolta direttamente sulla vera finestra Neutralino con screenshot OS. Splash/bootstrap sono coperti dalla suite e il bootstrap reale è riuscito, ma non è stato catturato un frame dello splash nella finestra temporale breve.

File finale: [prompts/step2.6_output.md](C:/Users/dan88/Desktop/eidetic-player/prompts/step2.6_output.md)
