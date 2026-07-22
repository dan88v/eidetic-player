# Step 2.7.1 — Sources, Library Search playback e Queue refinements

## Esito

Step completato sul working tree non committato, senza commit o push.

- La toolbar Sources mostra `Rescan Library` a sinistra e `Add Folder` a destra. Durante uno scan usa lo stato globale già esistente per esporre `Cancel Scan`; Add Folder resta disponibile.
- Una Source nuova accoda un solo auto-scan della Source stessa nel scheduler seriale esistente. Le richieste pending sono deduplicate e la rimozione della Source elimina l'eventuale pending.
- La toolbar Library resta su una riga: segmenti a sinistra, poi Search, Manage Library e Grid/List a destra. Grid/List compare solo in Albums; il campo Search usa l'altezza touch standard di 56 px.
- Il Play di una Track Search non dipende più dalla query: una Track con Album ricostruisce l'Album corrente e parte dalla Track selezionata; una Track senza Album crea una coda singola. Add to Queue aggiunge soltanto la Track.
- Album e Artist Search aprono il dettaglio dalla riga e offrono rispettivamente `Play album` e `Play all`, conservando le azioni Add.
- `Add files` è stato rimosso soltanto dal Queue drawer; apertura file generale e drag-and-drop restano disponibili dalle superfici preesistenti.
- Contratti, benchmark, documentazione architetturale, UI, performance e testing sono stati allineati. L'endpoint Search-play basato sulla query è stato rimosso.

## Regressioni automatizzate

- Aggiunto `apps/ui/test/step2.7.1.test.ts` e aggiornati i test mirati di backend, scheduler, browsing, search, service e UI.
- Test mirati: 47/47 PASS.
- Suite completa: 286 test, 284 PASS, 0 fail, 2 skip POSIX attesi su Windows.
- Benchmark Library con 10.000 Track / 1.000 Album / 500 Artist: context Album p95 massimo 8,737 ms; ricerca grouped comune p95 72,715 ms; ricerca Tracks comune p95 61,161 ms.

## Verifiche eseguite

- `npm.cmd ci`: PASS.
- `npm.cmd audit`: 0 vulnerabilità.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd test`: PASS.
- `npm.cmd run mpv:doctor`: PASS.
- `npm.cmd run ffmpeg:doctor`: PASS.
- `npm.cmd run test:mpv`: 4/4 PASS.
- `npm.cmd run test:ffmpeg`: 3/3 PASS.
- `git diff --check`: PASS.

## QA Windows reale

Eseguita con `npm.cmd run dev` nella finestra Neutralino/WebView2 reale.

- Sources: ordine toolbar, Rescan, stato/cancellazione globale e assenza di scanner concorrenti verificati. Il picker nativo Add Folder è stato aperto e annullato; poiché l'automazione Windows non esponeva il dialogo a PrintWindow, l'aggiunta/rimozione della Source isolata è stata completata attraverso lo stesso backend reale.
- Fixture `%TEMP%` con compilation, Track album-less e successiva Track unavailable: auto-scan della sola Source completato; album-less = coda singola; compilation = Album di due Track con indice selezionato 1; unavailable = HTTP 409 e Queue/revision invariate. Source e media temporanei rimossi.
- Search: focus, grouped results, menu Track/Album/Artist e Clear verificati. Una Track reale di Album ha prodotto la Queue completa di 13 elementi con la Track selezionata all'indice corretto; Add ha prodotto una sola Track.
- Queue: `Add files` assente, Clear e stato vuoto verificati. Il riordino non è stato aggiunto perché non esisteva nel baseline ed è esplicitamente fuori scope nella documentazione corrente; remove, revision e scroll restano coperti dalla suite preesistente.
- Non regressioni: Manage Library, Sources/Folders, Default Player, Cassette Player, mini-player e controlli principali ispezionati. Il Player Default è stato ripristinato dopo la verifica Cassette.
- Responsive reale verificato a 1280×800, 1366×768, 1600×900, 1280×720 e 1024×600: nessun overflow/overlap, seconda riga, contenuto sotto il mini-player o layout shift osservato.

## Note finali

- Nessuna run CI Linux post-push è dichiarata: non è stato effettuato alcun push. L'ultima run documentata appartiene a un commit precedente.
- La precedente assenza del riordino Queue è stata preservata, coerentemente con il vincolo di non ampliare Queue/PlayerService in questo step.
- Shutdown e cleanup finali: nessun processo o listener del progetto, fixture, Source temporanea o screenshot QA residuo.
