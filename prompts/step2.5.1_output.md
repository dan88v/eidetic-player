# Step 2.5.1 — GitHub Actions Linux CI

Data: 20 luglio 2026  
Esito: **COMPLETATO LOCALMENTE**. Il workflow e la documentazione sono pronti,
le verifiche Windows e la QA Neutralino reale sono PASS. L'esecuzione
GitHub-hosted resta **PENDING / NOT TESTED** fino a commit, push e prima run su
GitHub. Non sono stati eseguiti commit, push, merge o rebase e lo Step 2.6 non è
stato iniziato.

## Ambiente e baseline

- Clone: `C:\Users\dan88\Desktop\eidetic-player`.
- Ambiente: Windows 11 Pro 64-bit, build 26200; PowerShell.
- Branch: `main`.
- HEAD: `0da81249d9b1ac882be5f8c27bd9219b4cf86755`.
- Node: `v24.18.0`; npm: `11.16.0`.
- Stato Git iniziale: pulito, nessun `MERGE_HEAD`.
- `HEAD` e `origin/main` erano identici dopo `git fetch --prune origin`
  (`0 0` ahead/behind).

## File

Creati:

- `.github/workflows/ci.yml`;
- `prompts/step2.5.1_output.md`.

Modificati:

- `README.md`;
- `docs/development/testing.md`;
- `docs/development/linux-debian.md`.

`linux-debian.md` è stato aggiornato oltre ai due file documentali
esplicitamente richiesti perché la sezione esistente dichiarava ancora che il
repository non avesse GitHub Actions. Nessun codice applicativo, database,
migration, dipendenza o lockfile è stato modificato.

## Workflow

- Nome: `Eidetic Player CI`.
- Trigger: push su `main`, pull request verso `main`, `workflow_dispatch`.
- Permissions: solo `contents: read`; nessun secret o token personalizzato.
- Concurrency:
  `${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}`
  con `cancel-in-progress: true`, senza collisioni fra ref differenti.
- Job: `Linux checks` su `ubuntu-latest`, timeout 20 minuti.
- Actions ufficiali: `actions/checkout@v6` e `actions/setup-node@v6`, major
  stabili verificate nelle pagine ufficiali
  [checkout releases](https://github.com/actions/checkout/releases) e
  [setup-node releases](https://github.com/actions/setup-node/releases), oltre
  che tramite i tag remoti `v6`.
- Node: letto direttamente da `.nvmrc`; nessuna duplicazione di `24.18.0`
  nello YAML.
- Cache: cache npm standard di `setup-node`, dipendenza
  `package-lock.json`; nessuna cache di `node_modules`, Library, artwork,
  configurazione, runtime, media o artefatti Neutralino.
- Installazione unica con `npm ci`, seguita da
  `git diff --exit-code -- package-lock.json`.
- Gate separati: `npm audit`, `format:check`, `typecheck`, `lint`, `build`,
  `npm test`, `test:posix`, `test:case-sensitive`.
- È stata scelta la forma granulare: `test:linux` concatena già case-sensitive,
  POSIX e `npm test`; usarlo insieme alla suite standard avrebbe eseguito
  inutilmente due volte tutti i test. Gli step separati mantengono il gate
  fallito immediatamente leggibile.
- Nessun `continue-on-error`, `|| true`, skip condizionale, `sudo`,
  `pull_request_target`, schedule, tag, deploy, upload o permesso di scrittura.

Prettier ha analizzato lo YAML con successo e la revisione statica conferma
trigger, indentazione, comandi e riferimenti npm. La validazione reale su runner
GitHub non è ancora avvenuta.

## Test runtime esclusi dalla CI

La prima versione non esegue `doctor:linux`, `build:linux`, `smoke:linux`,
`verify:arm`, MPV/FFmpeg doctor o integrazioni, Neutralino, WebKitGTK/WSLg,
dialoghi, audio o GUI. Queste prove richiedono dipendenze di sistema, display o
hardware e restano manuali nelle milestone platform-sensitive. La CI non
sostituisce la QA Windows, il clone Debian/WSL case-sensitive o un Raspberry Pi
3B reale.

## Documentazione

README e guida testing descrivono trigger, runner, `.nvmrc`, cache, gate,
limiti, QA Windows con `npm.cmd run dev`, diagnosi Debian/WSL e validazione
Raspberry Pi separata. La guida Linux non contiene più l'affermazione obsoleta
che il workflow sia assente. Non è stato aggiunto alcun badge.

## Verifiche locali Windows

| Comando                    | Esito                                            |
| -------------------------- | ------------------------------------------------ |
| `npm.cmd ci`               | PASS; 211 pacchetti, lockfile SHA-256 invariato  |
| `npm.cmd audit`            | PASS; 0 vulnerabilità                            |
| `npm.cmd run format:check` | PASS                                             |
| `npm.cmd run typecheck`    | PASS                                             |
| `npm.cmd run lint`         | PASS                                             |
| `npm.cmd run build`        | PASS; 63 moduli, Vite 1,06 s                     |
| `npm.cmd test`             | PASS; 205 totali, 203 pass, 2 skip POSIX, 0 fail |
| `git diff --check`         | PASS                                             |

`test:posix` e `test:case-sensitive` sono presenti in `package.json` e
referenziati realmente nel workflow. Non sono dichiarati PASS su NTFS e non
sono stati alterati per Windows.

## `npm.cmd run dev` e QA Neutralino

Il comando letterale richiesto è stato avviato e ha aperto la finestra
Neutralino/WebView2 reale. La finestra misurava 1296 × 839 con area client
1280 × 800.

- La superficie iniziale è rimasta scura durante il bootstrap e ha raggiunto
  Now Playing senza flash bianco.
- Backend `/health` e Vite erano disponibili.
- Sono stati ispezionati Now Playing, artwork, waveform, Library con 44 Track,
  4 Album, 5 Artist e 0 Unavailable, Folders, Queue, Settings e mini-player.
- Il ciclo visualizzatori è stato esercitato con riproduzione reale:
  Mono → Stereo → Meter → Technical → None → Mono.
- Non sono comparsi errori evidenti, superfici bianche, layout shift o
  sostituzioni stale osservabili.
- Non sono state modificate Source, Queue o Library e nessun media è stato
  rinominato, modificato o eliminato.

La finestra è stata chiusa realmente tramite `WM_CLOSE`. Dopo lo shutdown:
zero listener 4310/5173, zero Node/Vite/backend del progetto, zero Neutralino,
zero MPV, zero FFmpeg, directory runtime assente e `library.db` apribile in
esclusiva. Non risultano scanner task o handle SQLite residui.

## Limiti e stato finale

- GitHub Actions reale: **PENDING / NOT TESTED**; non viene dichiarato PASS
  Linux, Ubuntu o hosted runner.
- `test:posix` e `test:case-sensitive` su filesystem Linux: non rieseguiti in
  questo clone Windows; la loro esecuzione resta affidata al runner e al clone
  Debian/WSL.
- WebKitGTK/WSLg, MPV/FFmpeg Linux, ARM e Raspberry Pi hardware: esclusi da
  questo micro-step.
- Nessuna dipendenza aggiunta, nessun workflow di release/deploy e nessun
  cambiamento applicativo.
- Nessun commit o push eseguito.
- Step 2.6: **NON INIZIATO**.
