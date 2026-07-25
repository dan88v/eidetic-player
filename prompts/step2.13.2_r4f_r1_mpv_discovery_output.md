# Step 2.13.2-R4F-R1 è Fix MPV banner validation and discovery test contract

## Problema Raspberry riportato

- Installazione su Raspberry Pi 3 riusciva fino a `npm test`, quindi build phase failed.
- Errore nel test `apps/backend/test/mpv-discovery.test.ts` con candidato `not-mpv` trattato come valido.
- Test di privacy diagnostics aspettavano path assoluto dal PATH fallback, ma il contratto corrente esponeva `"mpv"`.

## Log/test interpretato

- Esempio log osservato: `player] MPV candidate mpv (path) => not-found` / `MPV unavailable: no candidate succeeded`.
- Test locali: `discoverMpv reports invalid version and continues fallback` e `discoverMpv diagnostics do not leak configured executable path`.

## Causa

1. Regex troppo permissiva nella validazione banner (substring `includes("mpv")`).
2. Contratto del candidato PATH trattato in modo errato nel test aspettando path assoluto.

## Contratto implementato

- Nuova funzione: `isValidMpvVersionLine(line: string): boolean`.
- Banner accettato solo se la linea inizia con token `mpv` (case insensitive) e segue un identificatore di versione reale `v?MAJOR.MINOR[.PATCH]`.
- Non è più accettato `not-mpv`, `fake-mpv ...`, `this is mpv ...` o altre sottostringhe.
- PATH candidate mantiene contratto logico: `executable: "mpv"` (nessuna risoluzione manuale PATH).

## Modifiche file

- `apps/backend/src/player/mpv-discovery.ts`
  - Aggiunta `isValidMpvVersionLine` con validazione minimale del banner.
  - Sostituita logica `includes("mpv")` con validazione rigorosa.
- `apps/backend/test/mpv-discovery.test.ts`
  - Aggiornata aspettativa PATH fallback a `result.executable === "mpv"`.
  - Aggiunti test tabellari banner validi e non validi.
  - Corretto test invalid-version per non accettare `not-mpv` come successo e verificare fallback.
  - Corretto test privacy per non richiedere path assoluto e verificare assenza del path configurato nei diagnostics/log.

## Test mirati eseguiti

- `npm.cmd exec tsx -- --test apps/backend/test/mpv-discovery.test.ts`
  - pass: 5
  - fail: 0
  - skipped: 5

## Gate completi eseguiti

- `npm.cmd run format:check` ?
- `npm.cmd run typecheck` ?
- `npm.cmd run lint` ?
- `npm.cmd run build` ?
- `npm.cmd test` ?
- `npm.cmd run test:posix` ?
- `npm.cmd run verify:network:deployment` ?
- `npm.cmd run mpv:doctor` ?? (fallito in ambiente locale: MPV non disponibile)
- `npm.cmd run test:mpv` ?? (8 skipped, MPV non disponibile)
- `git diff --check` ?

## Conteggi complessivi

- `npm.cmd test`: total 454, passed 446, skipped 8, failed 0
- `test:posix`: total 5, passed 3, skipped 2, failed 0
- Gate mpv-discovery mirati: total 10, passed 5, skipped 5, failed 0

## Linux local test

- `npm.cmd run test:posix` non su WSL Linux reale per questo ambiente.
- Stato: `NOT RUN`.

## MPV discovery contracts aggiornati

- `result.executable` per PATH fallback resta logico e invariato (`"mpv"`).
- `diagnostics`: primo tentativo invalid-version deve essere `invalid-version`, non success.
- Nessun log path risolto; custom path è sanitizzato come `configured MPV path`.

## Diagnostica privacy

- Verificato che neppure in diagnostics serializzati e neppure nei log compare:
  - il valore di `EIDETIC_MPV_PATH` realizzato nel test,
  - il path della directory temporanea fallback.

## R4F-R1 regressione checklist

- valid-banner: aggiornato.
- PATH contract: aggiornato.
- no path assoluto nei risultati PATH: aggiornato.
- candidate order, fallback e no duplicate: preservato.
- non toccati i file di installer/launcher/readiness/player-service.

## Smoke test

- Non eseguito: `npm.cmd run dev`.

## Raspberry Pi reale

- Non testato in questo step (`Raspberry Pi reale NOT TESTED`).

## Limitazioni

- Ambiente locale Windows: MPV non installato, quindi `mpv:doctor` e integrazione reale MPV restano non verificabili localmente.
- Nessun SSH / nessuna modifica remota / nessun accesso Raspberry.

## Istruzione di reinstallazione successiva

- Eseguire una installazione pulita dopo commit/push per verificare la sequenza reale e rimuovere definitivamente il build stop in fase test.

## File finali presenti

- `apps/backend/src/player/mpv-discovery.ts`
- `apps/backend/test/mpv-discovery.test.ts`
- `prompts/step2.13.2_r4f_r1_mpv_discovery_output.md`

## Stato commit/push

- Nessun commit/push eseguito.
