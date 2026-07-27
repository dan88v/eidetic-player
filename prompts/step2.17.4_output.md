# Step 2.17.4 — Native Touch Scrolling Corrective

## Esito locale

Implementazione e validazione locale: PASS. Lo scrolling resta interamente
nativo del browser/WebView; non sono stati aggiunti inerzia, momentum,
overscroll o gesture engine JavaScript.

`READY FOR CI VALIDATION — RASPBERRY TOUCH VALIDATION NOT STARTED`

Nessun commit, push, SSH o intervento sul Raspberry è stato eseguito.

## Baseline Git e CI

- Branch `main`, working tree iniziale pulito.
- `HEAD` e `origin/main` allineati (`0 0`) su
  `454c18774a9c71926d6a6b9e6e92f470931f769b`.
- Commit baseline: `Step 2.17.3 output — Now Playing metadata integrity,
readability and artwork navigation`.
- Step 2.17, 2.17.1, 2.17.2 e 2.17.3 presenti.
- GitHub Actions `Eidetic Player CI`: run `30266469237`, `success`, stesso SHA.
- Nessun merge/rebase in corso; `git diff --check`: PASS.

## Baseline Windows reale

Eseguita nella vera app Neutralino/WebView2 con `npm.cmd run dev` e
`C:\Tools\mpv\mpv.exe`.

- Readiness Build ID: `454c187-dev`.
- MPV 0.41 disponibile.
- Queue: 10 elementi, indice corrente 2, pausa a circa 168,295 s.
- Volume 97,989433; mute off; shuffle off; repeat off.
- Preferenza Audio Output specifica disponibile; Favorites Tracks: 2.
- Now Playing, metadata AC/DC, artwork, Technical, drawer, Queue, Settings,
  Audio Output, Network, Favorites, Library, modali, timeline, volume, Power e
  Quit ispezionati.
- Wheel e scrollbar funzionanti già in baseline; il problema fisico riferito
  resta il pan con dito sul Raspberry.

Il drawer della sessione development ha mostrato il fallback preesistente
`Build dev` dopo un errore bootstrap MPV transitorio, mentre readiness e test di
provenienza riportavano `454c187-dev`. Il codice Build ID non è stato toccato.

## Audit touch/scroll

| Superficie             | Proprietario overflow | `touch-action`           | Pointer capture  | `preventDefault` | Stato finale          |
| ---------------------- | --------------------- | ------------------------ | ---------------- | ---------------- | --------------------- |
| `html/body/#app`       | nessuno, root fissa   | nessun `none`            | no               | no               | overscroll bloccato   |
| `.app-root`            | nessuno               | default                  | no               | no               | chrome fisso          |
| `.content-shell`       | nessuno               | default                  | no               | no               | `min-height: 0`       |
| `.screen-region`       | pagina canonica       | `pan-y`                  | no               | no               | scroll nativo         |
| screen lunghe          | `.screen-region`      | `pan-y` anche sui target | no               | no               | scroll nativo         |
| drawer                 | nav centrale          | chrome non scrollabile   | no               | no               | overflow nascosto     |
| `.side-menu__nav`      | nav                   | `pan-y` anche sui target | no               | no               | scroll nativo         |
| Queue                  | `.queue-list`         | `pan-y`                  | no               | no               | header fisso          |
| Queue row/body         | `.queue-list`         | `pan-y`                  | no               | no               | tap/pan nativi        |
| Queue reorder handle   | handle                | `none`                   | solo dopo soglia | locale           | drag dedicato         |
| backdrop modali        | nessuno               | default                  | no               | no               | background fermo      |
| dialog/picker body     | body interno          | `pan-y`                  | no               | no               | overscroll contenuto  |
| Playlist picker        | body                  | `pan-y`                  | no               | no               | footer esterno        |
| Power                  | dialog                | `pan-y`                  | no               | no               | scroll interno        |
| source/name dialog     | dialog                | `pan-y`                  | no               | no               | altezza limitata      |
| timeline/mini timeline | controllo             | `none`                   | locale           | locale           | invariato             |
| volume                 | controllo             | `none`                   | locale           | locale           | invariato             |
| cover Now Playing      | screen                | `pan-y`                  | no               | no               | tap Library invariato |
| OSK                    | controller esistente  | locale                   | no globale       | locale           | invariato             |

L'audit completo non ha trovato `touchmove` globale, `preventDefault` globale,
capture su liste/righe/screen, body scrollabile o `touch-action: none` globale.

## Root cause e correzione

La catena principale introdotta in Step 2.14.1 era già corretta sul contenitore,
ma il target effettivo di molti gesti è un button/row action con la policy
globale generica `manipulation`. La correzione rende esplicito `pan-y` anche sui
target interattivi interni agli scroller canonici, così il gesto iniziato su
testo, icona o padding conserva l'ownership verticale del contenitore.

Sono stati corretti anche difetti strutturali misurabili:

- drawer: `auto minmax(0, 1fr) auto` e overflow del pannello nascosto;
- Queue: pannello confinato e lista unico scroller;
- root: overscroll bloccato su tutta la tripletta `html/body/#app`;
- Power e source dialog: altezza limitata, pan e overscroll contenuti;
- Queue e Playlist: `setPointerCapture` spostato da `pointerdown` all'effettivo
  superamento della soglia di drag.

La causa fisica completa nel runtime WebKitGTK del Raspberry potrà essere
certificata soltanto dal test con dito post-CI. La fase locale dimostra la
catena CSS/DOM e rimuove i conflitti di gesture presenti nel codice.

## Modello e policy

- Root e app chrome non scorrono.
- Top bar e mini-player restano fissi.
- `.screen-region` è lo scroller delle pagine.
- Drawer: header e footer fuori dalla nav scrollabile.
- Queue: header fuori dalla lista scrollabile.
- Modali/picker: scorre soltanto il body interno previsto.
- Scroller: `overflow-y: auto`, `overflow-x: hidden`, `min-height: 0`,
  `touch-action: pan-y`, `overscroll-behavior-y: contain`.
- `touch-action: none` resta solo su timeline, volume e handle di reorder.
- Nessun cambio a OSK, focus trap, Tab, Escape, Enter, Space o ARIA.

## Tap, swipe e gesture guard

Non è stata aggiunta una soglia anti-click. Nella vera app Windows wheel,
scrollbar e click sono rimasti distinti; il click accidentale dopo pan non è
stato riprodotto e il WebView conserva la soppressione click nativa.

Non esistono delay, `suppressNextClick`, listener `touchmove` o
`preventDefault` generali. Il riordino usa la soglia esistente di 8 px e parte
soltanto dal handle dedicato; la capture avviene solo dopo l'attivazione reale e
viene rilasciata su `pointerup`/`pointercancel`.

## Scrollbar

Gli scroller canonici condividono scrollbar visibili e discrete:
`scrollbar-width: thin`, colori coerenti e thumb WebKit/Chromium da 8 px con
track trasparente. Nessuna scrollbar JavaScript.

## Test automatici

RED mirato iniziale: 6 failure e 1 PASS. Le failure coprivano root overscroll,
target interattivi, struttura drawer/Queue, capture anticipata e modali.

Test mirati finali:

- Step 2.17.4, Step 2.14.1, Step 2.10 e track transition: 57/57 PASS.
- Copertura CSS/DOM per root, screen, drawer, Queue, handle, modali, scrollbar,
  assenza di gesture blocker e preservazione cover.
- Copertura Pointer Events/gesture per soglia Queue/Playlist, handle-only,
  capture successiva alla soglia, `pointercancel`, midpoint, autoscroll e
  persistenza singola.

Il pan touch e l'inerzia sono deliberatamente nativi e non vengono simulati
dalla suite Node.

## QA Windows reale

Comando obbligatorio: `npm.cmd run dev`.

- Drawer: wheel e scrollbar muovono solo la nav; header/footer fissi.
- Queue lunga: wheel e scrollbar muovono solo la lista; header fisso; footer
  azioni raggiungibile.
- Settings e Audio: layout e navigazione invariati.
- Library e Favorites: contenuto lungo e scroller canonico corretti.
- Power: overlay centrato, background fermo, Escape funzionante.
- Now Playing: metadata AC/DC, cover quadrata, Technical, timeline e transport
  invariati.
- Quit: Neutralino code 0, backend SIGTERM; dopo il normale tempo di teardown
  nessun Neutralino, backend, Vite, MPV, FFmpeg o listener 4310/5173 residuo.

Touch sintetico Win32: non certificato; Windows ha rifiutato l'iniezione al
primo `DOWN` con errore 87. Il browser controllabile non era disponibile. Non è
stato usato un browser fallback al posto della vera app.

### Viewport

Client area verificata nella vera app:

| Viewport | Esito                                                      |
| -------- | ---------------------------------------------------------- |
| 1024×600 | PASS — compact Now Playing, drawer, Queue, Settings, Audio |
| 1024×768 | PASS — Technical scale sopra i meter, cover quadrata       |
| 1280×800 | PASS — target prioritario                                  |
| 1366×768 | PASS — Now Playing, Library, Favorites, Power              |

Nessun overflow orizzontale, white flash, layout shift, doppio scrollbar o
clipping osservato.

## Gate finali

- `npm.cmd run format:check`: PASS
- `npm.cmd run typecheck`: PASS
- `npm.cmd run lint`: PASS
- `npm.cmd run build`: PASS
- `npm.cmd run build:linux`: PASS
- `npm.cmd test`: 535 totali, 525 PASS, 10 SKIP previsti
- `npm.cmd run test:posix`: 3 PASS, 2 SKIP previsti
- `npm.cmd run verify:network:deployment`: PASS
- `npm.cmd run verify:linux:executables`: PASS, 41 file
- `npm.cmd run verify:linux:installer`: PASS
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`: PASS
- `npm.cmd run mpv:doctor`: PASS
- `npm.cmd run test:mpv`: 8/8 PASS
- `npm.cmd run ffmpeg:doctor`: PASS
- `npm.cmd run test:ffmpeg`: 3/3 PASS
- `git diff --check`: PASS

## File modificati

- `apps/ui/src/components/queue-drawer.ts`
- `apps/ui/src/screens/playlists.ts`
- `apps/ui/src/styles/base.css`
- `apps/ui/src/styles/components.css`
- `apps/ui/src/styles/layout.css`
- `apps/ui/src/styles/screens.css`
- `apps/ui/test/step2.17.4.test.ts`
- `docs/development/ui-ux.md`
- `docs/development/testing.md`
- `prompts/step2.17.4_output.md`

## Regression firewall e cleanup

- `package.json` e `package-lock.json`: invariati; nessuna dipendenza.
- Package/runtime plan: invariato.
- `.github/workflows`, `deploy`, backend e shared: invariati.
- Installer, updater, current/previous e Raspberry: invariati.
- Now Playing, mini-player, timeline, volume e Power menu: invariati.
- Queue, current item, playback, volume, mute, shuffle, repeat, Audio Output e
  Favorites non sono stati mutati durante lo smoke correttivo.
- Due `__pycache__` generati dai test installer sono stati spostati fuori dal
  repository in una quarantena temporanea; nessun artefatto o screenshot è
  rimasto nel working tree.

## Checkpoint pre-CI e fase remota

Stato corrente:

`READY FOR CI VALIDATION — RASPBERRY TOUCH VALIDATION NOT STARTED`

Attendere commit manuale, push manuale e CI verde sull'esatto commit. Solo
dopo, usare `scripts/remote-rpi-update.ps1` con sessione visibile e verificare
Build ID prima/dopo, update, doctor, no-op e tutte le 23 prove fisiche previste.

- Commit/CI successivi: non ancora avvenuti.
- Raspberry Build ID prima/dopo: non letto/non aggiornato.
- Update/no-op: non iniziati.
- Validazione fisica touch: non iniziata.
- Nessun commit o push automatico.
