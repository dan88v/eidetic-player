# Step 2.13.2-R4F-R2A Test Sync Output

## Cause

- Il test legacy `linux-installation.test.ts` verificava ancora il readiness endpoint hardcoded `http://127.0.0.1:43789/api/readiness`, mentre il launcher production usa già `BACKEND_HOST`/`BACKEND_PORT` con default `127.0.0.1:4310`.

## Cambiamenti applicati

- Modificato solo: `apps/backend/test/linux-installation.test.ts`
- Nessun file production toccato.
- Nessun commit/push eseguito.

## Assertion aggiornate

- In `launcher waits on backend readiness endpoint with bounded attempts`:
  - Aggiunte check `includes` per:
    - `backend_host="${BACKEND_HOST:-127.0.0.1}"`
    - `backend_port="${BACKEND_PORT:-4310}"`
    - `readiness_endpoint="http://${backend_host}:${backend_port}/api/readiness"`
  - Aggiunta negazione su `43789`.
  - Aggiornato timeout a `readiness_timeout_ms="${EIDETIC_READINESS_TIMEOUT_MS:-30000}"`.
  - Aggiornato messaggio finale a `Backend readiness was not reachable at %s:%s within %d ms`.
- In `installer writes a shared MPV path for all install modes`:
  - Aggiunte verifiche contrattuali su `BACKEND_HOST`/`BACKEND_PORT` e install conf path.
  - Verifica assenza di `BACKEND_HOST=localhost` nel testo legacy.
- Conservate tutte le assertion esistenti su bounded attempts, polling interval, HTTP 200, backend PID/exit checks, assenza `/api/health` e path readiness.

## Test mirati

- `npm.cmd exec prettier -- --write apps/backend/test/linux-installation.test.ts` ✅
- `npm.cmd exec eslint -- apps/backend/test/linux-installation.test.ts` ✅
- `npm.cmd exec tsx -- --test apps/backend/test/linux-installation.test.ts` ✅
- Risultato test file: 13/13 pass, 0 fail

## Gate completi

- `npm.cmd run format:check` ✅
- `npm.cmd run typecheck` ✅
- `npm.cmd run lint` ✅
- `npm.cmd run build` ✅
- `npm.cmd test` ✅
- `npm.cmd run test:posix` ✅
- `npm.cmd run verify:network:deployment` ✅
- `npm.cmd run mpv:doctor` ❌ (ambiente senza MPV)
- `npm.cmd run test:mpv` ✅ (8 skipped)

## Conteggi suite

- `npm.test`: tests 454, pass 446, skipped 8, failed 0
- `test:posix`: tests 5, pass 3, skipped 2, fail 0
- `test:mpv`: tests 8, pass 0, skipped 8, fail 0

## Controlli finali

- `git status --short`:
  - ` M apps/backend/test/linux-installation.test.ts`
  - `?? prompts/step2.13.2_r4f_r2a_test_sync_output.md`
- `git diff --stat`:
  - `apps/backend/test/linux-installation.test.ts | 43 ++++++++++++++++++++++++++--`
  - `1 file changed, 40 insertions(+), 3 deletions(-)`
- `git diff --check`: nessun problema di formattazione
- `git grep -n "43789"`:
  - presente solo in test modificato per `doesNotMatch` e riferimenti storici in `prompts/step2.13.2_r4f_r2_backend_port_output.md`

## Compliance sicurezza

- Nessun SSH usato.
- Nessuna installazione remota.
- Nessun file production o runtime modificato.
