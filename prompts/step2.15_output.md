# Step 2.15 — Basic Audio Output Settings

## Esito

Implementazione locale completata. Settings espone la gerarchia
`Audio → Output → selezione dispositivo`. La selezione Output è sempre
apribile, con `System default` in prima posizione, lista reale MPV, distinzione
fra uscita preferita ed effettiva, selezione immediata, refresh
manuale/automatico, rollback e persistenza dedicata.

Il cambio reale Windows fra `auto` e WASAPI è stato provato durante playback
senza ricreare MPV, Queue, traccia o sessione. Installer, deploy e workflow
restano invariati. Nessun commit o push è stato eseguito.

Stato locale: `READY FOR CI VALIDATION`.

## Prerequisito e baseline

- branch: `main`;
- working tree iniziale: pulito;
- HEAD e `origin/main`:
  `fb8772f9459719772db715a7c414ca9e01bf8fa8`;
- divergenza: `0 0`;
- nessun merge/rebase;
- `prompts/step2.14.2B_output.md` presente in HEAD;
- GitHub Actions `main`, run `#58` (`30201031311`): `success`;
- `git diff --check`: PASS iniziale.

Baseline Windows reale con
`EIDETIC_MPV_PATH=C:\Tools\mpv\mpv.exe`:

- `mpv:doctor`: PASS, MPV v0.41.0;
- backend `127.0.0.1:4310`, Vite `127.0.0.1:5173`,
  Neutralino/WebView2 e un solo MPV: PASS;
- Queue ripristinata: 12 elementi con ID stabili;
- corrente originale: indice 2, `Hymn For The Weekend`, in pausa a
  `180.302313`, volume `97.989433`, mute off, shuffle off, repeat off;
- Play/Pause, Previous/Next, volume, mute, Settings, Power menu, Quit e restore:
  PASS;
- file preferenza Audio Output originale: assente;
- `audio-device` iniziale: `auto`;
- `audio-device-list` reale sanitizzata:
  - `auto` — `System default`;
  - `wasapi/{3c6404bc-72fe-4d86-a013-a344cf094908}` —
    `Altoparlanti (Realtek(R) Audio)`;
  - `openal` — `Default (openal)`.

## Audit Settings e toast

`createSettingsScreen` possiede lo stack interno `root`/`interface`/`network`/
selezioni e usa `page`, `render()` e la Back action canonica. Le righe
navigabili sono button semantici `setting-navigation`; non esisteva una regola
generica `options.length > 1`.

La root Settings mostra `Audio` con la descrizione
`Playback and output settings`. Audio apre una sottopagina dedicata che contiene
`Output`; sotto Output viene mostrata la preferenza selezionata, con
`Unavailable` se non è presente. Output apre infine la selezione dei device.

La riga Output è sempre navigabile e non modifica il comportamento delle altre
impostazioni. La pagina di selezione resta accessibile con zero o una uscita,
solo `auto`, MPV non disponibile o preferenza assente. Back percorre
`selezione Output → Audio → Settings`.

Il feedback transitorio resta di proprietà dell'unico `toastHost` di AppShell,
tramite `showMessage`/`showToast`. Non sono stati creati toast manager, banner,
alert, confirm browser o modali di selezione.

## Modello, repository e sicurezza

`packages/shared/src/audio-output.ts` definisce:

- device, preferenza, stato e risultato selezione;
- stati pubblici chiusi `active`, `system-default`, `pending-playback`,
  `preferred-unavailable`, `mpv-unavailable`, `switching`, `error`;
- `auto` sintetico canonico;
- validazione e limiti per ID/descrizioni;
- normalizzazione, deduplica e limite di 64 record MPV.

`AudioOutputRepository` usa un file versionato separato dalla player session:

- Windows:
  `%APPDATA%\Eidetic Player\audio-output.json`;
- Linux:
  `$XDG_CONFIG_HOME/eidetic-player/audio-output.json`, con fallback XDG;
- schema v1 con solo ID e descrizione preferiti;
- scrittura atomica temp + rename e mode `0600`;
- fallback sicuro ad `auto` e backup del file corrotto;
- nessuna lista device, stato effettivo, Queue o sessione v2 persistiti.

Gli ID MPV restano stringhe opache. Non raggiungono shell, spawn, filesystem o
HTML; descrizione e ID sono renderizzati con `textContent`. Errori pubblici e
payload API sono chiusi e non espongono path, IPC, stack, stderr o environment.

## Integrazione MPV e bootstrap

Il solo processo MPV persistente osserva ora anche `audio-device-list`; il
controller già osservava e pubblicava le altre proprietà player. L'adapter
stretto implementato da `PlayerService` consente lettura lista/device,
impostazione JSON IPC e subscription alle proprietà e all'attività playback.
Non esiste enumerazione shell, polling o secondo MPV.

Ordine bootstrap:

1. inizializzazione MPV;
2. inizializzazione `AudioOutputService`;
3. lettura preferenza e `audio-device-list`;
4. applicazione preferenza disponibile o fallback temporaneo `auto`;
5. restore player session;
6. apertura playback ripristinato.

Il before-playback hook riapplica la preferenza prima di open/play quando
necessario. Un device ritornato non provoca auto-switch durante playback o da
fermo; viene applicato alla selezione esplicita o al playback successivo.

## Switch, rollback e lifecycle device

La selezione:

- blocca doppi tap;
- pubblica `switching`;
- imposta `audio-device` via JSON IPC;
- attende conferma bounded;
- persiste solo dopo successo;
- resta nella sottopagina e usa il toast esistente;
- è no-op senza toast quando preferito ed effettivo coincidono.

Un fallimento tenta e verifica il device precedente. Se anche il rollback
fallisce tenta `auto`, conserva la preferenza precedente e pubblica `error`.

Quando il preferito scompare, la preferenza e la descrizione restano
persistenti, `auto` diventa effettivo e una sola revisione notice genera il
toast hot-unplug. Eventi duplicati e reconnect SSE non ripetono il toast. Al
ritorno il device è nuovamente disponibile senza switch automatico.

Refresh automatico usa gli eventi MPV e ignora liste semanticamente duplicate.
Refresh manuale rilegge la proprietà senza riavviare MPV o cambiare
preferenza.

## API ed eventi

Route REST:

- `GET /api/audio-output/state`;
- `POST /api/audio-output/select`, body chiuso `{ deviceId }`;
- `POST /api/audio-output/refresh`, body `{}`.

Device assente restituisce 409; payload malformati o con campi extra
restituiscono 400. I codici pubblici sono
`INVALID_AUDIO_OUTPUT`, `AUDIO_OUTPUT_NOT_AVAILABLE`,
`AUDIO_OUTPUT_SWITCH_FAILED`, `AUDIO_OUTPUT_REFRESH_FAILED` e
`MPV_NOT_AVAILABLE`.

Gli snapshot automatici Audio Output sono eventi nominati `audio-output` sulla
connessione SSE player già esistente. AppShell mantiene una sola subscription
e revision gate; non viene consumata una sesta connessione app-lifetime, che
nel WebView2/Vite HTTP/1.1 avrebbe bloccato le richieste REST. Non esiste
polling.

## UI e accessibilità

La card Settings `Audio` mostra una descrizione generale con chevron canonico.
La sottopagina Audio mostra `Output` e la scelta corrente. La successiva pagina
Output usa header, Back, scrolling nativo e Refresh iconico con
`aria-label="Refresh audio outputs"`.

Le righe mostrano:

- descrizione leggibile;
- ID tecnico secondario;
- `✓ Preferred` separato da `In use`;
- una sola riga sintetica `Unavailable`, disabilitata e senza duplicati;
- `System default` sempre prima e visibile anche con lista MPV vuota.

Controlli reali WebView2 risultano button semantici, focusable, con target touch.
Stato busy, doppio tap e MPV unavailable disabilitano soltanto le azioni
appropriate. La pagina non è una modale e non si chiude dopo selezione.

## Test automatici

Test mirati Audio Output: PASS, 16/16.

Copertura:

- sanitizzazione, limiti, deduplica e `auto` sintetico;
- parser versionato, default, atomicità, corruzione e separazione sessione;
- bootstrap preferenza presente/assente;
- switch success/no-op e playback invariato;
- rollback precedente e rollback fallito con fallback `auto`;
- unplug singolo, reconnect senza auto-switch e next-play apply;
- refresh manuale, MPV unavailable ed eventi semanticamente duplicati;
- gerarchia Settings/Audio/Output, zero/una opzione, selezione non modale e
  Back a due livelli;
- testo sicuro, indicatori preferred/effective/unavailable;
- toast esistente, Refresh e named event sulla SSE player;
- body API chiusi e ordine bootstrap.

Le suite esistenti coprono inoltre player session v2, Power menu, touch scroll,
Queue/Playlist reorder, volume/mute, mini-player e on-screen keyboard.

## Windows real smoke

`REAL MULTI-DEVICE SWITCH — PASS`

Con playback attivo è stato selezionato il device WASAPI reale sicuro e poi
`System default`.

Prima/dopo ogni switch:

- stesso PID MPV;
- stessi 12 Queue ID e stesso ordine;
- stesso current item e indice;
- posizione avanzata normalmente;
- volume, mute, shuffle e repeat identici;
- stato playback rimasto `playing`;
- nessun file reload, seek, Queue rebuild o secondo MPV.

Toast verificati nella vera app:

- `Audio output changed.`;
- `Using System default.`;
- `Audio outputs refreshed.`.

Gerarchia Settings → Audio → Output, Refresh manuale, Back a due livelli, riga
Output always-open, lista reale, descrizione/ID, indicatori e assenza di modale:
PASS. Artwork Now Playing e mini-player, transport, top-bar e layout condivisi
sono stati verificati dopo cold restart: PASS.

## Persistence smoke e stato utente

È stato selezionato temporaneamente WASAPI, eseguito Quit dal Power menu con la
conferma canonica e riavviato `npm.cmd run dev`.

Al riavvio:

- preferenza ed effettivo WASAPI già applicati;
- Queue 12/12 e ID invariati;
- sessione corrente ripristinata in pausa;
- un solo MPV.

Ripristino finale:

- preferenza originale assente;
- file `audio-output.json` rimosso;
- `auto` preferito ed effettivo;
- Queue originale 12/12;
- indice 2, `Hymn For The Weekend`;
- posizione `180.302293`, in pausa;
- volume `97.989433`, mute off, shuffle off, repeat off.

Un ulteriore cold restart ha confermato file assente e restore finale esatto.

## Viewport

Verifica nella vera app Neutralino/WebView2:

- 1280 x 800: PASS;
- 1024 x 768: PASS;
- 1366 x 768: PASS.

Card Audio, riga Output con selezione corrente, pagina di selezione,
header/Back, Refresh, righe e ID lunghi, scroll, mini-player, touch target e
layout sono privi di overflow orizzontale, clipping o layout shift. Lo stato
unavailable è coperto da fixture; nessun device fisico è stato scollegato senza
autorizzazione.

## File modificati

Shared:

- nuovo `packages/shared/src/audio-output.ts`.

Backend:

- `apps/backend/src/api/sse-hub.ts`;
- `apps/backend/src/index.ts`;
- `apps/backend/src/player/mpv-controller.ts`;
- `apps/backend/src/player/player-service.ts`;
- nuovi `apps/backend/src/audio-output/audio-output-error.ts`;
- nuovo `apps/backend/src/audio-output/audio-output-repository.ts`;
- nuovo `apps/backend/src/audio-output/audio-output-service.ts`;
- nuovo `apps/backend/test/audio-output.test.ts`.

UI:

- nuovo `apps/ui/src/api/audio-output-api-client.ts`;
- `apps/ui/src/api/player-api-client.ts`;
- `apps/ui/src/components/app-shell.ts`;
- `apps/ui/src/components/icons.ts`;
- `apps/ui/src/components/types.ts`;
- `apps/ui/src/main.ts`;
- `apps/ui/src/screens/index.ts`;
- `apps/ui/src/screens/settings.ts`;
- `apps/ui/src/styles/screens.css`;
- nuovo `apps/ui/test/step2.15.test.ts`.

Documentazione:

- `docs/development/architecture.md`;
- `docs/development/testing.md`;
- `docs/development/ui-ux.md`;
- questo report.

Non sono cambiati package/lockfile, dipendenze, Neutralino config, Network,
SMB, USB, Queue, Library, visualizer, installer, deploy o workflow.

## Gate finali

- `npm.cmd run format:check`: PASS;
- `npm.cmd run typecheck`: PASS;
- `npm.cmd run lint`: PASS;
- `npm.cmd run build`: PASS;
- `npm.cmd test`: PASS;
- `npm.cmd run test:posix`: PASS;
- `npm.cmd run verify:network:deployment`: PASS;
- `npm.cmd run verify:linux:executables`: PASS;
- `npm.cmd run verify:linux:installer`: PASS;
- `npm.cmd run mpv:doctor`: PASS con MPV reale;
- `npm.cmd run test:mpv`: PASS;
- `git diff --check`: PASS.

`build:linux` non è stato eseguito, come richiesto.

## Installer firewall e cleanup

- `deploy/linux/`: invariato;
- `.github/workflows/`: invariato;
- installer, Power helper, Polkit, install-safe, release verifier e deployment
  modes: invariati;
- nessun Neutralino, backend, Vite, MPV o FFmpeg del progetto;
- nessun listener 4310/5173;
- nessun file preferenza test;
- log e screenshot temporanei rimossi;
- media utente mai modificati.

## Raspberry handoff

`RASPBERRY — NOT TESTED`

Step 2.15.1 dovrà verificare sul dispositivo reale:

1. lista device, System default e backend MPV effettivo;
2. USB DAC, HDMI ed eventuale analogico;
3. scelta durante playback e da fermo;
4. unplug e fallback `auto`;
5. reconnect senza auto-switch;
6. reboot e persistenza;
7. touch e toast;
8. volume/mute;
9. Power menu;
10. playback completo.

Non è stato usato SSH e non sono state modificate configurazioni audio
Raspberry.

## Git

Nessun commit, push, merge, rebase, reset, restore, stash o clean eseguito.
