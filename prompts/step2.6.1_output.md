# Step 2.6.1 — esito finale

Data: 21 luglio 2026. Esito: completato nel worktree, senza commit, push, merge o rebase. La richiesta successiva «il toast non deve avere pulsanti» prevale sulla specifica iniziale: la notifica di scansione è ora interamente passiva, senza Manage, dismiss o altri controlli. Le azioni Rescan/Cancel e Manage Library restano nelle superfici Library.

## Ambiente e baseline

- Clone Windows: `C:\Users\dan88\Desktop\eidetic-player`.
- Branch: `main`.
- HEAD iniziale e finale: `5f7cd625380a0e63d8f3c381e7d6f3a5c4cfa5cc`.
- Baseline iniziale pulita e sincronizzata con `origin/main` (`0 0`); nessun merge in corso.
- Node `v24.18.0`; npm `11.16.0`, sempre invocato come `npm.cmd`.
- Ultima CI Linux nota all’avvio: run GitHub Actions `29722419996`, riuscita, commit `b227b61`. Non dichiaro una nuova CI Linux perché non è stato eseguito alcun push.

## Architettura e comportamento

- La root Library è ora dedicata al browsing: header con Rescan Library/Cancel Scan e Manage Library, seguito immediatamente da Albums/Artists/Tracks, Grid/List quando pertinente e contenuto indicizzato. Summary, pannello scan e overview Sources non sono più nella root.
- Manage Library è una route interna della stessa istanza Library. Back ripristina route, segmento, modalità Grid/List, pagine già caricate e scroll senza rimontare lo schermo, fermare playback o alterare Queue.
- Manage Library riusa Summary e scan panel esistenti. Mostra Tracks, Albums, Artists, Unavailable, stato/source, progress determinato o indeterminato, contatori completi, elapsed e ultimo scan riuscito.
- Sources Overview mostra nome, disponibilità, conteggi, stato e ultimo successo; il menu operativo offre solo Rescan/Retry. Open Sources apre la schermata di configurazione esistente, che conserva Add/Rename/Remove.
- Un solo EventSource Library, posseduto dall’AppShell per tutta la vita dell’app, distribuisce lo snapshot a Library, Sources e toast. Non sono stati aggiunti endpoint, polling, schema, migration, scanner, scheduler o dipendenze.
- Un solo toast host contiene i messaggi transitori esistenti e una superficie keyed `library-scan-progress`, aggiornata in place. Queued, scanning, cancelling, completed, cancelled, failed, interrupted e source-unavailable riusano lo stesso nodo.
- Il progress toast non contiene pulsanti e non prende focus. Completed e cancelled si chiudono dopo 2,5 secondi; gli errori restano visibili finché un nuovo scan li sostituisce o l’app termina. Gli stati terminali sono immediati; gli altri aggiornamenti sono coalesciati a 250 ms, quindi al massimo 4 render/s, senza `setInterval`. Tutti i timeout vengono cancellati nel teardown.
- La progress bar usa il totale solo quando affidabile; altrimenti resta nativa e indeterminata con `aria-valuetext`. Solo il titolo terminale/stato usa un annuncio live cauto, senza leggere ogni contatore ad alta frequenza.

## UI, responsive e QA reale

La root, Manage Library, Summary, scan panel, Sources overview, menu Source, Open Sources, Back, scroll unico, mini-player e progress toast sono stati ispezionati nella finestra Neutralino/WebView2 reale avviata con `npm.cmd run dev`. Sono state verificate le viewport client 1280×800, 1366×768, 1600×900, 1280×720 e 1024×600. Dopo la richiesta finale, il toast passivo senza pulsanti è stato ricontrollato specificamente agli estremi 1280×800 e 1024×600 durante un rescan reale: titolo, conteggio e barra restano leggibili, senza overflow, flash bianco, layout shift o controlli coperti.

Una fixture temporanea isolata di 4.000 WAV validi ha reso osservabile una scansione reale di circa 26,3 s: il toast è rimasto unico e visibile attraversando la navigazione mentre playback e mini-player continuavano. Completion e auto-dismiss sono stati osservati; il tentativo di catturare visivamente Cancel è arrivato dopo il completamento rapido della run. La cancellazione cooperativa e gli stati cancelling/cancelled restano coperti dai test automatici, ma questo specifico frame terminale non è stato acquisito nella QA manuale. Nessun file musicale dell’utente è stato modificato; fixture, screenshot e log temporanei sono stati rimossi.

## Misure

- Markup statico visibile della root Library: 27 elementi prima dello spostamento, 10 dopo; le collezioni dinamiche restano bounded come nello Step 2.6.
- API reali, 20 richieste locali per endpoint: Summary mediana 2,40 ms / p95 5,65 ms; Sources 2,75 / 6,32 ms; Status 2,51 / 3,53 ms.
- EventSource Library: 1; toast host: 1; timer periodici aggiunti: 0; frequenza massima toast: 4 render/s.
- Run lunga: circa 26,3 s per 4.000 file nella fixture Windows; nessuna misura Raspberry Pi viene dichiarata.
- Memoria del processo Neutralino a riposo: 23,3 MiB working set. L’intero albero Neutralino + WebView2 misurava 407,4 MiB working set e 230,9 MiB private; è una misura di processo Windows, non un heap JavaScript isolato.
- Apertura Library/Manage non ha una trace DevTools affidabile in questa sessione: la route usa la stessa istanza DOM e il cambio è sincrono; non viene inventato un tempo. Visivamente non è comparso alcun frame vuoto.
- Bundle produzione: HTML 2,48 kB (gzip 0,95), CSS 54,72 kB (gzip 9,19), JS 146,09 kB (gzip 40,38), font Open Sans 532,63 kB.

## Verifiche automatiche

- `npm.cmd ci`: PASS, 212 pacchetti verificati; soli warning upstream/deprecazioni e allow-scripts già presenti.
- `npm.cmd audit`: PASS, 0 vulnerabilità.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd test`: PASS, 226 test totali, 224 pass e 2 skip POSIX attesi su Windows.
- `npm.cmd run mpv:doctor`: PASS, MPV `v0.41.0-744-g304426c39`, startup headless e JSON IPC OK.
- `npm.cmd run ffmpeg:doctor`: PASS, build FFmpeg 2026-07-16, esecuzione OK.
- `npm.cmd run test:mpv`: PASS, 4/4.
- `npm.cmd run test:ffmpeg`: PASS, 3/3.
- `npm.cmd run dev`: PASS nella vera app Neutralino/WebView2, con backend, Vite, MPV, playback e scansione Library reali.

## File

Creati:

- `apps/ui/src/components/toast-host.ts`
- `apps/ui/test/step2.6.1.test.ts`
- `prompts/step2.6.1_output.md`

Modificati:

- UI: `apps/ui/src/components/app-shell.ts`, `components/types.ts`, `i18n/en.ts`, `screens/index.ts`, `screens/library.ts`, `screens/sources.ts`, `styles/components.css`, `styles/screens.css`.
- Regressioni: `apps/ui/test/step2.4.3.test.ts`, `step2.5.test.ts`, `step2.6.test.ts`.
- Documentazione: `docs/ui.md`, `docs/architecture.md`, `docs/development/architecture.md`, `library-index.md`, `performance.md`, `testing.md`, `ui-ux.md`.

Non sono stati modificati backend, contratti condivisi, database, scanner, playback, Queue, Folders, dipendenze o configurazioni permanenti.

## Cleanup, regressioni e limiti

Dopo la chiusura normale della finestra risultano zero processi Node del progetto, Neutralino, MPV e FFmpeg e zero listener sulle porte 4310/5173. Il teardown chiude l’unico SSE e cancella i callback toast pendenti. Albums/Artists/Tracks, Grid/List, detail, pagination, contextual playback, Add to Queue, unavailable, Sources, Settings, Folders, Queue, artwork, waveform e ciclo visualizzatori restano coperti dalla suite e dalla QA già applicabile.

Il controllo Linux resta affidato alla prossima GitHub Actions successiva a un eventuale push. Non è iniziato alcuno step successivo: ricerca, Favorites, Playlists e ogni altra funzione fuori scope non sono state implementate.
