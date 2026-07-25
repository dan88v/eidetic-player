# Step 2.13.2-R4F-R2 — Align production launcher and backend endpoint

## Problema reale riportato

- Su Raspberry Pi 3 il comando `eidetic-player` non apriva la GUI dopo l'installazione.
- Nel log del launcher:
  - `curl: (7) Failed to connect to 127.0.0.1 port 43789`
  - `backend readiness timeout after 30000 ms`
  - chiusura del backend con SIGTERM
- La causa verificata era una discordanza: launcher hardcoded verso `:43789`, backend configurato su `:4310`.

## Root cause

- `deploy/linux/runtime/eidetic-player-launch` usava `http://127.0.0.1:43789/api/readiness`.
- Il backend leggeva/andava su `BACKEND_PORT` con fallback condiviso `4310`.
- `install.conf` non esponeva ancora esplicitamente host/porta backend.

## Contratto installato

- Aggiunte variabili runtime condivise nel processo production:
  - `BACKEND_HOST=127.0.0.1`
  - `BACKEND_PORT=4310`
- Il launcher ora costruisce `http://$BACKEND_HOST:$BACKEND_PORT/api/readiness`.
- Validazione pre-avvio su host e porta: host loopback/localhost consentito, porta numerica intera 1..65535, no shell injection e no newline.
- Nessun fallback a seconda variabile diversa: host/porta rimangono unici e coerenti con il backend.

## Audit frontend/API

- Nessuna modifica a backend/frontend endpoints in questa correzione.
- Il frontend production continua a usare l'endpoint REST/SSE già previsto sull'ambiente locale (4310) nella baseline.

## Readiness contract preservato

- Il contratto `/api/readiness` e la logica di attesa rimangono invariati:
  - attesa bounded.
- `HTTP 200` su `ready`/`degraded` consente avvio GUI.
- backend morto interrompe l'attesa.
- timeout non avvia GUI.
- Polling curl mantenuto silenzioso, con singola diagnosi finale:
  - `Backend readiness was not reachable at HOST:PORT within N ms`.

## File modificati

- `deploy/linux/runtime/eidetic-player-launch`
- `deploy/linux/install-eidetic-player.sh`
- `deploy/linux/update-eidetic-player.sh`
- `prompts/step2.13.2_r4f_r1_mpv_discovery_output.md`
- `prompts/step2.13.2_r4d_output.md`

## Test e verifica

- `npm.cmd run format:check` : OK
- I file Markdown modificati ora non contengono più caratteri di codifica corrupta nel report R4F-R1/R4D.
- Non sono state eseguite in questa passata le verifiche complete (typecheck/lint/build/test full suite).

## Smokes e staging

- Nessuna modifica al runtime Windows, nessun SSH, nessun Raspberry Pi reale toccato in questa passata.
- Nessun commit/push eseguito.
- Per reinstallazione reale: l'utente procederà dopo push/CI verde.

## Stato finale

- git status --short
- git diff --stat
- git diff --check
