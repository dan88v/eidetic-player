# Step 2.17.4 — Native Touch Scrolling Corrective

## Esito

La prima implementazione locale ha superato CI ed è stata installata sul
Raspberry. La successiva prova fisica con dito è FALLITA:

- il pan verticale ha direzione da scrollbar/mouse, non da superficie touch:
  per avanzare verso il contenuto inferiore occorre trascinare verso il basso;
- il reorder Queue verso l'alto risponde, mentre verso il basso non completa
  lo spostamento.

`RASPBERRY NATIVE TOUCH SCROLLING VALIDATION — FAILED`

Lo Step 2.17.4 è stato riaperto. Il precedente vincolo “solo scrolling nativo”
è stato superato dall'autorizzazione esplicita dell'utente a usare un fallback
JavaScript se necessario, purché deterministico e affidabile.

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

| Superficie             | Proprietario overflow | `touch-action`         | Pointer capture | `preventDefault` | Stato finale          |
| ---------------------- | --------------------- | ---------------------- | --------------- | ---------------- | --------------------- |
| `html/body/#app`       | nessuno, root fissa   | nessun `none`          | no              | no               | overscroll bloccato   |
| `.app-root`            | nessuno               | default                | no              | no               | chrome fisso          |
| `.content-shell`       | nessuno               | default                | no              | no               | `min-height: 0`       |
| `.screen-region`       | pagina canonica       | fallback: `none`       | dopo 8 px       | durante drag     | direct manipulation   |
| screen lunghe          | `.screen-region`      | fallback condiviso     | dopo 8 px       | durante drag     | direzione determinata |
| drawer                 | nav centrale          | chrome non scrollabile | no              | no               | overflow nascosto     |
| `.side-menu__nav`      | nav                   | fallback condiviso     | dopo 8 px       | durante drag     | header/footer fissi   |
| Queue                  | `.queue-list`         | `pan-y`                | no              | no               | header fisso          |
| Queue row/body         | `.queue-list`         | fallback condiviso     | dopo 8 px       | durante drag     | pan, no playback      |
| Queue reorder handle   | handle                | `none`                 | immediata       | locale           | drag dedicato         |
| backdrop modali        | nessuno               | default                | no              | no               | background fermo      |
| dialog/picker body     | body interno          | `pan-y`                | no              | no               | overscroll contenuto  |
| Playlist picker        | body                  | `pan-y`                | no              | no               | footer esterno        |
| Power                  | dialog                | `pan-y`                | no              | no               | scroll interno        |
| source/name dialog     | dialog                | `pan-y`                | no              | no               | altezza limitata      |
| timeline/mini timeline | controllo             | `none`                 | locale          | locale           | invariato             |
| volume                 | controllo             | `none`                 | locale          | locale           | invariato             |
| cover Now Playing      | screen                | `pan-y`                | no              | no               | tap Library invariato |
| OSK                    | controller esistente  | locale                 | no globale      | locale           | invariato             |

Non esistono `touchmove` o `preventDefault` globali. Il fallback usa soltanto
Pointer Events locali sullo scroller proprietario; la capture parte dopo la
soglia e termina su `pointerup`/`pointercancel`. Body e root non scorrono.

## Root cause e correzione

La prima correzione CSS era corretta secondo il modello browser, ma la prova
fisica ha dimostrato che WebKitGTK espone sul dispositivo una semantica da
scrollbar: trascinare verso il basso aumenta l'avanzamento, opposto alla
manipolazione diretta di una UI touch. La classificazione del device non è
abbastanza affidabile per scegliere tra touch e mouse.

La seconda correzione usa quindi un unico fallback condiviso e deterministico:

- `scrollTop = startScrollTop + startPointerY - currentPointerY`;
- finger-up aumenta `scrollTop`, finger-down lo diminuisce;
- soglia verticale 8 px e rifiuto del gesto prevalentemente orizzontale;
- inerzia limitata a un solo `requestAnimationFrame` per gesto attivo;
- velocità limitata, decadimento finito e stop immediato ai bordi;
- nessuna distinzione `pointerType`, così funziona anche se GTK presenta il
  touchscreen come mouse;
- opt-out per input, timeline, volume e handle di reorder.

Sono stati corretti anche difetti strutturali misurabili:

- drawer: `auto minmax(0, 1fr) auto` e overflow del pannello nascosto;
- Queue: pannello confinato e lista unico scroller;
- root: overscroll bloccato su tutta la tripletta `html/body/#app`;
- Power e source dialog: altezza limitata, pan e overscroll contenuti;
- Queue: la capture del handle è ora immediata perché il primo test fisico ha
  dimostrato perdita direzionale prima della soglia. La riga non cattura.
- Playlist: conserva il modello precedente con capture dopo soglia.

Un test MPV reale ha spostato la stessa entry verso il fondo e poi verso l'alto:
il comando backend è corretto; il difetto fisico era nell'acquisizione UI.

## Modello e policy

- Root e app chrome non scorrono.
- Top bar e mini-player restano fissi.
- `.screen-region` è lo scroller gestito delle pagine.
- Drawer: header e footer fuori dalla nav scrollabile.
- Queue: header fuori dalla lista scrollabile.
- Modali/picker: scorre soltanto il body interno previsto.
- Scroller: `overflow-y: auto`, `overflow-x: hidden`, `min-height: 0`,
  `overscroll-behavior-y: contain` e fallback Pointer Events condiviso.
- `touch-action: none` resta solo su timeline, volume e handle di reorder.
- Nessun cambio a OSK, focus trap, Tab, Escape, Enter, Space o ARIA.

## Tap, swipe e gesture guard

Il fallback introduce la soglia minima necessaria di 8 px. Un tap sotto soglia
resta nativo; dopo un drag viene soppresso soltanto il click immediatamente
generato dallo stesso gesto. Il guard è locale, one-shot, preserva i click
tastiera (`detail === 0`) e scade dopo 100 ms. Non esistono listener
`touchmove`, delay di navigazione o blocchi globali.

Il reorder Queue parte soltanto dal handle dedicato, cattura subito il pointer e
rilascia su `pointerup`/`pointercancel`.

## Scrollbar

Gli scroller canonici condividono scrollbar visibili e discrete:
`scrollbar-width: thin`, colori coerenti e thumb WebKit/Chromium da 8 px con
track trasparente. Le scrollbar restano native; il drag del contenuto usa il
fallback condiviso.

## Test automatici

RED mirato iniziale: 6 failure e 1 PASS. Le failure coprivano root overscroll,
target interattivi, struttura drawer/Queue, capture anticipata e modali.

Test mirati finali:

- Seconda correzione Step 2.17.4/2.14.1/2.10 + MPV reale: 34/34 PASS
  nell'ultima selezione mirata.
- Copertura CSS/DOM per root, screen, drawer, Queue, handle, modali, scrollbar,
  fallback locale e preservazione cover.
- Copertura Pointer Events per segno della direzione, velocità, soglia,
  click-guard, cleanup, opt-out, assenza di listener document, handle-only,
  capture Queue immediata, `pointercancel`, midpoint e autoscroll.
- MPV reale: move verso il fondo e ritorno verso l'alto PASS.

## QA Windows reale

Comando obbligatorio: `npm.cmd run dev`.

- Drawer: wheel e scrollbar muovono solo la nav; header/footer fissi.
- Drawer direct drag da una voce: trascinamento verso l'alto mostra le voci
  inferiori, nessuna navigazione accidentale, header/footer fissi.
- Queue lunga: wheel e scrollbar muovono solo la lista; header fisso; footer
  azioni raggiungibile.
- Queue row direct drag verso l'alto: lista avanza, current/ordine/revision
  invariati.
- Queue handle: spostamento UI reale dall'indice 5 all'indice 8 PASS; revision
  1→2. Ripristino esatto all'indice 5 PASS; current invariato, pausa e volume
  invariati.
- Library direct drag verso l'alto: contenuto avanza e mini-player resta fisso.
- Settings e Audio: layout e navigazione invariati.
- Library e Favorites: contenuto lungo e scroller canonico corretti.
- Power: overlay centrato, background fermo, Escape funzionante.
- Now Playing: metadata AC/DC, cover quadrata, Technical, timeline e transport
  invariati.
- Quit: Neutralino code 0, backend SIGTERM; dopo il normale tempo di teardown
  nessun Neutralino, backend, Vite, MPV, FFmpeg o listener 4310/5173 residuo.

La seconda correzione è stata provata con Pointer Events mouse nella vera app;
non dipende da `pointerType`, quindi esercita lo stesso percorso usato quando
GTK classifica il touch come mouse. Questo non sostituisce il nuovo test fisico
post-CI.

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

## Gate prima iterazione

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

## Gate seconda correzione

- Primo `format:check`: ha rilevato il report non formattato; corretto
  automaticamente con Prettier.
- Primo lint: ha rilevato tre problemi nel nuovo helper; corretti
  automaticamente.
- `npm.cmd run format:check`: PASS
- `npm.cmd run typecheck`: PASS
- `npm.cmd run lint`: PASS
- `npm.cmd run build`: PASS
- `npm.cmd run build:linux`: PASS
- `npm.cmd test`: 538 totali, 528 PASS, 10 SKIP previsti
- `npm.cmd run test:posix`: 3 PASS, 2 SKIP previsti
- `npm.cmd run verify:network:deployment`: PASS
- `npm.cmd run verify:linux:executables`: PASS, 41 file
- `npm.cmd run verify:linux:installer`: PASS
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`: PASS
- `npm.cmd run mpv:doctor`: PASS
- `npm.cmd run test:mpv`: 9/9 PASS
- `npm.cmd run ffmpeg:doctor`: PASS
- `npm.cmd run test:ffmpeg`: 3/3 PASS
- `git diff --check`: PASS

La UI production passa da 333,41 kB/85,31 kB gzip a 336,38 kB/86,40 kB
gzip: circa +2,97 kB raw e +1,09 kB gzip per il fallback e i relativi
lifecycle hook. Non sono state aggiunte dipendenze, observer, timer periodici o
loop inattivi.

## File modificati

- `apps/ui/src/components/queue-drawer.ts`
- `apps/ui/src/components/app-shell.ts`
- `apps/ui/src/components/side-menu.ts`
- `apps/ui/src/components/playlist-picker.ts`
- `apps/ui/src/components/removable-device-picker.ts`
- `apps/ui/src/components/playlist-name-dialog.ts`
- `apps/ui/src/components/power-menu.ts`
- `apps/ui/src/screens/playlists.ts`
- `apps/ui/src/screens/network-settings-panel.ts`
- `apps/ui/src/screens/sources.ts`
- `apps/ui/src/screens/usb-storage.ts`
- `apps/ui/src/styles/base.css`
- `apps/ui/src/styles/components.css`
- `apps/ui/src/styles/layout.css`
- `apps/ui/src/styles/screens.css`
- `apps/ui/src/utils/reliable-touch-scroll.ts`
- `apps/ui/test/step2.17.4.test.ts`
- `apps/ui/test/step2.14.1.test.ts`
- `apps/backend/test/mpv.integration.ts`
- `docs/development/ui-ux.md`
- `docs/development/testing.md`
- `prompts/step2.17.4_output.md`

## Regression firewall e cleanup

- `package.json` e `package-lock.json`: invariati; nessuna dipendenza.
- Package/runtime plan: invariato.
- `.github/workflows`, `deploy`, backend runtime e shared: invariati; è stato
  aggiunto soltanto un test MPV di reorder bidirezionale.
- Installer, updater, current/previous e Raspberry: invariati.
- Now Playing, mini-player, timeline, volume e Power menu: invariati.
- Queue, current item, playback, volume, mute, shuffle, repeat, Audio Output e
  Favorites non sono stati mutati durante lo smoke correttivo.
- Due `__pycache__` generati dai test installer sono stati spostati fuori dal
  repository in una quarantena temporanea; nessun artefatto o screenshot è
  rimasto nel working tree.

## Checkpoint pre-CI e fase remota

Prima iterazione:

- commit manuale e push: `262ee74942ae10585cb4be0d5b31a5a8cc9e0cc4`;
- CI esatta: `Eidetic Player CI` run `30271221950`, PASS;
- update remoto tramite `scripts/remote-rpi-update.ps1`: completato, confermato
  dall'utente;
- Build ID target: `262ee74`; Build ID prima/dopo e output doctor/no-op non
  sono stati acquisiti nel thread, quindi non vengono inventati;
- prova fisica drawer/pagine: FAIL per direzione del pan;
- prova fisica reorder Queue: FAIL verso il basso;
- stato Queue/volume: nessuna alterazione permanente segnalata.

È necessaria una seconda correzione locale, seguita nuovamente da commit
manuale, push, CI verde sull'esatto commit, update e validazione fisica.

## Secondo checkpoint, update e prova Raspberry

- commit manuale e push:
  `6f49d17540d88afc3ef076ccdebc210094b02dac`;
- commit: `Step 2.17.4 — Native Touch Scrolling Corrective`;
- working tree pulito e `main` allineato a `origin/main` prima dell'update;
- CI esatta: `Eidetic Player CI` run `30274682219`, PASS;
- update remoto verso `daniele@10.0.0.112` tramite
  `scripts/remote-rpi-update.ps1`: completato con successo e confermato
  dall'utente;
- Build ID target: `6f49d17`;
- prova fisica sul Raspberry Pi: lo scrolling touch ora funziona correttamente,
  confermato dall'utente.

Il difetto di scrolling osservato dopo la prima installazione è quindi chiuso
sul dispositivo reale. Nel riscontro finale non è stata fornita una conferma
separata del reorder Queue verso entrambe le direzioni: la relativa copertura
automatica e lo smoke Windows restano PASS, ma questa specifica interazione
fisica sul Raspberry deve essere ricontrollata al prossimo test se non era
inclusa nella prova dell'utente.

`RASPBERRY TOUCH SCROLLING PASS — QUEUE REORDER PHYSICAL CONFIRMATION PENDING`
