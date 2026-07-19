# Step 2.4.4 — Visual QA, enhanced meter & technical loudness view

Data: 19 luglio 2026  
Esito: completato. Non è stato avviato lo Step 2.5.

## Implementazione

- Il meter L/R usa ora una mappa enhanced continua e deterministica:
  −60…−24 dB = 0…30%, −24…−12 dB = 30…60%, −12…−6 dB = 60…80% e
  −6…0 dB = 80…100%. Scala, riempimento, soglie e peak marker condividono la
  stessa funzione.
- I valori trasmessi dal backend sono sample peak onesti. La ballistica vive
  nel frontend, nel dominio dB e nello stesso rAF esistente: attack 10 ms,
  release 350 ms, hold 900 ms e decay del hold 12 dB/s.
- Pausa congela meter e hold. Seek, cambio traccia, cambio identità incompatibile
  e teardown azzerano i dati transitori senza timer o loop aggiuntivi.
- È stata aggiunta la modalità `Technical`. Ciclo rapido e Settings usano ora
  lo stesso ordine: Mono Spectrum → Stereo Spectrum → Meter → Technical → None.
  Persistenza e fallback dei valori precedenti restano compatibili.
- Technical mostra Crest Factor, LUFS-S e un meter stereo peak-hold compatto.
  Il Crest è il massimo rapporto Peak/RMS dei due canali, espresso in dB e
  limitato a 0…60 dB; lo stato senza misura usa em dash e non inventa numeri.
- Nel meter Technical le barre sono state aumentate da 10 a 14 px. Il segnale è
  blu sotto −18 dBFS, arancio da −18 dBFS e rosso da −3 dBFS. I valori Crest e
  LUFS-S usano ora 44 px, ridotti a 38 px soltanto nel layout compatto.
- Il meter L/R non Technical mantiene mapping, divisioni interne e peak hold ma
  non mostra più la scala numerica né la dicitura dB.
- LUFS-S è calcolato dal PCM stereo già disponibile con filtri K-weighting
  high-shelf/high-pass, somma energetica dei canali e finestra mobile esatta di
  3 secondi. Non sono stati aggiunti true peak, integrated loudness, LRA,
  gating history o normalization.
- La finestra loudness usa un ring `Float64Array` preallocato, stato filtro
  fisso e nessuna allocazione per sample. A 24 kHz occupa 576.000 byte.
- Frame e buffer visualizer includono e verificano sessione player, traccia,
  generazione, sample rate e modalità. Technical riusa un solo analyzer, un
  solo EventSource, un solo Canvas e un solo rAF.
- Il frame selezionato usa un lead di presentazione fisso di 120 ms sulla
  posizione udibile. Compensa la latenza combinata di analyzer, SSE e display
  senza anticipare o modificare l'audio e senza aggiungere timer o stream.

## Correzioni emerse dal QA reale

- Il registro artwork bounded poteva espellere una cover embedded mentre la
  cache metadati conservava i tag ma non i byte immagine. Una lettura cache
  successiva finiva quindi per fissare `artwork: null`. La cache ricorda ora
  soltanto se esisteva artwork embedded e rilegge selettivamente quel file
  quando il riferimento opaco non è più disponibile. Non vengono trattenuti
  buffer immagine e non esistono condizioni specifiche per artista o percorso.
- A 1280×720 e 1024×600 l'altezza standard del visualizer poteva sovrapporsi ad
  artista, album e dettagli. Alle altezze ridotte il titolo usa una riga e il
  pannello Technical passa rispettivamente a 8 rem e 7 rem. Metadati, valori,
  scala e barre restano separati.
- La Grid Folders dipendeva da `auto-fill`: la scrollbar presente al rientro da
  una directory poteva far scattare la radice da quattro a tre colonne. La Grid
  desktop usa ora quattro colonne deterministiche; i breakpoint esistenti
  continuano a ridurla a due e una colonna.
- Su Windows il runner development terminava forzatamente il backend dopo la
  chiusura Neutralino, impedendo la pulizia asincrona delle directory artwork.
  Il runner richiede ora lo shutdown development locale con token casuale
  per-processo e attende la chiusura backend prima del fallback forzato.
  All'avvio vengono inoltre rimosse soltanto directory artwork dal nome valido
  appartenenti a PID non più vivi.

## Misure meter e loudness

- Baseline Taylor, vecchia geometria lineare dB: L medio −3,45 dB, R medio
  −3,14 dB; rispettivamente 89,5% e 91,5% dei campioni visivi oltre il 90%
  della barra.
- Enhanced Taylor: L medio −4,76 dB, R medio −4,31 dB; 35,2% e 34,6% oltre il
  90%. Il range visivo osservato è passato a 54,2…99,5% L e 57,9…99,5% R.
- Enhanced Kacey: 4,4% L e 0% R oltre il 90%; Richard: 1,9% per entrambi i
  canali; Aerosmith: 61,8% L e 63,4% R. Il materiale molto compresso rimane
  correttamente alto, mentre il meter non appare più quasi pieno per ogni
  sorgente.
- LUFS-S osservato a fine finestra: Taylor −10,0 LUFS, Kacey −14,9 LUFS,
  Richard −14,1 LUFS e Aerosmith −8,3 LUFS.
- Riferimento reale Taylor “Lavender Haze”, posizione analyzer 8,62 s:
  implementazione −8,8 LUFS-S, FFmpeg `ebur128` −8,8 LUFS, differenza 0,0 LU.
- Benchmark sintetico della sola misura LUFS, 120 secondi audio per run:
  36,59…42,10 ms, media 38,95 ms, pari a circa 0,325 ms per secondo audio e
  0,032% di un core Windows. Non è una misura Raspberry Pi.
- Durante Technical reale attivo per 10 secondi: backend Node 0,875 s CPU,
  MPV 0,156 s, Neutralino 0 s nel campione; working set rispettivamente
  124,5 MiB, 46,7 MiB e 22,8 MiB. È un dato complessivo di runtime, non il solo
  incremento LUFS.

## QA Neutralino/WebView reale

- Avvio e controllo eseguiti con `npm.cmd run dev` sulla finestra Neutralino
  reale. Screenshot ottenuti dalla finestra nativa, click inviati al child
  WebView e stato verificato anche tramite API backend.
- Viewport verificati: 1280×800, 1366×768, 1600×900, 1280×720 e 1024×600.
  Nessun overflow orizzontale, sovrapposizione del visualizer, testo tagliato o
  controllo irraggiungibile dopo la correzione responsive.
- Verificati Meter, Mono Spectrum, Stereo Spectrum, Technical e None mediante
  ciclo/persistenza coperti dai test; Technical è stato ispezionato in stato
  neutro, popolato, playing e paused.
- Il ritocco Crest/colori è stato verificato nel Neutralino reale a 1280×800 e
  1024×600: valori e unità non collidono, le soglie cromatiche sono visibili e
  il Meter normale non presenta più testo di scala.
- Verificato nel Neutralino reale il percorso Folders root → directory → Back:
  al rientro la Grid mantiene quattro colonne. Acquisiti gli screenshot nativi
  `docs/images/now-playing-technical.png` e `docs/images/folders.png`, entrambi
  inclusi nel README per GitHub.
- In pausa due acquisizioni della regione Technical a due secondi di distanza
  hanno prodotto zero pixel differenti: valori, meter e hold restano congelati.
- Taylor: 14/14 metadata con artwork, 14/14 GET immagine HTTP 200 e 14/14
  miniature visibili. Sono stati ispezionati l'inizio lista, lo scroll
  intermedio e il fondo con Mastermind e Meet me at midnight.
- Folders root verificata in List e Grid con cover reali, file count, sorting,
  menu a tre punti e mini-player. `Add to Queue` già presente mostra il solo
  toast condiviso “Track is already in Queue.” sopra il mini-player.
- Reload caldo della WebView riuscito: modalità Technical persistita,
  connessioni ricostruite e stato FLAC reale ripreso correttamente.
- Relaunch completo riuscito: Maroon ripristinata paused a 0:00, Technical
  persistito e una sola directory artwork appartenente all'istanza attiva.
  Dopo la chiusura: 0 processi progetto/native, 0 listener 4310/5173 e
  0 directory artwork temporanee.
- MP3 Taylor/Kacey e FLAC Richard/Aerosmith sono stati misurati. Su Richard
  reale sono stati provati play, pause, seek a 30 s, resume, Next e Previous;
  metadati FLAC 16-bit/44,1 kHz e Technical popolato erano coerenti.
- Eseguiti 20 cambi traccia consecutivi alternando due entry Taylor:
  `trackTransitionId` +20, stessa `playerSessionId`, stesso PID Neutralino,
  stesso PID MPV, stato finale playing e nessun errore.
- Con Technical montato è rimasta una sola connessione TCP established verso
  il backend; test statici verificano un solo EventSource e un solo handle rAF.

## Verifiche automatiche

- `npm audit`: 0 vulnerabilità.
- `format:check`: superato.
- `typecheck`: superato.
- `lint`: superato.
- `build`: superato.
- Test unitari/statici: 177/177.
- Bundle UI: HTML 2,48 kB, CSS 42,64 kB, JS 111,57 kB.
- `mpv:doctor`: superato, MPV v0.41.0-744-g304426c39.
- `ffmpeg:doctor`: superato, build 2026-07-16.
- Integrazione MPV: 4/4.
- Integrazione FFmpeg: 3/3, incluso confronto `ebur128`.

## File principali creati

- `apps/backend/src/analysis/short-term-loudness-meter.ts`
- `apps/backend/test/short-term-loudness.test.ts`
- `apps/ui/src/visualizer/meter-ballistics.ts`
- `apps/ui/src/visualizer/technical-renderer.ts`
- `apps/ui/test/meter-ballistics.test.ts`
- `apps/ui/test/step2.4.4.test.ts`
- `prompts/step2.4.4_output.md`

## Regressioni e limiti

Restano invariati playback MPV, un solo analyzer FFmpeg, waveform, Queue,
mini-player, toast unico, Folders/Library coexistenti, path logici e guard di
generazione. Non sono state aggiunte dipendenze runtime, processi persistenti,
EventSource, rAF, timer meter o buffer PCM duplicati.

Il meter indica sample peak dBFS, non true peak. Crest Factor usa Peak/RMS della
finestra analyzer, non è una misura DR integrata. LUFS-S è short-term su
3 secondi: non è integrated loudness e non applica normalization. Le misure
Windows non autorizzano affermazioni sulle prestazioni Raspberry Pi 3B.

## Prossimo step

Il prossimo step pianificato rimane **Step 2.4.5 — Linux/Debian/Raspberry Pi
runtime audit**. Lo Step 2.5 non è stato iniziato.
