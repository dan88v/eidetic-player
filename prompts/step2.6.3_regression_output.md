# Step 2.6.3-R — Correct reel direction, queue-relative speed and tape rendering

**Data:** 21 luglio 2026  
**Esito:** completato con successo, senza commit o push.

## Ambiente e stato iniziale

- Windows, Node `v24.18.0`, npm `11.16.0`.
- Repository: `C:\Users\dan88\Desktop\eidetic-player`.
- Branch: `main`, allineato a `origin/main` (`0` ahead, `0` behind); nessun merge o rebase in corso.
- HEAD: `14f08b2a905c715dbe38ce4bbd14b2660ccb0b22` (`first cassette player animation implementation`).
- Contrariamente al contesto allegato, il working tree iniziale era pulito: lo Step 2.6.3 risultava già incluso in HEAD, non presente come modifica non committata. La correzione è stata quindi applicata come diff minimo sopra quel commit, senza annullarne le parti corrette.

## Correzione fisica e rendering

- La verifica visiva precedente alla modifica ha mostrato entrambe le bobine in senso orario. La causa era il segno positivo passato alla rotazione CSS/SVG: con l'asse Y dello schermo orientato verso il basso, un angolo positivo appare orario.
- Il modello finale assegna la bobina destra a `source/supply` e la sinistra a `destination/take-up`; entrambe hanno lo stesso segno negativo e ruotano in senso antiorario.
- Un marker giallo temporaneo ha confermato nella finestra Neutralino reale che, partendo dall'alto, entrambe le bobine si spostano inizialmente verso sinistra. Il marker è stato rimosso prima di build e test finali.
- Bobina, pignone e hub restano nello stesso gruppo SVG e ruotano insieme.
- La velocità usa `angularSpeed = tapeLinearSpeed / reelRadius`, con clamp massimo documentato a `5.5 rad/s`: a inizio Queue la sinistra quasi vuota è più veloce della destra piena; a metà i raggi e le velocità coincidono; a fine Queue la destra quasi vuota è più veloce della sinistra piena.
- Le due sole masse dinamiche sono cerchi SVG centrati sugli assi reali: sinistra `(290,388)` crescente e destra `(776,388)` decrescente, con raggi `112–270` e area totale conservata. Il raggio pieno resta entro i limiti laterali della cassetta.
- Le masse sono ritagliate dal solo finestrino centrale: il corpo raster copre il resto e i piccoli elementi laterali sono esclusivamente hub/pignoni. Il finestrino usa un vetro statico semitrasparente sopra le bobine.
- Gli avvolgimenti sono due gradienti radiali SVG ripetuti, centrati sulle rispettive bobine, che producono anelli concentrici regolari da 1 px senza aggiungere centinaia di cerchi. Non traslano, non ruotano e non ricevono aggiornamenti per frame.
- Sono stati eliminati il precedente rettangolo marrone opaco, le bande decorative irregolari, offset, trasformazioni e stato controller dedicati al nastro centrale.
- L'ordine finale è: le due masse nel clip del finestrino, vetro semitrasparente, reel/hub laterali e `cassette-frame.png` superiore.
- Per frame il controller modifica soltanto quattro proprietà: i due raggi e le due rotazioni. Rimangono un solo `requestAnimationFrame`, massimo 30 fps, sospensione hidden/idle, reduced motion, Animations Off, delta limitato e normalizzazione degli angoli; nessun timer, observer, Canvas, worker, FFmpeg o EventSource Cassette.

## Audit Queue duration

- La catena reale verificata è `QueueItem.durationSeconds` → snapshot Cassette → `resolveQueueProgress` → raggi → velocità angolari → renderer.
- `PlayerService` aggiorna la durata della traccia corrente da MPV e conserva le durate note delle altre tracce; gli aggiornamenti solo metadata mantengono ID stabili e non incrementano `queueRevision`.
- Quando tutte le durate sono note, il progress è la durata cumulativa precedente più la posizione corrente, divisa per la durata totale. Con durate parziali restano, nell'ordine, mediana delle durate note, durata corrente e fallback neutro di 180 secondi; senza durate resta il fallback per indice approvato.
- I casi 60/180/360 secondi dimostrano continuità A→B e B→C e che il 50% temporale non coincide con metà indice. Seek, append, remove, replace, completamento metadata, durata zero/NaN e indice invalido restano finiti e limitati.
- La transizione da progress stimato a esatto è smussata dal controller in 0,4 secondi; il cambio traccia non azzera la posizione del nastro.

## Test e QA reale

- Aggiunto `apps/ui/test/step2.6.3-regression.test.ts` con 8 test mirati che coprono direzione, source/destination, velocità/raggi, clamp, conservazione area, clip centrale, vetro statico, avvolgimenti ripetuti, assenza della meccanica centrale, singolo rAF e progress temporale 60/180/360 con tutti i casi limite richiesti.
- Aggiornati i test Cassette esistenti per il segno antiorario, i raggi `112–270`, il limite laterale e il finestrino semitrasparente.
- Suite mirata: 24/24 passati.
- Suite completa: 254 test, 252 passati, 2 skip POSIX attesi, 0 fallimenti.
- Verifica reale con `npm.cmd run dev` nella finestra Neutralino/WebView2: premium e fallback prototipo avviati correttamente; direzione e differenze di velocità osservate a inizio, metà e fine Queue; nessuna animazione autonoma nel finestrino; Pause/idle senza loop continuo; layout, controlli e mini-player integri.
- La geometria finale è stata mostrata a 1280×800 in tre acquisizioni reali: all'inizio è piena la bobina destra, a metà i raggi sono uguali e separati, alla fine è piena la sinistra. La resa con vetro semitrasparente e anelli da 1 px è stata approvata dall'utente.
- Viewport ispezionate durante la regressione: 1280×800, 1280×720 e 1024×600. Le geometrie responsive non sono state modificate, quindi 1366×768 e 1600×900 conservano contrattualmente la validazione dello Step 2.6.3.
- Il fallback prototipo usa lo stesso controller e modello fisico del premium, senza testina, capstan o pinch roller.
- Il Browser integrato non disponeva di un'istanza collegabile; la QA richiesta è stata eseguita direttamente sulla vera finestra Neutralino/WebView2 con input e acquisizioni native Windows.

## Comandi eseguiti

- `npm.cmd ci`: passato, 212 pacchetti verificati.
- `npm.cmd audit`: passato, 0 vulnerabilità.
- `npm.cmd run format:check`: passato.
- `npm.cmd run typecheck`: passato.
- `npm.cmd run lint`: passato.
- `npm.cmd run build`: passato.
- `npm.cmd test`: passato.
- `npm.cmd run mpv:doctor`: passato, MPV e IPC disponibili.
- `npm.cmd run ffmpeg:doctor`: passato.
- `npm.cmd run test:mpv`: 4/4 passati.
- `npm.cmd run test:ffmpeg`: 3/3 passati.
- `npm.cmd run dev`: passato per premium e fallback, con shutdown reale.
- `git diff --check`: passato.

## Non regressioni, asset e cleanup

- Nessun file di Default player, mini-player, Queue model, `PlayerService`, MPV/IPC/REST/SSE, visualizer, Library, Settings, artwork, waveform o toast è stato modificato.
- `cassette-frame.png`: 904.936 byte, SHA-256 `F59D60D5E5C1896F469E1FB2ECC2623370E140EA52DA88D60AA8B2F724AC4A09`.
- `cassette-master-original.png`: 1.950.151 byte, SHA-256 `D513DDC96C060480EBC6FD87609EC9C6DC0A72910FF59CD4F7C435116DB1DA7D`.
- Nessun nuovo raster; nessun marker o screenshot QA residuo/versionato; nessun file fallback temporaneo.
- Dopo lo shutdown: zero listener sulle porte 4310/5173 e zero processi Eidetic Player Node, Neutralino, MPV o FFmpeg. Nessun rAF, timer, callback o EventSource Cassette resta attivo.
- CI/Linux delle modifiche non committate: pending/non avviabile senza pubblicarle. Lo stato remoto del solo HEAD iniziale non era leggibile: repository/commit restituiti come 404 dal connettore GitHub e `gh` non è installato. Tutta la matrice locale Windows richiesta è passata.

## Stato Git finale

- File Step 2.6.3 già modificati all'avvio: nessuno; baseline pulita e già committata in HEAD.
- Correzione 2.6.3-R: `cassette-animation-controller.ts`, `cassette-geometry.ts`, `cassette-physics.ts`, `cassette-progress.ts`, `cassette-reel-layer.ts`, `cassette-player.css`.
- Test: aggiornati `step2.6.2.test.ts` e `step2.6.3.test.ts`; nuovo `step2.6.3-regression.test.ts`.
- Documentazione: aggiornati esclusivamente `cassette-player.md`, `testing.md` e `performance.md`.
- Report nuovo: `prompts/step2.6.3_regression_output.md`; `prompts/step2.6.3_output.md` non è stato sovrascritto.
- `git diff --stat` sui file tracciati: 11 file, 160 inserimenti, 105 eliminazioni; il nuovo test e questo report sono untracked e quindi esclusi da quel conteggio.
- `git diff --check`: nessun errore.
- Non è stato eseguito alcun commit, push, merge, rebase, reset, restore, stash o clean. Non è stato iniziato alcun nuovo step.
