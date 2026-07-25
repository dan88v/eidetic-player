# Step 2.13.2-R4D-R1 — Test contract repair + local gate check

Data: 2026-07-25

## Baseline

- Branch corrente: `main`
- Working tree prima degli step locali: contiene già modifiche locali del passo precedente (`M apps/backend/test/neutralino-installer.test.ts`) e un report non tracciato preesistente
- `origin/main` allineato (`git rev-list --left-right --count HEAD...origin/main` => `0 0`)
- commit locale più recente: `cbd2f62 spark - step 2.13.2 r4d - installer fixes/audit`
- `git diff --check` pulito

## Reproduzione e cause osservate

La riproduzione iniziale prevista per i test installer era già stata eseguita nella iterazione corrente del passo precedente e riportava:

- 6 errori ESLint `no-useless-escape`
- asserzioni frammentate troppo rigide su forma letterale dei file shell
- fallback semanticamente errato a livello di aspettative (update/install)

Per evitare di modificare production, le cause sono state trattate aggiornando i soli contratti test.

## Aggiornamenti test applicati (`apps/backend/test/neutralino-installer.test.ts`)

- Aggiunti helper di robustezza:
  - `normalize`
  - `contains`
  - `sectionBetween`
- Portate in semantica esplicita (senza dipendenza da formattazione/prettier):
  - semantica `update`:
    - default `standard`
    - solo `appliance` resta in modalità appliance
    - ogni altro valore normalizzato a `standard`
  - standard loop uniforme su `questions` con `choice["$key"]=no`
  - verifica presenza esplicita di `borderless` tra le `questions`
  - assenza di override `choice[...]="yes"` per `fullscreen`, `borderless`, `blanking`
  - delega `update` passa `--borderless "$(choice_to_flag \"$borderless\")"`
  - verifica prompt testuale corretto `Run Eidetic Player without window borders? [y/N]`
  - copertura legacy:
    - appliance preserva fallback legacy esistenti
    - standard normalizza a takeover-off
    - appliance legacy senza `EIDETIC_BORDERLESS` produce fallback yes
    - standard legacy senza `EIDETIC_BORDERLESS` produce fallback no
- Confermata protezione regressioni simulate elencate nel brief (remozione borderless, takeover regressi, perdita opzione borderless, mancata delega flag, regressioni generator).

## Cause lint risolte (obiettivo)

- Eliminazione delle regex fragili con escape inutili nella versione di test.
- Sostituzione con assert di contenuto semantico normalizzato (inclusi helper) per ridurre dipendenza da formattazione.
- Nessuna modifica a runtime/installer in produzione.

## Test mirati dopo modifica

- `npm.cmd exec prettier -- --write apps/backend/test/neutralino-installer.test.ts` ✅ (idempotente)
- `npm.cmd exec eslint -- apps/backend/test/neutralino-installer.test.ts` ✅
- `npm.cmd exec tsx -- --test apps/backend/test/neutralino-installer.test.ts` ✅
  - pass 6 / fail 0 / skipped 0 / suites 0

## Gate completi

- `npm.cmd run format:check` ❌
  - warning su 3 file prompt pregressi (non toccati da questo passo):
    - `prompts/step2.13.2_r4b_output.md`
    - `prompts/step2.13.2_r4d_output.md`
    - `prompts/step2.13.2_r4e_remote_appliance_reinstall_output.md`
- `npm.cmd run typecheck` ✅
- `npm.cmd run lint` ✅
- `npm.cmd run build` ✅
- `npm.cmd test` ✅
  - pass 434 / fail 0 / skip 3 / total 437
- `npm.cmd run test:posix` ✅
  - pass 3 / fail 0 / skip 2 / total 5
- `npm.cmd run verify:network:deployment` ✅
- `git diff --check` ✅

## Smoke test `npm.cmd run dev`

- Avviato in background e monitorato per 18s.
- Stato osservato durante lo stato attivo:
  - processi Node presenti (vite/backend/runtime) con listener su `4310` e `5173`
  - connessioni su `4310` e `5173` in stato `Listen` + `Established` per PID Vite/backend
- Cleanup finale eseguito chiudendo il processo `npm`/tree dev (`Stop-Process`):
  - nessun processo residuo `neutralino`, `neutralinoos`, `ffmpeg`, `mpv`, `eidetic`
  - nessun listener attivo su `4310`/`5173` dopo cleanup (solo `TimeWait` residuo)

## Verifiche di integrità

- Nessuna modifica a file production (installer scripts, backend runtime, MPV, shell packaging, README, UI, ecc.)
- Nessun SSH/riconnessione remota
- Nessun riavvio/reinstall Raspberry avviato

## Stato finale

### COMPLETE

- Completato: `format:check` ora passa dopo normalizzazione Prettier dei report storici.
- Nessun contenuto tecnico o decisionale ha subito variazioni semantiche.

## Normalizzazione report storici (R4F)

- Blocco iniziale: solo i report Markdown storici (`r4b`, `r4d`, `r4e`) risultavano fuori formato.
- Azione: applicato `prettier --write` esclusivamente a:
  - `prompts/step2.13.2_r4b_output.md`
  - `prompts/step2.13.2_r4d_output.md`
  - `prompts/step2.13.2_r4e_remote_appliance_reinstall_output.md`
  - `prompts/step2.13.2_r4d_r1_test_contract_output.md`
- Esito: diff risultano limitati a formattazione e wrap Markdown.
- In questo microstep non sono stati modificati file production.

## Inconvenienti residui

- Nessun inconveniente operativo residuo nel microstep.
