# Step 2.3.2 — Seamless track transitions

Data: 2026-07-18

## Esito

Lo step correttivo è implementato senza nuove funzionalità, framework o
dipendenze. Next, Previous, selezione Queue, nuova Queue e cambio automatico
usano ora una transizione atomica identificata da `playerSessionId` e
`trackTransitionId`. Metadata, artwork, waveform, visualizer, Queue current,
posizione e durata convergono sulla stessa identità; risultati asincroni
obsoleti non vengono applicati.

Le prove reali con Neutralino/WebView2, MPV, FFmpeg e i due album approvati
hanno prodotto zero stati vuoti, zero metadata/artwork misti, zero waveform
vecchie osservate, zero layout shift e zero rebuild strutturali della Queue.

## Diagnosi e cause

Causa primaria:

- `PlayerService` pubblicava `status: loading` e `currentTrack: null` a ogni
  `start-file`;
- ogni singolo `property-change` MPV derivava poi un nuovo stato usando
  temporaneamente proprietà vecchie e nuove.

Questo rendeva visibili `No track loaded`, metadata spezzati e coppie
posizione/durata incoerenti. La prima riproduzione reale ha inoltre dimostrato
che MPV può cambiare `path` o `playlist-pos` prima di `start-file`: la baseline
ha registrato 19 snapshot vuoti su 20 cambi e una timeline incoerente.

Cause secondarie:

- nessun token di transizione condiviso dal contratto UI;
- preload limitato alla sola traccia successiva e non consegnato al componente
  artwork;
- artwork, waveform e visualizer usavano guard indipendenti;
- visualizer accettava frame senza verificare la generazione;
- titolo, artista, album e riga tecnica non riservavano geometria finale;
- Play, Volume e testi venivano riscritti a ogni tick anche se invariati;
- un riavvio backend azzerava la generazione numerica e poteva far sembrare
  obsoleta la nuova sessione;
- gli abort waveform attesi attraversavano il gestore HTTP come errori 500.

File responsabili principali:

- `apps/backend/src/player/player-service.ts`;
- `apps/ui/src/screens/now-playing.ts`;
- `apps/ui/src/components/artwork.ts`;
- `apps/ui/src/components/visualizer.ts`;
- `apps/ui/src/timeline/waveform-loader.ts`;
- `apps/ui/src/components/mini-player.ts`;
- CSS di Now Playing e superfici Canvas.

## Architettura e comportamento

- `PlayerService` apre una generazione dal primo cambio di `path`,
  `playlist-pos` o `start-file`, sospende gli snapshot transitori e pubblica
  soltanto dopo un refresh MPV completo.
- `playerSessionId` rende sicuro l'ordinamento dopo una riconnessione backend;
  `trackTransitionId` è monotono nella sessione.
- `TrackTransitionCoordinator` rifiuta sessioni/generazioni obsolete e produce
  un unico `TrackPresentationSnapshot`.
- Metadata Now Playing e mini-player vengono aggiornati nello stesso task e
  modificano solo i nodi testuali cambiati.
- Next/Previous mantengono un target Queue più recente senza disabilitare i
  controlli; cinque Next rapidi hanno raggiunto l'indice finale richiesto senza
  errori.
- Il preload è limitato a current, next e previous. Metadata/artwork usano una
  cache massima di tre identità; le immagini decodificate usano una cache UI
  massima di quattro revisioni.
- Su artwork miss la vecchia immagine viene rimossa subito e resta il
  placeholder scuro permanente. Lo swap avviene solo dopo `decode()`.
- La waveform precedente viene invalidata subito, lasciando la rail neutra; la
  risposta è legata a Queue ID e generazione. Current e next vengono richieste,
  previous viene riusata soltanto se già in cache.
- Il visualizer verifica Queue ID e generazione, porta i buffer a zero in circa
  100 ms usando il solo rAF esistente e scarta i frame obsoleti.
- Artwork e waveform usano una dissolvenza di 140 ms. Animations Off e
  `prefers-reduced-motion` applicano lo stato immediatamente.
- Queue conserva righe, ID, observer, scroll e focus; cambia solo class,
  `aria-current`, indicatore e dati realmente diversi.
- HTML, body, app shell, Now Playing, artwork e Canvas hanno background scuri
  espliciti.

## Misure

### Stato e transizione reale

| Prova                      | Cambi | Stati vuoti | Artwork miste | Timeline incoerenti |    Media |   Massimo |
| -------------------------- | ----: | ----------: | ------------: | ------------------: | -------: | --------: |
| MP3 quinta, Next/Previous  |    20 |           0 |             0 |                   0 | 45,45 ms |  86,77 ms |
| FLAC valido, Next/Previous |    20 |           0 |             0 |                   0 | 68,29 ms | 103,72 ms |

- cinque Next rapidi: indice 4 → 9, generazione +5, 0 stati vuoti, 0 errori;
- Next/Previous rapidi: convergenza finale senza snapshot vuoti o durata
  incoerente;
- cambio automatico: generazione avanzata, 0 stati vuoti, 0 timeline oltre
  100%;
- snapshot metadata: commit JavaScript sincrono nella stessa pubblicazione;
- artwork preload hit: consegna prima del paint successivo;
- artwork cache miss: placeholder immediato, tempo decode dipendente dal file;
- waveform reale: stato WebView `ready`, 194 barre nella misura campione;
- dissolvenza artwork/waveform: 140 ms;
- decay visualizer: circa 100 ms a 30 FPS;
- risultati visualizer obsoleti osservati nel run finale: 0;
- una sola istanza EventSource e un solo handle rAF per visualizer;
- processi: 1 MPV, 1 FFmpeg realtime; un secondo FFmpeg soltanto durante la
  waveform bounded, mai un analyzer duplicato;
- generazioni/fetch abortiti: il cleanup è verificato, ma il conteggio totale
  per singolo stage non è stato strumentato.

### Geometria WebView2 reale a 1280×800

| Elemento                     |               Prima | Dopo 20 cambi | Differenza |
| ---------------------------- | ------------------: | ------------: | ---------: |
| titolo top / bottom / height | 88 / 186,61 / 98,61 |        uguale |       0 px |
| artista top / height         |      198,61 / 33,34 |        uguale |       0 px |
| album top / height           |      239,95 / 27,59 |        uguale |       0 px |
| technical top / height       |      285,55 / 23,39 |        uguale |       0 px |
| visualizer top / height      |           424 / 164 |        uguale |       0 px |
| timeline top / height        |            616 / 60 |        uguale |       0 px |
| artwork                      |             500×500 |       500×500 |       0 px |

- layout shift: 0;
- full render Now Playing: 0;
- Queue structural rebuild durante 20 cambi: 0;
- righe Queue: 14 → 14;
- scroll Queue nella prova aperta: 180 → 180;
- sostituzioni nel sottoalbero Now Playing: 40, esclusivamente remove/append
  dei layer immagine per 20 swap; i metadata aggiornano i Text node in place;
- mini-player: height 108 px, timeline hit area 40 px, rail 8 px, differenza
  prima/dopo 0 px, due sostituzioni per il solo layer artwork.

Le superfici misurate erano sempre scure:

- html/body: `rgb(11, 14, 20)`;
- app/Canvas: `rgb(10, 12, 16)`.

Viewport reali verificati senza overflow orizzontale:

- 1280×800;
- 1366×768;
- 1600×900;
- 1280×720;
- 1024×600.

Animations Off e reduced motion hanno entrambi restituito
`transition-duration: 0s`.

## Test

- `npm audit`: 0 vulnerabilità;
- `format:check`: OK;
- `typecheck`: OK;
- `lint`: OK;
- `build`: OK;
- test automatici: 74/74;
- nuovi test seamless: 31, inclusi tutti i 30 casi richiesti e la
  riconnessione di sessione;
- `mpv:doctor`: MPV `v0.41.0-744-g304426c39`, OK;
- integrazione MPV: 4/4;
- `ffmpeg:doctor`: build 2026-07-16, OK;
- integrazione FFmpeg: 2/2;
- Neutralino reale con WebView2: OK;
- MP3 quinta, 20 cambi, Queue aperta, cinque Next rapidi: OK;
- FLAC sesto valido, 20 cambi e cambio automatico: OK;
- repeat one, repeat all e Shuffle: verificati;
- artwork preload, waveform reale, visualizer e mini-player: verificati;
- chiusura durante playback: 0 processi MPV, FFmpeg, Neutralino, Node/Vite o
  backend del progetto residui.

## Bundle e dipendenze

- HTML: 0,49 kB raw, 0,30 kB gzip;
- CSS: 30,65 kB raw, 5,89 kB gzip;
- JavaScript: 68,29 kB raw, 20,36 kB gzip;
- nuove dipendenze: nessuna.

## File

Creati:

- `apps/ui/src/state/track-transition-coordinator.ts`;
- `apps/ui/test/track-transition.test.ts`;
- `prompts/step2.3.2_output.md`.

Modificati:

- player contract e visualizer contract condivisi;
- `PlayerService`, analyzer, hub visualizer e route waveform backend;
- AppShell, Now Playing, artwork, mini-player, Queue, timeline, visualizer e
  relativi loader/stili UI;
- test FFmpeg;
- `docs/development/ui-ux.md`;
- `docs/development/performance.md`;
- `docs/development/testing.md`;
- `docs/architecture.md`;
- `docs/ui.md`.

`AGENTS.md` era già adeguato e non è stato modificato. Gli output precedenti
non sono stati sovrascritti.

## Limiti

- Il quinto e l'ottavo FLAC approvati restano corrotti e sono rifiutati da MPV,
  FFmpeg e parser; i file non sono stati modificati. Per le prove valide è stato
  usato il sesto FLAC.
- Nei due album approvati non è stato trovato un brano realmente privo di
  artwork; il cache miss è coperto automaticamente e verificato nel componente,
  ma non con un terzo file reale.
- I tempi separati parser/artwork decode/waveform e il numero totale di fetch
  abortiti non hanno contatori production dedicati; sono stati verificati
  comportamento, cancellazione e risultato finale.
- Il pannello touch fisico e Raspberry Pi 3B non erano disponibili. Non viene
  dichiarata una prestazione definitiva sul dispositivo.
- Nessuna funzionalità dello Step 2.4 è stata introdotta.
