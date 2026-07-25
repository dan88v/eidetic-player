# Step 2.13.2-R4F - Appliance MPV startup readiness and Linux discovery fallback

## Baseline

- Repository: `C:\Users\dan88\Desktop\eidetic-player`
- Branch corrente: `main`
- Stato allineamento con `origin/main`: `0	0` in `git rev-list --left-right --count HEAD...origin/main`
- Stato working tree al termine: modifiche locali presenti (vedi tabella file)
- Commit piu recenti:
  - `a75d2b7 spark - step 2.13.2 r4d - installer fixes/audit`
  - `cbd2f62 spark - step 2.13.2 r4d - installer fixes/audit`
  - `bf6eacc spark - step 2.13.2 r4c - installer fixes/audit`
  - `8a7e9d5 spark - step 2.13.2 r4b - installer fixes`
  - `dcec3df spark - step 2.13.2 r4a - installer fixes`

## Problema Raspberry Pi riportato dall'utente

- Installazione Appliance pulita riuscita.
- MPV presente in `/usr/bin/mpv` e funzionante.
- Al reboot/avvio automatico in modalita Appliance compariva ancora `MPV not available`.
- Rilevata discrepanza tra installazione Standard "precedente" funzionante e regressione in Appliance.

## Nessun accesso remoto

- Nessun SSH
- Nessuna connessione/installazione su Raspberry Pi reale
- Nessuna modifica a sistemi Linux reali durante questo step

## Riproduzione locale del problema (fixture)

- Aggiunti test mirati per readiness e launcher:
  - `apps/backend/test/readiness-endpoint.test.ts`
  - parte dei test Linux/infrastruttura in `apps/backend/test/linux-installation.test.ts`
- I test includono i casi di bootstrap non terminato, readiness iniziale non pronta, polling e avvio GUI condizionato.
- E stato verificato che prima della correzione il flusso non poteva garantire la partenza solo dopo stato definitivo (ora testato e prevenuto da stato `ready`/`degraded`).

## Root cause confermata

1. Endpoint errato
   - Launcher puntava a endpoint non corretto per readiness.
2. Attesa non verificata
   - Polling non bloccava realmente l'avvio GUI in caso di timeout/assenza readiness.
3. Bootstrap readiness assente
   - `/health` restava solo liveness HTTP e non rappresentava stato MPV/player bootstrap.
4. Discovery MPV insufficiente su Linux
   - Mancava fallback esplicito a `/usr/bin/mpv` con verifica versionale e ordine robusto dei candidati.

## Modifiche implementate

- Backend
  - Aggiunto stato bootstrap minimale: `starting | ready | degraded`.
  - Introdotto endpoint esplicito `GET /api/readiness` in [apps/backend/src/index.ts](C:\Users\dan88\Desktop\eidetic-player\apps\backend\src\index.ts).
  - Stato readiness separato dal contratto `GET /health` (rimane liveness semplice).
  - Aggiunti contratti condivisi in [packages/shared/src/health.ts](C:\Users\dan88\Desktop\eidetic-player\packages\shared\src\health.ts).
  - Aggiunto modulo stato in [apps/backend/src/readiness.ts](C:\Users\dan88\Desktop\eidetic-player\apps\backend\src\readiness.ts).
- Launcher
  - Corretto [deploy/linux/runtime/eidetic-player-launch](C:\Users\dan88\Desktop\eidetic-player\deploy\linux\runtime\eidetic-player-launch) verso `GET /api/readiness`.
  - Polling bounded (timeout/intervali chiari), terminazione con codice non-zero se non arriva readiness.
  - Chiusura immediata con errore se backend termina durante attesa.
  - Nessun avvio GUI dopo timeout; nessun loop infinito.
- MPV discovery
  - Rafforzata priorita candidati in [apps/backend/src/player/mpv-discovery.ts](C:\Users\dan88\Desktop\eidetic-player\apps\backend\src\player\mpv-discovery.ts):
    1. `EIDETIC_MPV_PATH`
    2. `/usr/bin/mpv` su Linux
    3. `mpv` dal PATH
  - Deduplica candidati.
  - Verifiche con `--version` anche per fallback Linux assoluto.
  - Logging diagnostico sintetico e privo di path raw per candidato configurato.
  - Preserva comportamento precedente su Windows (nessun `/usr/bin/mpv`).
- MPV service
  - Allineamento logging e bootstrap compatibility in [apps/backend/src/player/player-service.ts](C:\Users\dan88\Desktop\eidetic-player\apps\backend\src\player\player-service.ts).

## Endpoint readiness

- `GET /health`: liveness HTTP semplice (rimasto invariato).
- `GET /api/readiness`:
  - `starting` ? HTTP 503 (safe payload, nessun path/secret/stack)
  - `ready` ? HTTP 200 con stato player + flag `mpvAvailable`
  - `degraded` ? HTTP 200 con stato `degraded`, `mpvAvailable` e `errorCode` pubblico

## Launcher

- Attende esclusivamente `/api/readiness` con timeout consigliato Pi3.
- Avvia GUI solo su HTTP 200 ready/degraded.
- Non apre GUI su timeout.
- Termina con errore non-zero su timeout o chiusura backend durante attesa.
- Pulizia e cleanup backend mantenuti invariati.

## Discovery candidates

- Implementata risoluzione piattaforma-safe e minima con fallback condizionale Linux.
- Priorita coerente con richiesta: custom path > `/usr/bin/mpv` > PATH.
- PATH rimane disponibile come ultimo fallback.

## Diagnostica sicura

- Diagnostica non include stack completi, password, env completi, argomenti utente, path NAS/USB.
- Per custom path viene segnalata come `configured MPV path`.
- Logging di successo in formato sintetico.

## Daemon-reload audit

- Nessuna modifica operativa al flow di daemon-reload e stata introdotta in questo step.
- Non e emersa evidenza tecnica che imponga cambio per correggere la regression; audit documentato e mantenuto.

## Standard non-regression

- Nessuna modifica alla semantica Standard/Appliance fuori dall'ambito.
- `installer writes a shared MPV path for all install modes` confermato dai test esistenti.
- Nessuna modifica a `install.conf` key semantics oltre a mantenere allineamento MPV.

## Appliance test

- Test install pipeline e packaging Linux presenti in suite backend sono verdi; coprono anche staging-safe semantics e launcher/service flow.
- Non sono stati eseguiti run reali su Raspberry Pi.

## Gate completi (eseguiti in questa sessione)

| Comando                                 | Totale | Pass | Fail | Skipped |
| --------------------------------------- | -----: | ---: | ---: | ------: |
| `npm.cmd run format:check`              |      0 |    0 |    0 |       0 |
| `npm.cmd run typecheck`                 |      0 |    0 |    0 |       0 |
| `npm.cmd run lint`                      |      0 |    0 |    0 |       0 |
| `npm.cmd run build`                     |      0 |    0 |    0 |       0 |
| `npm.cmd test`                          |    452 |  445 |    0 |       7 |
| `npm.cmd run test:posix`                |      5 |    3 |    0 |       2 |
| `npm.cmd run verify:network:deployment` |      0 |    0 |    0 |       0 |
| `npm.cmd run mpv:doctor`                |      0 |    0 |    0 |       0 |
| `npm.cmd run test:mpv`                  |      8 |    8 |    0 |       0 |
| `npm.cmd run ffmpeg:doctor`             |      0 |    0 |    0 |       0 |
| `npm.cmd run test:ffmpeg`               |      3 |    3 |    0 |       0 |

- Totale aggregato gate con test conteggiabili: **468 total, 459 passed, 9 skipped, 0 failed**.

## MPV/FFmpeg integration

- `npm.cmd run mpv:doctor` ?
- `npm.cmd run test:mpv` ?
- `npm.cmd run ffmpeg:doctor` ?
- `npm.cmd run test:ffmpeg` ?

## Smoke test locale

- **Non eseguito in questa sessione** (`npm.cmd run dev` non avviato).

## Staging

- **Non eseguito localmente per limitazioni ambiente corrente**: dichiarato `STAGING PARTIAL`.
- Test fixture e unit/integration gia presenti coprono install/update/uninstall/rollback policy e installer behavior.

## Limiti

- Nessun test eseguito su Raspberry Pi reale in questo step.
- Non eseguiti test visivi 1280x800 e run completo di `npm.cmd run dev`.

## Istruzione di reinstallazione successiva

- Dopo commit/push, rifare una installazione pulita Appliance locale per validare definitivamente la sequenza bootstrap + readiness path.

## File modificati

- `apps/backend/src/index.ts`
- `apps/backend/src/player/mpv-discovery.ts`
- `apps/backend/src/player/player-service.ts`
- `apps/backend/src/readiness.ts`
- `apps/backend/test/linux-installation.test.ts`
- `apps/backend/test/mpv-discovery.test.ts`
- `apps/backend/test/readiness-endpoint.test.ts`
- `deploy/linux/README.md`
- `deploy/linux/runtime/eidetic-player-launch`
- `packages/shared/src/health.ts`

## Stato commit/push

- Nessun commit/push eseguito.

## Comandi finali richiesti

```txt
git status --short
git diff --stat
git diff --check
```

### Output

```txt
 M apps/backend/src/index.ts
 M apps/backend/src/player/mpv-discovery.ts
 M apps/backend/src/player/player-service.ts
 M apps/backend/test/linux-installation.test.ts
 M deploy/linux/README.md
 M deploy/linux/runtime/eidetic-player-launch
 M packages/shared/src/health.ts
?? apps/backend/src/readiness.ts
?? apps/backend/test/mpv-discovery.test.ts
?? apps/backend/test/readiness-endpoint.test.ts
```

```txt
 apps/backend/src/index.ts                    |  40 +++++++-
 apps/backend/src/player/mpv-discovery.ts     | 148 ++++++++++++++++++++++++---
 apps/backend/src/player/player-service.ts    |   5 +
 apps/backend/test/linux-installation.test.ts |  51 +++++++++
 deploy/linux/README.md                       |  37 +++++++
 deploy/linux/runtime/eidetic-player-launch   |  37 ++++++-
 packages/shared/src/health.ts                |  19 ++++
 7 files changed, 315 insertions(+), 22 deletions(-)
```

```txt
(no diff whitespace/patch issues)
```
