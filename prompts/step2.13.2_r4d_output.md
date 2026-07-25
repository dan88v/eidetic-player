# Step 2.13.2-R4D Output

- Scope: Align Standard/Appliance semantics for Linux installer, add explicit `--borderless` appliance choice, remove implicit default `EIDETIC_BORDERLESS` fallback, update migration behavior, docs, and targeted tests.

## Stato baseline
- Working tree: clean before modifiche.
- Baseline funzionante congelata: verificata da step precedenti (`main`, no file dirty, branch sincronizzato).
- Nota: nel riepilogo iniziale era già registrato `npm.cmd run format:check` non pulito (`prompts/step2.13.2_r4b_output.md`); non ho rieseguito il full-suite nel presente passaggio.

## Decisione Standard approvata
- `standard` ora forza tutte le opzioni takeover a `no`:
  - `autostart=no`
  - `fullscreen=no`
  - `borderless=no`
  - `blanking=no`
  - `pointer=no`
  - `splash=no`
  - `autologin=no`
- Nessun prompt Appliance in standard.

## Comportamento Appliance
- `--mode appliance` mantiene le scelte indipendenti.
- Opzione nuova `--borderless yes|no` aggiunta tra le scelte Appliance.
- Prompt interattivo previsto per `borderless`:
  - `Run Eidetic Player without window borders? [y/N]`
- Nessun comportamento di panel hiding implementato.

## Nuovo flag / install.conf
- Aggiunto `--borderless yes|no` all’help, parser e lista scelte.
- `EIDETIC_BORDERLESS` ora deriva solo da scelta installer:
  - `choice[borderless] == yes` -> `1`
  - `choice[borderless] == no` -> `0`
- Rimosso il fallback generale equivalente a `EIDETIC_BORDERLESS=${EIDETIC_BORDERLESS:-1}`.
- `install.conf` scritto con entrambe le chiavi esplicite:
  - `EIDETIC_BORDERLESS=0|1`
- Mantene le restanti chiavi richieste e nessun nuovo flag nascosto.

## Neutralino
- Il generatore continua a leggere `borderless` da `process.env.EIDETIC_BORDERLESS === "1"`.
- L’ambiente build dell’installer esporta `EIDETIC_BORDERLESS` esplicitamente prima di runtime/CI.

## Update / compatibilità
- `update-eidetic-player.sh` ora normalizza le opzioni prima di rilanciare l’installer:
  - Modalità non esplicitamente appliance -> trattata come `standard`.
  - Standard normalizzato a takeover-off (`fullscreen=0`, `borderless=0`, `blanking=0`, `autostart=0`, `pointer=0`, `splash=0`, `autologin=0`).
  - Appliance preserva le scelte installazione (`autostart`, `fullscreen`, `blanking`, `pointer`, `splash`, `autologin`) quando presenti.
  - Appliance legacy con `EIDETIC_BORDERLESS` assente -> fallback `borderless=1`.
  - Appliance legacy con `EIDETIC_BORDERLESS=0` -> preservato.
- L’update continua a delegare all’installer senza duplicare la logica applicativa.

## Test e verifica
- Aggiornati:
  - `apps/backend/test/neutralino-installer.test.ts`
  - `apps/backend/test/linux-installation.test.ts`
  - `deploy/linux/test-staging.sh`
- Verifiche eseguite in questo passaggio:
  - `git diff --check`
  - `git status --short`
- Verifiche non eseguite in questo passaggio:
  - `npm.cmd run format:check`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd test`, `npm.cmd run test:posix`, `npm.cmd run verify:network:deployment`, `npm.cmd run dev`, suite di staging completa.

## file modificati
- `deploy/linux/install-eidetic-player.sh`
- `deploy/linux/update-eidetic-player.sh`
- `deploy/linux/test-staging.sh`
- `deploy/linux/README.md`
- `apps/backend/test/neutralino-installer.test.ts`
- `apps/backend/test/linux-installation.test.ts`

## Componenti congelati
- Nessuna modifica a runtime MPV, packaging, backend core, detection OS, path, policy di rete/USB/SMB, shell runtime o altri componenti congelati.

## Limiti / stato finale
- Raspberry Pi hardware: `NOT TESTED` in questa sessione.
- Nessuna documentazione/implementazione per panel hiding (rimane fuori scope).
- Nessun commit/push effettuato.

- Stato: `PARTIAL` fino a esecuzione completa delle verifiche richieste nel piano step.
