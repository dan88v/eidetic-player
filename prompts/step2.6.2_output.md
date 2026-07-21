# Step 2.6.2 completato

Implementata la modalità Main Player `Cassette` come prototipo SVG/CSS funzionante, mantenendo il Player `Default` invariato e il mini-player esistente come unico controllo di riproduzione.

## Risultato

- Aggiunto `MainPlayerMode = "default" | "cassette"`, separato da `VisualizerMode`, con persistenza locale, fallback `default` e selettore segmentato in Settings → Interface.
- Il nuovo Main Player host monta una sola superficie. Default continua a usare il componente Now Playing esistente; Cassette non istanzia visualizzatore, EventSource o analyzer FFmpeg.
- La scena Cassette usa soli SVG/CSS repo-native: guscio smoke, etichetta avorio, fascia corallo, accenti blu, branding statico, bobina sorgente a destra, destinazione a sinistra e meccanica superiore coerente con l’orientamento fisico a 180°.
- Il mini-player conserva markup e CSS precedenti. In Cassette è l’unico controllo; con Queue vuota viene disabilitato. Il seek preview alimenta solo la rappresentazione del nastro e non aggiunge comandi Player.
- Errori di inizializzazione o runtime della Cassette ripristinano `Default`, persistono il fallback e mostrano al massimo un toast condiviso senza pulsanti.

## Dati Queue e fisica

- `QueueItem.durationSeconds` è opzionale e retrocompatibile. MPV alimenta la durata corrente; il `MetadataService` esistente arricchisce in modo non bloccante corrente, adiacenti e righe richieste lazy.
- Gli aggiornamenti metadata/durata non incrementano `queueRevision`; il Queue drawer riconcilia i campi cambiati senza ricostruzioni strutturali e mantiene ID stabili.
- Progresso esatto: `(durate precedenti + posizione corrente) / durata totale`.
- Nessuna durata Queue nota: `(indice corrente + progresso brano) / lunghezza Queue`.
- Durate parziali: mediana delle durate note, poi durata corrente e fallback neutro documentato di 180 s. Il risultato è sempre finito e limitato a `[0,1]`, con confidenza `exact` o `estimated`.
- Le masse rispettano l’area: `source = sqrt(core² + (1-progress) × tapeArea)` e `destination = sqrt(core² + progress × tapeArea)`.
- La velocità angolare deriva da velocità lineare/raggio, è limitata; gli angoli sono integrati con `dt` massimo 100 ms e non vengono derivati dal progresso, quindi il seek non produce salti dei mozzi.

## Lifecycle e prestazioni

- Un solo controller possiede al massimo un `requestAnimationFrame`; il rendering è limitato a 30 fps e usa trasformazioni/opacità sui layer riutilizzati.
- Playing mantiene il loop; paused, stopped ed empty completano il breve assestamento e poi non lasciano frame pendenti. La visibilità nascosta cancella il loop e azzera il delta.
- Animations Off e `prefers-reduced-motion` applicano immediatamente uno stato statico senza loop continuo.
- In prova Cassette erano presenti un solo mini-player, zero controlli interni, zero visualizzatori e nessun processo FFmpeg. Lo shutdown Neutralino ha chiuso backend, Vite, MPV e processi figli senza residui.
- Impatto build rispetto al baseline osservato: JS `157.24 → 158.26 kB` (`43.58 → 43.84 kB` gzip); CSS `57.95 → 58.05 kB` (`10.03 → 10.06 kB` gzip). Nessuna dipendenza aggiunta.

## QA responsive

Verifica reale Chromium/Vite con backend attivo:

| Viewport | Area centrale |    Scena | Esito                      |
| -------- | ------------: | -------: | -------------------------- |
| 1280×800 |      1280×620 | 1072×591 | contenuta, nessun overflow |
| 1366×768 |      1366×588 | 1072×560 | contenuta, nessun overflow |
| 1600×900 |      1600×720 | 1072×688 | contenuta, nessun overflow |
| 1280×720 |      1280×540 | 1072×514 | contenuta, nessun overflow |
| 1024×600 |      1024×420 |  752×396 | contenuta, nessun overflow |

Il Player Default non è stato modificato in markup o CSS; l’integrazione avviene solo nel factory host. Gli screenshot temporanei di QA e il profilo browser temporaneo sono stati eliminati e nessun concept/asset è stato aggiunto al repository.

## Verifiche

- `npm.cmd ci` — superato; 212 pacchetti verificati.
- `npm.cmd audit` — 0 vulnerabilità.
- `npm.cmd run format:check` — superato.
- `npm.cmd run typecheck` — superato.
- `npm.cmd run lint` — superato.
- `npm.cmd run build` — superato.
- `npm.cmd test` — 237 test: 235 superati, 2 skip POSIX previsti su Windows.
- `npm.cmd run mpv:doctor` — MPV v0.41, startup headless e JSON IPC OK.
- `npm.cmd run test:mpv` — 4/4 superati.
- `npm.cmd run ffmpeg:doctor` — esecuzione FFmpeg OK.
- `npm.cmd run test:ffmpeg` — 3/3 superati, incluso il vincolo di un solo analyzer realtime.
- `npm.cmd run dev` — catena reale backend → Vite → Neutralino avviata e chiusa correttamente.
- GitHub Actions baseline `df2c08e`: [workflow “Eidetic Player CI” #3](https://github.com/dan88v/eidetic-player/actions/runs/29788891003) riuscito in 47 s. Le modifiche locali correnti non sono state pubblicate.

## File principali

Nuovi: `apps/ui/src/cassette/*`, `apps/ui/src/main-player/main-player-host.ts`, `apps/ui/src/styles/cassette-player.css`, `apps/ui/test/step2.6.2.test.ts`, `docs/development/cassette-player.md`.

Integrati: contratti Player condivisi, PlayerService, AppState/store/storage/bootstrap, screen factory, Settings, app shell, mini-player, Queue drawer, i18n e documentazione architetturale/UI.

## Limite residuo

Non era disponibile hardware Raspberry Pi 3B per una misura fisica di CPU/heap; i budget sono protetti strutturalmente dal limite 30 fps, dal singolo rAF, dall’assenza di analyzer in Cassette e dallo stop completo fuori da playing/transizione. Nessun asset premium è stato generato o incluso: è correttamente rinviato allo Step 2.6.3.
