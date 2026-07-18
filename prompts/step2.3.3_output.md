# Step 2.3.3 — Final UI controls and chrome refinement

Data: 2026-07-18

## Esito

Step 2.3.3 completato senza procedere allo Step 2.4. La rifinitura è rimasta
frontend-only: backend, MPV, FFmpeg, SSE e il modello audio non sono stati
modificati in questo step. La macchina seamless dello Step 2.3.2 è rimasta
intatta.

## File creati

- `apps/ui/test/chrome-refinement.test.ts`
- `prompts/step2.3.3_output.md`

## File modificati

- `apps/ui/src/components/app-shell.ts`
- `apps/ui/src/components/artwork.ts`
- `apps/ui/src/components/icons.ts`
- `apps/ui/src/components/mini-player.ts`
- `apps/ui/src/components/timeline.ts`
- `apps/ui/src/components/top-bar.ts`
- `apps/ui/src/i18n/en.ts`
- `apps/ui/src/main.ts`
- `apps/ui/src/screens/index.ts`
- `apps/ui/src/screens/now-playing.ts`
- `apps/ui/src/screens/sources.ts`
- `apps/ui/src/state/store.ts`
- `apps/ui/src/state/types.ts`
- `apps/ui/src/styles/components.css`
- `apps/ui/src/styles/responsive.css`
- `apps/ui/src/styles/screens.css`
- `apps/ui/src/utils/storage.ts`
- `apps/ui/src/utils/viewport.ts`
- `docs/development/ui-ux.md`
- `docs/ui.md`

## Modifiche UI

- Lo stato artwork vuoto mantiene la geometria scura 1:1, ma non renderizza
  testo, icone, spinner, bordo, ombra o card. La cover Now Playing e i suoi
  layer hanno `border-radius: 0`; l'immagine resta full-area,
  `object-fit: cover`, senza padding e con decode-before-swap/generation guard.
- La top bar contiene solo Hamburger e titolo a sinistra. Home e il device audio
  sono stati rimossi esclusivamente dal rendering.
- Ethernet, Wi-Fi e USB/DAC sono SVG locali attenuati, non interattivi,
  non focusable e `aria-hidden`, con un commento che ne chiarisce la natura di
  placeholder per un binding futuro.
- Il mini-player presenta Previous, Play/Pause, Next e Home in questo ordine.
  Previous/Next usano i comandi reali e tutti i pulsanti arrestano la
  propagazione; Home resta l'ultimo controllo e torna a Now Playing. Non è stato
  aggiunto alcun counter temporale.
- Nel Now Playing Library resta a sinistra; Volume è stato spostato nel gruppo
  destro immediatamente prima di Queue. Il gruppo centrale non è cambiato e
  Play/Pause resta centrato.
- L'overlay viewport e il relativo listener/helper DOM sono stati rimossi dalla
  UI normale.
- Il counter destro della timeline è un vero button: alterna durata totale e
  remaining negativo, aggiorna il solo testo interessato, espone label e stato
  accessibili, resta stabile e si disabilita senza durata valida.
- Elapsed e remaining sono derivati dalla stessa posizione intera: anche con
  durate MPV frazionarie cambiano secondo nello stesso render.
- La preferenza tipizzata `TimelineTimeMode = "total" | "remaining"` usa la
  chiave `eidetic-player.interface.timeline-time-mode`, ha fallback `total` e
  persiste tra tracce, schermate e riavvii.
- L'eyebrow Sources usa la chiave i18n `app.name`: `Eidetic Player`.
- Titolo, artista, album e technical riservano spazio esplicito per discendenti
  e antialiasing; artista e album usano ellissi native senza line-clamp WebKit.
- Le zone Library, transport centrale e Volume/Queue condividono lo stesso asse
  verticale. L'SVG Hamburger è stato ulteriormente portato a 36×36 px.

## Misure WebView2 / Neutralino

Misure principali a 1280×800:

- Hamburger: 64×64 px; SVG: 36×36 px.
- Indicatori Ethernet/Wi-Fi/USB: 26×26 px; gap: 12 px.
- Gap USB/orologio: 18 px.
- Centro verticale dei tre indicatori e dell'orologio: 36 px; scarto: 0 px.
- Orologio: 25 px, numeri tabulari, aggiornamento ogni 60.000 ms.
- Mini-player: 108 px.
- Previous/Play/Next/Home: 56/64/56/56 px.
- Gap Previous–Play e Play–Next: 8 px; gap Next–Home: 16 px.
- Home a x=1192…1248 px, ultimo controllo con inset destro 32 px.
- Rail mini-player: 8 px; hit area: 40 px.
- Volume a x=1097,61 px; Queue a x=1177,61 px, ultimo controllo.
- Centri verticali Library, Shuffle, Previous, Play/Pause, Next, Repeat, Volume
  e Queue: un unico asse; scarto previsto e verificato dal contratto CSS: 0 px.
- Centro Play/Pause rispetto al viewport: scarto 0 px.
- Artwork: 500×500 px, `border-radius: 0`, padding 0.
- Counter timeline: 104×60 px, font 25 px.
- Popover Volume: 116×264 px, completamente nel viewport, sopra il trigger,
  senza sovrapporre Queue o Play/Pause e senza scroll.

Stabilità durante 20 cambi reali:

- `trackTransitionId`: incremento esatto di 20.
- layout shift non buffered: 0.
- full render Now Playing: 0.
- Queue structural rebuild: 0.
- righe Queue: 3 → 3; una sola riga `aria-current`.
- geometria di titolo, artista, album, technical, visualizer, timeline e artwork:
  differenza 0 px.
- superfici campionate: sempre scure, nessun frame bianco.

Responsive verificato in Neutralino/WebView2:

- 1280×800
- 1366×768
- 1600×900
- 1280×720
- 1024×600

In ogni viewport: overflow orizzontale 0, indicatori e orologio visibili,
Play/Pause centrato con scarto 0 px, Volume prima di Queue, tutti i quattro
controlli mini-player visibili e nessun counter nel mini-player.

## Verifiche manuali

- Avvio reale Neutralino senza brano: artwork vuoto, `0:00` disabilitato,
  nessun overlay e nessun overflow.
- Fixture FLAC reale con PNG embedded: immagine decodificata, quadrata,
  `object-fit: cover`, inset 0, alt localizzato e background scuro.
- Brano reale senza artwork: sola superficie scura vuota.
- Previous e Next dal mini-player hanno cambiato l'indice Queue senza aprire
  Now Playing; Play/Pause è rimasto reale.
- Seek mini-player da tastiera: 0 → 0,079993 s.
- Home è tornato a Now Playing senza alterare il playback.
- Total `0:08` → remaining `-0:07`; dopo reload la modalità `remaining` e la
  label `Show total duration` erano ancora presenti.
- Volume: Escape, click outside/focus restore e mutua esclusione con Queue
  verificati; Queue drawer e righe keyed invariati.
- Sources ha mostrato l'eyebrow `Eidetic Player`.
- Eseguiti due cicli da 20 transizioni; il ciclo strumentato finale ha riportato
  zero layout shift.
- Chiusura della finestra Neutralino durante playback riuscita; processi
  residui Node/backend, Neutralino, MPV e FFmpeg: 0.

## Test e controlli

- `npm audit`: 0 vulnerabilità.
- `npm run format:check`: OK.
- `npm run typecheck`: OK.
- `npm run lint`: OK.
- `npm run build`: OK.
- `npm test`: 112/112, inclusi 38 contratti Step 2.3.3 e i controlli dedicati a
  timer sincronizzati, discendenti e asse verticale.
- `npm run mpv:doctor`: OK.
- `npm run ffmpeg:doctor`: OK.
- `npm run test:mpv`: 4/4.
- `npm run test:ffmpeg`: 2/2.
- Avvio e chiusura Neutralino reali: OK.

## Bundle

| Asset |      Prima Step 2.3.3 |       Dopo Step 2.3.3 |    Differenza |
| ----- | --------------------: | --------------------: | ------------: |
| HTML  |   0,49 kB / 0,30 gzip |   0,49 kB / 0,30 gzip |     invariato |
| CSS   |  30,65 kB / 5,89 gzip |  30,66 kB / 5,89 gzip |     +0,01 / 0 |
| JS    | 68,29 kB / 20,36 gzip | 69,63 kB / 20,81 gzip | +1,34 / +0,45 |

## Regressioni controllate

- `playerSessionId`, `trackTransitionId` e `TrackTransitionCoordinator`
  preservati.
- Metadata atomici, artwork cache/decode/generation, waveform generation guard,
  visualizer decay, Queue keyed, mini-player seek e superfici scure preservati.
- Nessun EventSource, rAF o analyzer aggiunto.
- Nessun refresh, rebuild strutturale, flash bianco o layout shift osservato.
- Nessun polling o timer aggiuntivo per sincronizzare i counter: entrambi
  continuano ad aggiornarsi nello stesso passaggio dello stato player.

## Limiti

- Ethernet, Wi-Fi e USB/DAC sono intenzionalmente placeholder neutrali: nessun
  polling, stato reale, tooltip o API è stato aggiunto.
- Non è stato aggiunto elapsed/duration al mini-player.
- Nessuna funzionalità audio, schermata, dipendenza o attività Step 2.4 è stata
  introdotta.
