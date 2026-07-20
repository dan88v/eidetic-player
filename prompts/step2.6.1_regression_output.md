# Step 2.6.1-R — esito finale

Data: 21 luglio 2026. Esito: regressione corretta nel working tree non committato, senza nuove funzionalità e senza commit, push, merge, rebase, reset, restore, stash o clean.

## Ambiente e stato Git iniziale

- Clone Windows: `C:\Users\dan88\Desktop\eidetic-player`.
- Branch: `main`; nessun merge o rebase in corso.
- HEAD iniziale e finale: `5f7cd625380a0e63d8f3c381e7d6f3a5c4cfa5cc` (`first library implementation`).
- Node `v24.18.0`; npm `11.16.0`, sempre eseguito come `npm.cmd`.
- Il working tree iniziale conteneva intenzionalmente i file modificati e nuovi dello Step 2.6.1. `git diff --check` era pulito. Nessuna di tali modifiche è stata rimossa.

## Riproduzione e causa radice

Il difetto è stato riprodotto prima della correzione nella vera finestra Neutralino/WebView2 a 1280×800, con una traccia caricata e in pausa: artwork, titolo e timeline del mini-player erano visibili, mentre l’intero gruppo Home/Previous/Play-Pause/Next era assente dalla superficie visibile.

Il DOM e il renderer non erano danneggiati: i quattro button, gli `aria-label`, gli SVG, i path, `viewBox`, `currentColor` e le dimensioni `.icon` esistevano ancora. Il confronto con HEAD ha isolato una sola regressione rilevante in `apps/ui/src/styles/components.css`: durante la rifinitura finale dello Step 2.6.1, una sostituzione destinata alla griglia del toast aveva colpito per errore la prima dichiarazione compatibile e cambiato `.mini-player` da:

`grid-template-columns: minmax(0, 1fr) auto`

a una sola colonna. Summary e azioni finivano quindi in due righe implicite dentro l’altezza fissa `--mini-player-height`; la seconda riga usciva dalla cella riservata e veniva ritagliata dall’app shell. La regressione apparteneva al working tree dello Step 2.6.1, non a un commit successivo. Il nuovo toast host non applicava selettori globali a SVG, path, button o icone.

## Correzione

È stata ripristinata esattamente la dichiarazione originale di HEAD: `grid-template-columns: minmax(0, 1fr) auto`. Non sono stati aggiunti override, colori, `!important`, nuove icone, asset, timeout o remount. Il blocco `.mini-player` finale è semanticamente identico alla baseline: posizione, ordine, dimensioni, spaziatura, touch target, stile, accessibilità e azioni non cambiano.

La correzione specifica riguarda:

- `apps/ui/src/styles/components.css`: ripristino della griglia originale; nel diff finale verso HEAD questa riga non appare più perché coincide nuovamente con la baseline.
- `apps/ui/test/step2.6.1-regression.test.ts`: nuovo gate mirato.
- `AGENTS.md`: nuova regola canonica sulle superfici UI condivise e sullo scoping CSS.
- `prompts/step2.6.1_regression_output.md`: questo report.

Tutti gli altri file modificati o nuovi mostrati da Git appartengono allo Step 2.6.1 già presente nel working tree.

## Gate di regressione

Il nuovo test esegue il renderer reale `icon()` e verifica Home, Previous, Play, Pause e Next, oltre a tutte le 27 icone condivise: SVG valido, geometria vettoriale presente, `viewBox`, classe scoped, `aria-hidden`, assenza di dimensioni zero e assenza di sostituti Unicode. Verifica inoltre:

- button mini-player con `data-control` e `aria-label`;
- transizione Play/Pause tramite i due renderer approvati;
- griglia mini-player obbligatoriamente a due colonne;
- dimensioni icona 1,75 rem e assenza di hide/opacity zero;
- assenza di selettori globali `svg`/`path` introdotti dai componenti;
- CSS toast scoped;
- progress toast ancora passivo e senza pulsanti.

`AGENTS.md` ora rende top bar, mini-player, Home, transport, Queue e toast superfici obbligatorie di non regressione, vieta selettori generici su `svg`, `path`, `button` e `.icon` senza motivazione e test, e richiede verifica visuale reale con `npm.cmd run dev` per gli step UI Windows.

## QA Neutralino/WebView2 reale

La correzione è stata verificata tramite più avvii reali con `npm.cmd run dev`:

- 1280×800, 1280×720 e 1024×600;
- profilo utente con traccia e Queue reali;
- profili APPDATA/LOCALAPPDATA temporanei e isolati senza traccia e senza Sources;
- stato paused: Play visibile;
- stato playing: Pause visibile;
- 20 pressioni Play/Pause, equivalenti a 10 cicli completi, tutte alternate correttamente e concluse nello stato iniziale paused;
- 10 Next e 10 Previous reali, tutti passati dall’indice 2 al 3 e ritorno, senza scomparsa delle icone;
- Home visibile, cliccabile e capace di tornare a Now Playing;
- Library, Manage Library, Sources, Folders, Settings e Queue attraversate senza perdita delle icone;
- Queue drawer reale aperto e chiuso con la Queue popolata;
- rescan Library reale durante la sessione: mini-player invariato e toast terminale unico, sopra il mini-player, passivo e senza pulsanti;
- layout enabled e disabled visibili, non ritagliati e con contrasto coerente;
- nessun cambiamento dopo navigazione, aggiornamenti Player o Library SSE.

Nel profilo senza traccia il gruppo di trasporto disabilitato resta visibile esattamente come in HEAD. Non è stata reinterpretata la logica preesistente dello stato `idle`.

L’audit visuale e strutturale ha confermato anche Hamburger, icone di sistema, Volume/Mute, Shuffle, Repeat, Queue, Back, menu `⋯`, Grid/List, chevron, cartelle e navigazione. Nessuna risulta assente, trasparente, a dimensione zero o ritagliata. Rescan/Cancel restano controlli testuali come progettato.

## Step 2.6.1 e non regressioni

Library root pulita, Manage Library, Summary, scan panel, Sources Overview, Open Sources, Albums/Artists/Tracks, Grid/List, details, Folders, Sources, Settings, Queue, artwork, waveform, visualizzatori e playback contestuale restano invariati. Il progress toast conserva una sola key, un solo host, un solo Library SSE, coalescing a 250 ms e nessun pulsante. Non sono stati toccati backend, contratti, scanner, database, MPV, FFmpeg, Queue model o dipendenze.

## Verifiche automatiche

- `npm.cmd ci`: PASS, 212 pacchetti verificati; soli warning upstream già presenti.
- `npm.cmd audit`: PASS, 0 vulnerabilità.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS; HTML 2,48 kB, CSS 54,72 kB (gzip 9,19), JS 146,09 kB (gzip 40,38), Open Sans 532,63 kB.
- `npm.cmd test`: PASS, 230 test totali, 228 pass e 2 skip POSIX attesi su Windows.
- Test regressione dedicato: 4/4 PASS.
- `npm.cmd run mpv:doctor`: PASS, startup headless e JSON IPC OK.
- `npm.cmd run ffmpeg:doctor`: PASS, esecuzione processo OK.
- `npm.cmd run test:mpv`: PASS, 4/4.
- `npm.cmd run test:ffmpeg`: PASS, 3/3.
- `npm.cmd run dev`: PASS nella vera applicazione Neutralino/WebView2.

## Cleanup e limiti

Tutti gli screenshot, log e profili QA temporanei sono stati eliminati. Dopo la chiusura normale risultano zero processi Node del progetto, Neutralino, MPV e FFmpeg e zero listener sulle porte 4310/5173; non restano scanner o runtime temporanei. I timeout toast e l’unico SSE sono chiusi dal teardown già verificato.

La verifica Linux resta affidata alla prossima GitHub Actions successiva a un eventuale push. Nessuna nuova funzione è stata aggiunta e nessuno step successivo è stato iniziato. Non sono stati eseguiti commit o push.

## Stato Git finale

`git diff --check` è pulito. `git diff --stat` riporta 19 file tracked, 594 inserimenti e 140 rimozioni; il conteggio include tutto lo Step 2.6.1 e non include i file untracked.

File già presenti nello Step 2.6.1: modifiche UI in AppShell, types, i18n, Library, Sources e relativi CSS/test/documenti; nuovi `toast-host.ts`, `step2.6.1.test.ts` e `step2.6.1_output.md`.

File specifici dello Step 2.6.1-R: `AGENTS.md`, il nuovo `apps/ui/test/step2.6.1-regression.test.ts`, questo report e il ripristino della dichiarazione `.mini-player` dentro il già modificato `components.css`. Tutti restano non committati.
