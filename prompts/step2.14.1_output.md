# Step 2.14.1 — Native touch scrolling and selection suppression

## Esito

PASS su Windows per implementazione, test automatici, smoke reale
Neutralino/WebView2, MPV reale e non-regressione installer. Il test fisico sul
Raspberry Pi e l'emulazione touch Chromium restano esplicitamente non eseguiti.

Lo scope è rimasto UI/input. Non sono stati eseguiti commit o push.

## Baseline

- Branch: `main`.
- Working tree iniziale: pulito.
- HEAD e `origin/main`: allineati (`0 0`), commit
  `2fc4674e1918bfaaabc23466b6df5e48356c0d4b`
  (`step 2.14 r4 CI Validation Fix`).
- Nessun merge/rebase in corso; Step 2.14-R4 presente; Step 2.14.1 assente.
- Ultimo run `Eidetic Player CI` di `main`: `success`, run `30195360887`,
  stesso SHA della baseline.
- `git diff --check`: PASS.
- Baseline reale:
  - `npm.cmd run mpv:doctor`: PASS con `C:\Tools\mpv\mpv.exe`;
  - `npm.cmd run dev`: backend 4310, Vite 5173 e Neutralino/WebView2 avviati;
  - traccia reale caricata; Play/Pause/Previous/Next: PASS;
  - wheel: PASS su pagina lunga;
  - selezione involontaria riprodotta trascinando il titolo Now Playing
    (`Funeral For A Frie` copiabile);
  - chiusura pulita e nessun processo/listener residuo.
- Problema touch Raspberry riportato dall'utente: il trascinamento verticale
  non scorre le pagine. Non è stato dichiarato riprodotto o PASS senza hardware.

## Audit e root cause

La catena principale era già correttamente vincolata:
`html/body/#app` non scorrono, `.app-root` usa una griglia ad altezza fissa,
`.content-shell` ha `min-height: 0` e `.screen-region` è l'unico proprietario
dello scroll pagina. Non sono emersi listener globali `touchmove`, blocchi wheel,
overlay trasparenti, `preventDefault()` generali o capture applicate a
card/righe.

Le cause minime individuate erano:

1. gli scroller nativi non dichiaravano esplicitamente a WebKitGTK la proprietà
   del pan verticale (`touch-action: pan-y`) e il fallback cinetico WebKit;
2. la root non sopprimeva la selezione, quindi un drag sul testo poteva essere
   acquisito come selezione invece che come pan;
3. il drag Queue aveva un difetto distinto ma nello stesso livello input:
   ogni snapshot Queue prodotto dai tick SSE chiamava
   `cancelActiveReorder`, anche quando ID e ordine erano invariati. Un drag lento
   durante playback veniva quindi annullato. La Playlist non riceve quella
   riconciliazione player durante il gesto.

Nessuno scroll engine JavaScript è stato introdotto.

## Ownership scroll e touch

| Superficie                                                                        | Proprietario              | Policy                                 |
| --------------------------------------------------------------------------------- | ------------------------- | -------------------------------------- |
| Root applicativa                                                                  | nessuno, shell fissa      | non selezionabile                      |
| Pagine lunghe                                                                     | `.screen-region`          | native `overflow-y: auto`, `pan-y`     |
| Drawer                                                                            | `.side-menu__nav`         | native `overflow-y: auto`, `pan-y`     |
| Queue                                                                             | `.queue-list`             | native `overflow-y: auto`, `pan-y`     |
| Playlist picker                                                                   | `.playlist-picker__body`  | native `overflow-y: auto`, `pan-y`     |
| Dialog SMB                                                                        | `.smb-dialog__body`       | native `overflow-y: auto`, `pan-y`     |
| Library, Sources, Settings, Favorites, History, Playlists, USB e SMB Quick Browse | `.screen-region`          | un solo scroller pagina                |
| Timeline/waveform                                                                 | `.timeline__slider`       | `touch-action: none` locale            |
| Mini timeline                                                                     | `.mini-player__timeline`  | `touch-action: none` locale            |
| Volume                                                                            | `.volume-slider`          | `touch-action: none` locale            |
| Queue reorder                                                                     | `.queue-item__handle`     | `touch-action: none` solo handle       |
| Playlist reorder                                                                  | `.playlist-track__handle` | `touch-action: none` solo handle       |
| Tastiera on-screen                                                                | singoli tasti             | `manipulation`; input reale autorevole |

Gli scroller aggiungono `overscroll-behavior-y: contain` e
`-webkit-overflow-scrolling: touch`. `overflow-x` resta nascosto. La catena
`min-height: 0`/`minmax(0, 1fr)` è preservata. Non esiste
`touch-action: none` globale.

## Selezione ed editing

- `.app-root`: `user-select: none` e `-webkit-user-select: none`.
- Opt-in testuale: input, textarea, `[contenteditable="true"]`,
  `.text-selectable` e `[data-text-selectable="true"]`.
- Artwork: `-webkit-user-drag: none`; il componente mantiene
  `draggable = false`.
- Dopo la modifica, il drag reale sul titolo non ha più alterato gli appunti.
- Search reale: cursore, digitazione, Ctrl+A, copia e modifica: PASS.
- Password/rename usano gli stessi input opt-in; l'integrazione della tastiera
  on-screen è coperta dai test.
- Tastiera on-screen reale in modalità Always: apertura, input e chiusura PASS.

## Pointer handler modificati

- Volume: memorizza il pointer attivo e rilascia la capture su `pointerup`,
  `pointercancel` e chiusura del popover.
- Queue: conserva il gesto attraverso snapshot SSE con gli stessi ID; annulla
  solo quando lunghezza, identità o ordine cambiano realmente.
- Timeline, mini timeline, Queue handle e Playlist handle mantengono i rispettivi
  handler locali e `pointercancel`.

Il drag Queue usa così lo stesso modello robusto della Playlist: handle
dedicato, soglia, midpoint, autoscroll del contenitore reale, una sola
persistenza al drop. Non sono stati modificati backend o contratti.

## File modificati

- `apps/ui/src/styles/base.css`
- `apps/ui/src/styles/layout.css`
- `apps/ui/src/styles/components.css`
- `apps/ui/src/styles/screens.css`
- `apps/ui/src/components/volume-popover.ts`
- `apps/ui/src/components/queue-drawer.ts`
- `apps/ui/src/utils/queue-reorder.ts`
- `apps/ui/test/smb-ui.test.ts`
- `apps/ui/test/step2.14.1.test.ts`
- `prompts/step2.14.1_output.md`

## Test automatici

RED mirato prima dell'implementazione: 4 failure su selezione, artwork,
scroller nativi e `pointercancel` volume.

Test mirati finali:

- Step 2.14.1 + SMB UI + Step 2.10 + Step 2.8.3: 30/30 PASS.
- Copertura aggiunta per policy di selezione/editabilità, native image drag,
  scroll chain, scroller pagina/drawer/Queue/modali, ownership touch locale,
  assenza di `touchmove` globale, listener globali passivi, `pointercancel` e
  sopravvivenza del reorder Queue ai tick player.

Suite completa:

- `npm.cmd test`: 461 test, 453 PASS, 8 SKIP previsti, 0 failure.
- `npm.cmd run test:posix`: 3 PASS, 2 SKIP previsti, 0 failure.

Il nuovo test UI non è stato aggiunto all'allowlist install-safe.

## QA Windows reale

- Comando obbligatorio: `npm.cmd run dev`, app Neutralino/WebView2 reale.
- MPV reale disponibile; apertura traccia, Play/Pause/Previous/Next: PASS.
- Wheel su Library e Settings lunghi: PASS; top bar e mini-player stabili.
- Drawer, Queue, navigazione, input Search, tastiera on-screen, volume e
  timeline: PASS.
- Drag Queue veloce e lento durante playback: PASS dopo il fix. Il caso lento
  riprodotto prima del fix lasciava revision e ordine invariati; dopo il fix ha
  incrementato la revision e cambiato l'ordine. Un secondo drag ha ripristinato
  esattamente l'ordine originale.
- Slider volume reale: PASS; valore originale ripristinato.
- Seek timeline reale: PASS; posizione originale ripristinata.
- Stato utente finale: traccia in pausa, posizione circa 123,671 s, volume
  97,989433, Queue e brano corrente originali.
- Nessuna evidenziazione testo o ricostruzione Queue visibilmente instabile.

### Viewport

Client area misurata, non dimensione esterna finestra:

- 1024×768: PASS;
- 1280×800: PASS, target prioritario;
- 1366×768: PASS.

Now Playing, drawer e Queue sono stati ispezionati nella vera app. Nessun layout
shift, doppio scrollbar, overflow orizzontale, clipping o variazione di
geometria/colore/spaziatura.

### Touch

`WINDOWS TOUCH EMULATION — NOT TESTED`

Il browser controllabile non era disponibile nella sessione. Non è stato usato
un fallback browser al posto della vera app. Il test definitivo resta sul
Raspberry Pi.

## Gate finali

Eseguiti una sola volta al termine:

- `npm.cmd run format:check`: PASS
- `npm.cmd run typecheck`: PASS
- `npm.cmd run lint`: PASS
- `npm.cmd run build`: PASS
- `npm.cmd test`: PASS
- `npm.cmd run test:posix`: PASS
- `npm.cmd run verify:network:deployment`: PASS
- `npm.cmd run verify:linux:executables`: PASS
- `npm.cmd run verify:linux:installer`: PASS
- `npm.cmd run mpv:doctor`: PASS
- `npm.cmd run test:mpv`: 8/8 PASS
- `git diff --check`: PASS

`build:linux` non è stato eseguito, come richiesto.

## Firewall installer e cleanup

- `deploy/linux/`: unchanged.
- `.github/workflows/`: unchanged.
- Installer/update/rollback/restore/uninstall: unchanged.
- Install-safe e relativa allowlist: unchanged.
- Release verifier: unchanged.
- Executable-mode verifier e Git modes: unchanged; 33 file deployment validi.
- Backend, MPV, FFmpeg, readiness, host/port, Neutralino config, manifest,
  lockfile e dipendenze: unchanged.
- Chiusura Neutralino: success code 0; backend: SIGTERM pulito.
- Nessun Neutralino/backend/Vite/MPV/FFmpeg del progetto e nessun listener
  4310/5173 dopo lo smoke.
- Nessun log o screenshot temporaneo nel repository.

## Raspberry handoff — Step 2.14 + Step 2.14.1

`RASPBERRY — NOT TESTED`

Dopo commit, push e CI verde:

```sh
cd ~/eidetic-player
git pull --ff-only

sudo ./deploy/linux/install-eidetic-player.sh \
  --user "$(id -un)" \
  --mode appliance
```

Checklist unica:

- install-safe PASS; installazione completa; app avviabile; MPV rilevato;
- Library, Sources, Settings, Favorites, History e Playlists scorrono al touch;
- drawer, Queue e modali scorrono al touch;
- top bar e mini-player restano fissi;
- nessuna selezione involontaria e nessun drag ghost artwork;
- Search, password, rename e altri input restano editabili;
- tastiera on-screen funzionante;
- tap pulsanti, drawer e navigazione funzionanti;
- volume, timeline, waveform e mini progress funzionanti;
- Queue reorder e Playlist reorder funzionanti anche con playback attivo;
- Queue resta stabile durante i tick del player;
- Play/Pause/Previous/Next e playback reale funzionanti;
- USB/SMB Quick Browse e visualizer funzionanti;
- nessun processo residuo dopo la chiusura.

Nessun commit o push è stato eseguito in questo lavoro.
