# Step 2.4.3 — Settings behavior, playback synchronization & UI fixes

Data: 19 luglio 2026  
Esito: completato. Non è stato avviato lo Step 2.5.

## Diagnosi e correzioni

- Il timer globale controllava singole sottoschermate tramite DOM e poteva
  restare attivo nelle altre pagine Settings. Ora tutte le route hanno uno
  `screenGroup`; `isSettingsRoute` sospende e azzera l'unico timer nell'intera
  sezione. Uscendo da Settings parte sempre un timeout completo.
- Le selection screen mantenevano la pagina aperta e la persistenza avveniva
  dopo l'aggiornamento applicativo. Ora il tap valida, aggiorna lo store,
  persiste, rende il checkmark e torna a Interface nello stesso evento. Un
  errore storage esegue rollback, resta nella pagina e usa il toast esistente.
- Tutti i booleani Settings esistenti usano il segmented control. Navigation,
  selection e segmented condividono `settings-row-base`.
- Lo splash mantiene il titolo su una riga e usa `--color-accent`; Animations
  Off e reduced motion rendono la linea statica.
- La precedente frase istruttiva dello stato vuoto è stata eliminata da i18n,
  rendering e bundle senza testo sostitutivo.
- Add to Queue usa il solo toast applicativo, con variante success/neutral,
  deduplica ravvicinata e posizione sopra il mini-player.
- Il click Queue rimette esplicitamente MPV in play. La Queue staged viene
  materializzata direttamente sull'indice scelto preservando ID e origini
  logiche.
- I frame visualizer avevano timestamp derivati dai campioni ricevuti anziché
  dai campioni realmente consumati, accumulando anticipo. I timestamp ora
  avanzano per hop analizzato; il frontend usa un buffer bounded, identità e
  generazione, posizione MPV udibile corretta con `audio-buffer`, tolleranza di
  50 ms, congelamento in pausa e invalidazione su seek/cambio traccia.
- La pipeline artwork poteva rivelare un clone prima del suo load/decode e un
  errore transitorio poteva perdere i picture buffer dietro una cache positiva
  incompleta. Load e decode precedono ora il commit; parser, resolve e decode
  falliti restano ritentabili e invalidano soltanto la entry interessata.
- Il sorting mantiene il bordo soltanto sul contenitore; il trigger interno è
  trasparente, senza bordo/ombra e con focus accent inset.
- Il click principale delle tracce in Folders disabilitava subito il pulsante
  ma lo riabilitava soltanto nel ramo di errore; inoltre più risoluzioni
  asincrone potevano arrivare al player fuori ordine. Il click della riga e
  Play now usano ora lo stesso handler, riabilitano sempre il controllo e
  aggiornano la selezione soltanto per l'ultima richiesta riuscita.
- Il backend assegna una generazione prima di risolvere la Queue della cartella
  e serializza le aperture: una risposta vecchia e lenta non può più
  sovrascrivere l'ultima traccia scelta.
- L'audit dei messaggi ha rimosso i contenitori inline di Folders e Sources.
  I messaggi necessari passano dall'unico toast applicativo. Empty state,
  disponibilità persistente delle sorgenti e testo dei dialog restano
  correttamente nel contenuto.
- Una riga Folders poteva conservare per sempre il flag `current` ricevuto dal
  browse iniziale, producendo due selezioni visive dopo un cambio traccia. La
  classe e `aria-current` dipendono ora soltanto dalla traccia corrente nello
  store del player.
- Il meter L/R converte i picchi lineari nel dominio logaritmico −60–0 dB. Una
  scala compatta sopra le barre mostra −60, −40, −20, −12, −6, −3 e 0 dB; le
  tacche interne e le soglie colore seguono le stesse posizioni.
- Le intestazioni di Sources, Library, Queue e Settings non duplicano più
  icona, eyebrow e titolo già presenti nella top bar. A sinistra rimane soltanto
  `screen-header__description`; le azioni esistenti sulla destra, come Add
  Folder, restano disponibili.
- In Folders browse, loading e play non generano più toast perché producono un
  risultato visibile. Add to Queue, esiti senza riscontro visivo ed errori
  continuano a usare l'unico toast applicativo.

## Misure

- Timer inactivity globali: 1; timer schedulati dentro Settings: 0.
- Commit e navigazione Settings: sincroni nello stesso handler; la misurazione
  in millisecondi della WebView non è disponibile nella sessione.
- Settings: titolo riga 22 px, valore 19 px, descrizione 17 px, altezza minima
  72 px, chevron SVG 30 px.
- Splash: titolo `clamp(32 px, 4.4vw, 56 px)`, una riga, loading line nel colore
  accent.
- Contenitori toast: 1.
- Contenitori transient feedback inline in Folders/Sources: 0.
- Toast Folders per browse/loading/play riusciti: 0.
- Meter: range −60–0 dB; 0,1 lineare = −20 dB = 66,67% della scala; 0,01
  lineare = −40 dB = 33,33%.
- Queue staged, indice 1: stato playing osservato in 25,7 ms; indice 1 corretto,
  ID preservati, incremento `trackTransitionId` pari a 1.
- MPV disponibile: `time-pos`, `audio-pts`, `audio-delay`, `audio-buffer`,
  cache state e playback state. Sul sistema Windows `audio-buffer` era 200 ms.
- MP3 reale: offset visualizzato medio +5,3 ms; intervallo osservato
  −138,6/+43,8 ms.
- FLAC reale: offset medio analyzer rispetto alla timeline udibile −37,2 ms;
  intervallo osservato −148,6/+93,5 ms.
- Il massimo assoluto transitorio supera quindi l'obiettivo ±100 ms per ritardi
  brevi, ma l'anticipo massimo resta entro 100 ms e la media entro ±50 ms. Non
  vengono dichiarati risultati Raspberry Pi.
- Buffer sync: 24 frame; EventSource UI: 1; rAF UI: 1; analyzer realtime: massimo
  1 processo FFmpeg.
- Taylor cold: 14 metadata/artwork su 14, 14 GET HTTP 200 JPEG, 14 decode su 14;
  metadata media 29,7 ms, massimo 56 ms.
- Taylor warm: 14/14, metadata media 4,1 ms, massimo 20,2 ms; retry osservati: 0.
- Occorrenze della frase empty-state nel sorgente applicativo e in `dist`: 0.
- Bundle: 672.798 byte prima, 685.461 byte dopo (+12.663 byte); output UI:
  HTML 2,48 kB, CSS 42,53 kB, JS 107,34 kB.

## Test reali

- Avvio eseguito con `npm.cmd run dev`; bootstrap backend/frontend e finestra
  Neutralino riusciti.
- Il controllo finale con lo stesso comando ha rilevato correttamente la
  sessione development già attiva sulla porta 5173: health backend `ok` e
  nessuna seconda istanza rimasta in esecuzione.
- Dopo le ultime correzioni è stato eseguito un nuovo avvio pulito con
  `npm.cmd run dev`: backend development `ok`, UI Vite HTTP 200, modulo meter
  con scala dB e modulo Folders aggiornato serviti correttamente.
- Provati MP3 Taylor/Kacey e FLAC Richard Ashcroft non corrotto.
- Verificati playback, pausa, resume, seek, Queue staged su indice non iniziale,
  timestamp analyzer, latenza MPV, artwork Taylor cold/warm e shutdown.
- Le 14 risorse Taylor sono state ricevute e decodificate. Il controllo DOM
  visuale di scroll, List/Grid, responsive, layout shift e opacity finale non è
  stato automatizzabile perché il controllo del browser integrato non era
  esposto; non viene dichiarato come test manuale superato.
- Shutdown pulito: nessun processo del progetto, MPV, FFmpeg o Neutralino
  residuo.

## Verifiche automatiche

- `npm audit`: 0 vulnerabilità.
- `format:check`: superato.
- `typecheck`: superato.
- `lint`: superato.
- `build`: superato.
- Test unitari/statici: 158/158.
- `mpv:doctor`: superato, MPV v0.41.0-744-g304426c39.
- `ffmpeg:doctor`: superato, build 2026-07-16.
- Integrazione MPV: 4/4.
- Integrazione FFmpeg: 2/2, incluso massimo un analyzer realtime.
- Ricerca post-build della frase empty-state: 0 occorrenze applicative/bundle.

## File creati

- `apps/ui/src/visualizer/visualizer-frame-buffer.ts`
- `apps/ui/test/step2.4.3.test.ts`
- `prompts/step2.4.3_output.md`

## File modificati

- Backend/shared: bootstrap API, analysis config/engine/service, filesystem
  browser, metadata service, MPV controller, player service, player contract e
  relativi test.
- UI: splash, shell, artwork, icons, mini-player, visualizer, i18n, bootstrap,
  routes, Folders, Sources, screen factory, Now Playing, Settings, storage,
  snapshot e stream visualizer, stili e test di transizione/Step 2.4.2.
- Documentazione: `docs/ui.md`, `docs/architecture.md`,
  `docs/development/ui-ux.md`, `docs/development/performance.md` e
  `docs/development/testing.md`.

## Regressioni controllate e limiti

Bootstrap barrier, restore paused-at-zero, Queue keyed/persistente,
`playerSessionId`, `trackTransitionId`, transizioni atomiche, path logici,
waveform, mini-player, guard artwork e assenza di processi duplicati restano
coperti dai test. Non sono state aggiunte dipendenze, database, indicizzazione,
toast paralleli, analyzer/EventSource/rAF aggiuntivi o workaround legati a un
artista. Il limite residuo è l'assenza della verifica visuale automatizzata
della WebView in questa sessione.

## Regola per gli step successivi

Dopo il mount dell'app shell ogni messaggio transitorio necessario deve usare
`showToast`. Non vanno aggiunti status, feedback, alert o banner temporanei
sopra il contenuto, né un secondo toast. Le azioni con un risultato
immediatamente visibile non devono generare un messaggio: in Folders vale per
browse, loading e play. Add to Queue, gli esiti senza riscontro visivo e gli
errori usano il toast. Empty state, stati persistenti, help di validazione e
spiegazioni nei dialog non sono messaggi transitori. L'unica eccezione
applicativa è un errore fatale di bootstrap avvenuto prima che shell e toast
esistano.
