# Step 2.13.2-R4A — Stato finale

## Modifiche applicate

- `scripts/generate-neutralino-config.ts`
  - `modes.window.borderless` ora dipende da `process.env.EIDETIC_BORDERLESS === "1"`.
- `deploy/linux/install-eidetic-player.sh`
  - Rimossa logica `sed`/`grep` per forzare `borderless`.
  - Aggiunta esportazione e default:
    - `EIDETIC_BORDERLESS=${EIDETIC_BORDERLESS:-1}`
    - `export EIDETIC_INSTALLATION_MODE EIDETIC_FULLSCREEN EIDETIC_BORDERLESS`
  - Aggiunta in `install.conf`:
    - `EIDETIC_BORDERLESS=$EIDETIC_BORDERLESS`
- `deploy/linux/lib/common.sh`
  - Aggiunto `EIDETIC_BORDERLESS="${EIDETIC_BORDERLESS:-0}"` all’ambiente di `eidetic_run_as_runtime_user`.
- `deploy/linux/update-eidetic-player.sh`
  - Aggiunta esportazione `EIDETIC_BORDERLESS="${EIDETIC_BORDERLESS:-1}"` prima della delega all’installer.
- `apps/backend/test/neutralino-installer.test.ts` (nuovo)
  - Test statici su env `EIDETIC_BORDERLESS`, install.conf, passaggio runtime e fallback senza `--borderless`.

## Verifiche eseguite

- `npm.cmd run format:check` ✅
- `npm.cmd run typecheck` ✅
- `npm.cmd run lint` ✅
- `npm.cmd run build` ✅
- `npm.cmd test` ✅

## Stato finale

- Nessun fail nei controlli eseguiti.
- Nessun warning/formattazione aperta.
- Nessuna modifica semantica oltre lo scope R4A.

## Note

- File modificati con `git status --short` al termine:
  - `apps/backend/test/linux-installation.test.ts`
  - `deploy/linux/install-eidetic-player.sh`
  - `deploy/linux/lib/common.sh`
  - `deploy/linux/update-eidetic-player.sh`
  - `scripts/generate-neutralino-config.ts`
  - `apps/backend/test/neutralino-installer.test.ts`
  - `prompts/step2.13.2_r4a_output.md`
