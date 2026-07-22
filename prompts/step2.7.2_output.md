# Step 2.7.2 — Technical meter smoothing and dismissible toasts

## Esito

Step completato nel working tree senza commit o push. Non sono stati avviati Main Player switcher, Vinyl Player, Favorites o altri step. Lo steering successivo dell'utente ha aggiunto una sola eccezione esplicita: riposizionamento di `Clear Queue` nel Queue drawer.

## Crest e Technical

La causa dell'instabilità era l'assegnazione diretta del Crest calcolato a ogni frame Technical. È stato introdotto un filtro esponenziale asimmetrico, applicato esclusivamente al valore visualizzato:

- attack: 125 ms;
- release: 1.800 ms;
- smoothing dipendente dal delta-time;
- passo massimo di 250 ms dopo pause lunghe o tab nascosta;
- campioni null, NaN e Infinity ignorati;
- reset su cambio traccia/sessione, seek e cambio modalità;
- nessun cambiamento a LUFS-S o ai dati analyzer.

Il filtro usa il rAF e i timestamp già esistenti: nessun timer, rAF, EventSource o processo aggiuntivo. I valori Crest e LUFS-S passano da 38/44 px a un intervallo responsive 48–58 px, con cifre tabulari e layout invariato. Dopo lo steering il suffisso `dB` non-compact è stato avvicinato al valore Crest riducendo l'offset da 170 a 150 px.

## Toast

- Il singolo toast host esistente aggiunge una sola `<button type="button">` per toast, con `aria-label="Dismiss notification"`, focus visibile, simbolo × piccolo e hit area 40×40 px.
- Il dismiss di un toast normale cancella l'auto-dismiss pendente e lo nasconde immediatamente.
- Il progress toast conserva soltanto il dismiss: nessun Manage, Cancel o Retry.
- Una run dismissata è identificata in memoria con `scanId/sourceId/generation`; update e stato terminale della stessa run restano nascosti, mentre una nuova run ricompare.
- Bootstrap e coalescing continuano a usare il singolo Library SSE e i timeout esistenti; il teardown li cancella tutti.

## Steering Queue

`Clear Queue` è stato rimosso dalla barra superiore del drawer e inserito, centrato e rosso, dopo l'ultima riga della Queue dentro lo scroll. Con Queue vuota il footer resta nascosto. Conferma, focus trap, Remove, playback e Queue model sono invariati.

## File modificati

- `apps/ui/src/visualizer/technical-renderer.ts`
- `apps/ui/src/components/visualizer.ts`
- `apps/ui/src/components/toast-host.ts`
- `apps/ui/src/components/queue-drawer.ts`
- `apps/ui/src/styles/components.css`
- `apps/ui/src/i18n/en.ts`
- test UI Step 2.4.4, 2.6.1, 2.6.1 regression, 2.7.1 e nuovo `step2.7.2.test.ts`
- `docs/ui.md`, `docs/development/ui-ux.md`, `performance.md`, `testing.md`

## Test e verifiche

- Test mirati Technical/toast: 31/31 PASS prima dello steering Queue.
- Test mirati finali Step 2.7.1/2.7.2: 14/14 PASS.
- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd test`: 294 test, 292 PASS, 0 fail, 2 skip POSIX attesi su Windows.
- `git diff --check`: PASS.

## QA Neutralino/WebView2

QA reale eseguita con `npm.cmd run dev` e playback FLAC:

- ciclo completo Mono Spectrum → Stereo Spectrum → Meter → Technical → None → Mono Spectrum;
- Crest reattivo ai picchi e visivamente stabile in discesa; LUFS-S ancora diretto;
- valori e suffisso `dB` leggibili senza clipping a 1280×800, 1280×720 e 1024×600;
- toast normale “Content is already in Queue.” chiuso manualmente;
- fixture isolata di 14.001 WAV sintetici: run di circa 25 s, progress toast dismissato durante scan, terminale della stessa run non ricomparso, run successiva nuovamente visibile;
- Manage Library operativo durante/dopo lo scan;
- Default Player, Cassette Player e mini-player ispezionati senza regressioni;
- Queue drawer verificato a 1280×800 e 1024×600 con Clear Queue rosso centrato in fondo allo scroll.

## Cleanup e stato esterno

La Source temporanea e i 14.001 WAV sono stati rimossi. I soli record QA Step 2.7.1/2.7.2 sono stati eliminati dal database con transazione mirata; il catalogo è tornato a 44 Track e `PRAGMA quick_check` restituisce `ok`. Nessun media dell'utente è stato modificato.

Dopo la chiusura: zero processi Neutralino/MPV/FFmpeg/Node/Vite del progetto, zero listener 4310/5173, zero fixture, Source temporanee o screenshot QA. Nessun timer, callback toast, rAF o SSE aggiuntivo è stato introdotto.

CI Linux resta pending fino a una futura run post-push. Nessun commit, push, merge, rebase, reset, restore, stash o clean è stato eseguito.
