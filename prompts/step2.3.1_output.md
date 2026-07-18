# Step 2.3.1 — Queue stability, mini-player timeline and visualizer performance

Data: 2026-07-17

## Esito

Lo step correttivo è implementato e verificato con MPV e FFmpeg reali, con la
finestra Neutralino reale e con i due album indicati. FFmpeg era già presente:

- eseguibile: `C:\Tools\ffmpeg\ffmpeg.exe`;
- versione: `2026-07-16-git-ceabc9b306-full_build-www.gyan.dev`;
- `ffmpeg:doctor`: OK.

La quinta MP3 parte direttamente come elemento 5, senza caricare la prima.
L'accettazione equivalente non è materialmente possibile sul quinto FLAC
fornito: il file inizia con `00 00 00 00`, non con `66 4c 61 43` (`fLaC`), e
sia MPV sia FFmpeg lo rifiutano. Anche l'ottavo FLAC ha lo stesso difetto. I file
non sono stati modificati; MPV salta il quinto corrotto e passa al sesto valido.

## Diagnosi e cause

- MPV caricava la prima traccia e spostava `playlist-pos` dopo: questo esponeva
  per un istante audio, metadata e artwork della traccia 1.
- ogni derivazione dello stato creava un nuovo array Queue; il drawer conciliava
  troppo spesso e ricreava nodi/artwork.
- le richieste artwork erano legate alla vita del render, non esclusivamente
  all'ID stabile della riga.
- il placeholder artwork restava visibile sopra l'immagine decodificata; inoltre
  una lettura forzata di layout (`getBoundingClientRect`) era usata per il fade.
- la timeline del mini-player occupava una riga del layout.
- il callback SSE ridimensionava il Canvas e disegnava immediatamente, creando
  letture layout, clear e allocazioni per frame.
- chiamate concorrenti a `AudioAnalyzerService.synchronize()` potevano avviare
  più sidecar prima che `child` fosse assegnato. La baseline ha raggiunto 28
  processi FFmpeg e non ha completato la finestra prestazionale.
- le normali oscillazioni di `time-pos` causavano restart drift troppo
  aggressivi; il cambio tra due modalità attive poteva inoltre attraversare
  brevemente zero subscriber.

## Correzioni

### MPV e Queue

`loadPlaylist()` mette MPV in pausa, carica direttamente il file scelto con
`replace`, inserisce gli elementi precedenti con `insert-at`, accoda i
successivi e verifica il `playlist-pos` finale. Lo stato intermedio resta
privato finché la playlist non è pronta.

La Queue conserva il precedente riferimento array quando i campi non cambiano.
`queueRevision` cambia solo per contenuto, ordine, current item, metadata o
artwork di riga. Il drawer usa una `Map` keyed per `queueItem.id`, conserva i
nodi, aggiorna solo testi/classi necessari e ricrea l'IntersectionObserver solo
quando cambia la struttura.

Nel test UI:

- righe prima/dopo 20 cambi: 14/14;
- stessi nodi DOM: sì;
- scroll prima/dopo: `180`/`180`;
- aggiornamenti strutturali: `1` iniziale, ancora `1` dopo i 20 cambi;
- rebuild strutturali durante 30 secondi stabili: 0.

Le artwork di Queue usano ID e generation token della riga. Risposte obsolete
sono ignorate. Il placeholder scuro compare subito quando manca l'artwork; la
nuova immagine viene decodificata prima dello swap. Immagine e contenitore hanno
dimensioni fisse e background scuro. Il placeholder viene nascosto appena
l'immagine corretta è pronta, senza layout read forzata.

### Mini-player

La timeline è ora assoluta sul bordo superiore e non crea una nuova riga:

- traccia visibile: 8 px;
- hit area: 40 px;
- altezza misurata mini-player: 108 px;
- hit area misurata: 40 px;
- offset superiore: 1 px;
- layout a una riga invariato.

Supporta tap, drag, pointer capture, preview locale, singolo seek al rilascio,
Home, End e frecce. Gli eventi fermano la propagazione. Timeline e pulsanti
hanno livelli separati: la timeline intercetta il bordo/area interna, mentre i
pulsanti principali restano sopra e cliccabili.

### Meter e visualizer

Meter, Spectrum Mono, Spectrum Stereo e None condividono lo stesso contenitore.
Con Canvas alto 180 px il Meter usa barre da 56 px, gap da 20 px e termina
esattamente sul fondo del Canvas/artwork. Il gradiente è memorizzato per
context/geometry.

Il nuovo percorso caldo:

1. un solo EventSource mode-specific riceve dati;
2. il client conserva esclusivamente il frame più recente;
3. un solo `requestAnimationFrame`, massimo 30 FPS, effettua smoothing e draw;
4. gli array `Float32Array` 2, 32 e 16+16 sono preallocati;
5. resize e `prepareCanvas()` avvengono solo nel `ResizeObserver`;
6. niente `map`, spread, reverse o concat nei renderer per frame;
7. il payload contiene solo i valori della modalità richiesta, arrotondati a
   quattro decimali;
8. None chiude SSE, cancella rAF e ferma FFmpeg.

L'analyzer serializza e accorpa le transizioni lifecycle. Un grace period di
200 ms impedisce stop/start passando tra modalità attive. Il drift usa soglia
1,5 s e cooldown 30 s. Il profilo configurabile `rpi3` usa 16 kHz e massimo 15
FPS; non viene attivato automaticamente su Windows.

## Misure reali

Baseline prima della correzione:

- fino a 28 processi FFmpeg concorrenti;
- benchmark interrotto per timeout;
- ridimensionamento Canvas e render eseguiti direttamente per evento SSE;
- Queue ricostruita sui cambi current/artwork invece di riusare le righe.

Dopo la correzione, su finestre da 30 secondi:

| Album       |        Modalità | SSE FPS | Canvas FPS | rAF finale | FFmpeg in None |
| ----------- | --------------: | ------: | ---------: | ---------: | -------------: |
| MP3         |           Meter |   15,96 |      22,66 |          1 |              — |
| MP3         |   Spectrum Mono |   14,70 |      22,43 |          1 |              — |
| MP3         | Spectrum Stereo |   15,19 |      22,62 |          1 |              — |
| MP3         |            None |       0 |          0 |          0 |              0 |
| FLAC valido |           Meter |   10,93 |      22,16 |          1 |              — |
| FLAC valido |   Spectrum Mono |   10,03 |      20,83 |          1 |              — |
| FLAC valido | Spectrum Stereo |   10,97 |      22,43 |          1 |              — |
| FLAC valido |            None |       0 |          0 |          0 |              0 |

Misure dirette analyzer:

- MP3: 15,99 FPS, intervallo medio 62,52 ms, jitter 12,63 ms;
- FLAC: 10,73 FPS, intervallo medio 92,89 ms, jitter 8,42 ms;
- CPU backend/30 s: 2,83 s MP3, 2,41 s FLAC;
- CPU FFmpeg/30 s stabile: circa 0,36 s MP3, 0,19 s FLAC;
- payload completo diagnostico: circa 1.418 byte MP3 e 1.475 byte FLAC; il
  payload SSE mode-specific effettivo è inferiore perché non include le bande
  delle altre modalità;
- processi analyzer durante le finestre stabili: 1;
- test stabile 60 s: stesso PID FFmpeg (`61940`) all'inizio e alla fine, zero
  restart osservati; CPU FFmpeg +1,14 s;
- cambi resize durante ogni finestra UI: 0;
- EventSource attivi per visualizer: 1 nelle modalità attive, 0 in None.

## Ordine natural sort

FLAC:

1. `01 - Bittersweet Symphony.flac`
2. `02 - A Song for the Lovers.flac`
3. `03 - Sonnet.flac`
4. `04 - C’mon People (We’re Making It Now) [feat. Liam Gallagher].flac`
5. `05 - Weeping Willow.flac` (corrotto)
6. `06 - Lucky Man.flac`
7. `07 - This Thing Called Life.flac`
8. `08 - Space & Time.flac` (corrotto)
9. `09 - Velvet Morning.flac`
10. `10 - Break the Night with Colour.flac`
11. `11 - One Day.flac`
12. `12 - The Drugs Don’t Work.flac`

MP3:

1. `01. Lavender Haze.mp3`
2. `02. Maroon.mp3`
3. `03. Anti-Hero.mp3`
4. `04. Snow On The Beach.mp3`
5. `05. You're On Your Own, Kid.mp3`
6. `06. Midnight Rain.mp3`
7. `07. Question..._.mp3`
8. `08. Vigilante Shit.mp3`
9. `09. Bejeweled.mp3`
10. `10. Labyrinth.mp3`
11. `11. Karma.mp3`
12. `12. Sweet Nothing.mp3`
13. `13. Mastermind.mp3`
14. `14. Meet me at midnight.mp3`

## Test reali

- Neutralino reale avviato (`neutralino-win_x64.exe` con WebView2), MPV reale e
  file MP3 reale in riproduzione; stato osservato: index 4, 14 elementi, titolo
  `You're On Your Own, Kid`.
- quinta MP3: nessuna transizione alla prima traccia, metadata e artwork
  corretti; Previous quarta, Next quinta e sesta.
- quinta FLAC: inserita correttamente come index 4 e mai sostituita dalla prima,
  ma MPV la rifiuta e passa alla sesta a causa del file corrotto.
- 20 cambi Next/Previous MP3: nodi e scroll Queue stabili.
- artwork embedded MP3 coerente tra current/next; folder artwork FLAC coerente.
- Meter, Mono, Stereo e None: 30 secondi ciascuno su entrambi gli album; per
  FLAC è stata usata la sesta traccia valida per le misure.
- riproduzione stabile: 60 secondi, un solo PID analyzer.
- chiusura durante playback: processi MPV/FFmpeg/backend/UI terminati.
- fallback assenza FFmpeg: visualizer/waveform degradano senza bloccare il
  player; fallback assenza MPV: stato unavailable e API di playback protette.

## Verifiche finali

- `npm audit`: 0 vulnerabilità;
- `format:check`: OK;
- `typecheck`: OK;
- `lint`: OK;
- `build`: OK;
- bundle UI: CSS 30,17 kB (gzip 5,80), JS 63,27 kB (gzip 18,84);
- test automatici principali: 40/40;
- integrazione MPV: 3/3, incluso selected fifth/no first flash;
- integrazione FFmpeg: 2/2, incluso 100 aggiornamenti rapidi con un solo
  processo;
- `mpv:doctor`: MPV `v0.41.0-744-g304426c39`, OK;
- `ffmpeg:doctor`: OK;
- processi residui Eidetic/MPV/FFmpeg/Vite/Neutralino: 0;
- file diagnostici temporanei: rimossi;
- output precedenti: non sovrascritti.

## File interessati

Modifiche correttive principali:

- `apps/backend/src/player/mpv-controller.ts`
- `apps/backend/src/player/player-service.ts`
- `apps/backend/src/metadata/metadata-service.ts`
- `apps/backend/src/analysis/analysis-config.ts`
- `apps/backend/src/analysis/audio-analyzer-service.ts`
- `apps/backend/src/analysis/audio-analysis-engine.ts`
- `apps/backend/src/analysis/visualizer-hub.ts`
- `apps/backend/src/index.ts`
- `apps/backend/test/mpv.integration.ts`
- `apps/backend/test/ffmpeg.integration.ts`
- `packages/shared/src/player.ts`
- `packages/shared/src/visualizer.ts`
- `apps/ui/src/components/artwork.ts`
- `apps/ui/src/components/queue-drawer.ts`
- `apps/ui/src/components/mini-player.ts`
- `apps/ui/src/components/visualizer.ts`
- `apps/ui/src/visualizer/visualizer-stream-client.ts`
- `apps/ui/src/visualizer/meter-renderer.ts`
- `apps/ui/src/visualizer/spectrum-renderer.ts`
- `apps/ui/src/styles/components.css`
- `apps/ui/test/layout-geometry.test.ts`
- `.env.example`

Restano inoltre nel worktree le modifiche dello Step 2.3 già presenti prima di
questa correzione; non sono state scartate né sovrascritte.

## Limiti rimasti

- Il quinto e l'ottavo FLAC forniti sono illeggibili; non è possibile dichiarare
  che il quinto FLAC riproduca realmente senza sostituire o riparare il file,
  azione esplicitamente vietata.
- Il target Raspberry Pi 3 è predisposto ma non è stato dichiarato garantito:
  richiede misure sul dispositivo reale.
- Il renderer UI interpola a circa 21–23 draw/s con input analyzer 10–16 FPS:
  il limite di 30 FPS è rispettato, ma non viene prodotto lavoro inutile per
  raggiungere artificialmente 30 FPS.

## Correzione successiva: sostituzione Queue e apertura nona traccia

Dopo una segnalazione successiva è stato riprodotto un ulteriore caso di
sostituzione della Queue. La causa delle copertine estranee era composta da due
fattori:

- gli ID delle righe potevano essere riutilizzati dopo il riavvio del backend o
  quando veniva riaperta la stessa struttura;
- una risoluzione artwork lazy poteva completarsi dopo la sostituzione della
  Queue senza trasferire il relativo `ArtworkRef` nello stato autorevole.

La correzione ora:

- svuota e invalida immediatamente la vecchia Queue all'inizio di ogni Open;
- genera un UUID opaco nuovo per ogni QueueItem della nuova sessione Queue;
- impedisce che una richiesta legata al vecchio ID trovi una nuova riga;
- applica il risultato lazy allo stato Queue solo se ID e percorso sono ancora
  quelli richiesti;
- incrementa `queueRevision` quando quel riferimento artwork cambia.

È stato aggiunto un test MPV con due cartelle da dieci tracce: apre la nona della
prima, sostituisce la Queue, apre la nona della seconda, verifica zero
transizioni alla prima, zero ID riutilizzati e rifiuto dell'artwork richiesto
con il vecchio ID.

Test reali aggiuntivi con una sola istanza PlayerService:

1. prima MP3: index 0, 14 elementi, artwork embedded;
2. nona FLAC valida: index 8, `09 - Velvet Morning.flac`, 12 elementi, zero ID
   riutilizzati;
3. nona MP3: index 8, `09. Bejeweled.mp3`, 14 elementi, zero ID riutilizzati.

La stessa sequenza attraverso backend e finestra Neutralino reale ha restituito
`currentQueueIndex: 8`, `09. Bejeweled.mp3`, 14 righe, zero ID riutilizzati e
artwork embedded corretto. L'integrazione MPV passa ora 4/4 test.

## Correzione successiva: percorso UI Open Files e stato iniziale neutro

La verifica precedente apriva il file attraverso l'API usata dalla UI, ma non
simulava il valore restituito dal dialog nativo dopo il click sul pulsante
principale `Open Files`. Questo lasciava scoperta una differenza reale: il
dialog principale e `Add Files` usavano entrambi `multiSelections: true`.

I due percorsi sono ora separati:

- `Open Files` principale usa `multiSelections: false`;
- il coordinatore UI conserva e inoltra un solo percorso, esattamente quello
  restituito dal dialog;
- `Add Files` nella Queue mantiene `multiSelections: true`;
- drag and drop e apertura multipla esplicita del backend restano separati.

È stato aggiunto un test del coordinatore UI che simula il dialog Neutralino con
`C:/Music/09 Track.flac`, verifica `multiple: false` e controlla che al callback
di apertura arrivi esclusivamente quel percorso. Lo stesso coordinatore è ora
usato nel test MPV di sostituzione Queue.

Prova reale completa del percorso simulato UI → PlayerService → MPV:

- risultato dialog: nona MP3 reale;
- `dialogMultiple`: `false`;
- percorso inoltrato: soltanto `09. Bejeweled.mp3`;
- `currentQueueIndex`: `8`;
- traccia corrente: `09. Bejeweled.mp3`;
- Queue: 14 elementi.

Lo stato iniziale dell'interfaccia è stato reso neutro:

- il visualizer non disegna più Meter o Spectrum dimostrativi prima di ricevere
  un frame reale;
- il Canvas iniziale resta vuoto e scuro indipendentemente dalla modalità
  salvata;
- la waveform senza traccia non usa più una forma sintetica;
- mostra una rail discreta di barrette scure alte 3 px, senza progresso e senza
  playhead, così appare chiaramente vuota ma mantiene l'ingombro del controllo.

Il test automatico verifica altezza, colore e assenza del playhead nella
waveform vuota. La verifica visiva a 1296×839 mostra il pannello visualizer
completamente vuoto e scuro e una sola rail puntinata discreta nella timeline,
senza Meter, Spectrum o waveform sintetica. La suite principale passa ora
42/42 test.

## Diagnosi definitiva Open Files reale e simmetria Stereo

La separazione single/multi selection descritta sopra era corretta, ma non era
la causa sufficiente del caricamento della prima traccia. La diagnosi definitiva
è arrivata pilotando la WebView Neutralino reale via Chrome DevTools Protocol e
il vero dialog comune Windows via UI Automation/Win32:

1. click effettivo sul pulsante `.now-playing__open`;
2. apertura della finestra nativa `Open audio files`;
3. inserimento di `09. Bejeweled.mp3` nel campo nativo `Nome file`;
4. pressione del pulsante nativo `Apri`;
5. lettura dello stato restituito dal backend/MPV.

Il trace del runtime ha mostrato che Neutralino restituisce il percorso Windows
con slash Unix:

`C:/Users/dan88/Downloads/.../09. Bejeweled.mp3`

`buildQueue()` lo canonicalizza invece nel formato:

`C:\Users\dan88\Downloads\...\09. Bejeweled.mp3`

`PlayerService.pathKey()` confrontava le due stringhe senza normalizzarle. Il
`findIndex()` restituiva quindi `-1` e il fallback esistente
`Math.max(0, -1)` sceglieva sempre l'indice 0. I test precedenti usavano
backslash e non riproducevano il valore reale del dialog.

`pathKey()` usa ora `node:path.resolve()` prima del confronto case-insensitive.
Il test MPV del percorso UI usa deliberatamente slash `/` per impedire una
regressione.

Ripetendo lo stesso dialog Windows reale dopo il fix:

- file scelto: `09. Bejeweled.mp3`;
- `currentQueueIndex`: `8`;
- current: `09. Bejeweled.mp3`;
- Queue: 14 elementi;
- stato: `playing`.

Anche Spectrum Stereo è stato corretto. La versione precedente aveva posizioni
quasi speculari ma applicava il colore delle alte frequenze soltanto sul lato
destro, producendo un risultato visivamente asimmetrico. Il nuovo renderer:

- usa il centro esatto del Canvas come asse di simmetria;
- mantiene un gap centrale esplicito;
- colloca la stessa banda L/R alla stessa distanza dal centro;
- mantiene le basse frequenze verso il centro e le alte verso l'esterno;
- applica colori speculari alla coppia di bande;
- conserva ampiezze L/R indipendenti, quindi l'informazione stereo reale.

Il test geometrico verifica per tutte le 16 coppie che
`leftX + rightX + barWidth = canvasWidth`, oltre a larghezza e colore identici
per le posizioni speculari. La suite principale passa ora 43/43 test.

Output: `prompts/step2.3.1_output.md`.
