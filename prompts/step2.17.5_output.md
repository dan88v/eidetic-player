# Step 2.17.5 — Raspberry LAN/NAS Reachability Corrective

## Stato

Diagnosi reale Raspberry completata, fix minimo implementato localmente, test
Windows e gate finali completati. Commit, push, CI, update Raspberry e
validazione NAS post-fix non sono ancora stati eseguiti.

`READY FOR CI VALIDATION — RASPBERRY NAS FIX NOT DEPLOYED`

## Baseline Git e CI

- Branch: `main`.
- Working tree iniziale: pulito.
- HEAD iniziale e `origin/main`:
  `2c95717f5907d7806059bef3b00f228b2561204a`.
- Divergenza `HEAD...origin/main`: `0 0`.
- Step 2.17–2.17.4 presenti nella history.
- Touch scrolling Raspberry: già validato.
- Exact-head `Eidetic Player CI`: run `30276389974`, PASS.
- `git diff --check` iniziale: PASS.
- Nessun commit, push, merge, rebase, reset, restore, stash o clean eseguito.

## Controllo positivo Windows

- Windows → NAS IP: PASS.
- Source IP: `10.0.0.109`.
- Interfaccia: Wi-Fi.
- Route verso `10.0.0.2`: diretta.
- ICMP: PASS.
- TCP 445: PASS.
- Browse read-only `\\10.0.0.2\music`: PASS.
- Entry top-level: 34; nessun nome file riportato.
- Identità ottenuta tramite `WNetGetUser`: utente logico `moode`, nessun
  domain/workgroup.
- Mapping Windows preesistente: invariata.
- Dialect esatto non esposto dai cmdlet per la mapping deviceless; il controllo
  Windows e il successivo mount CIFS Linux confermano comunque SMB moderno.

## Audit Raspberry read-only

- Build installata: `6f49d17540d88afc3ef076ccdebc210094b02dac`.
- Build ID: `6f49d17`.
- Raspberry: Pi 3 Model B Rev 1.2.
- OS: Debian 13 Trixie, arm64.
- Kernel: `6.18.34+rpt-rpi-v8`.
- Runtime user: `daniele`, UID/GID 1000.
- Servizio `eidetic-player.service`: active.
- Readiness: ready, MPV disponibile, player paused.
- Snapshot SMB iniziale: zero connessioni configurate.
- Interfaccia scelta: `wlan0`, UP.
- Source IP Raspberry: `10.0.0.112/24`.
- Gateway: `10.0.0.1`.
- Ethernet: down/unavailable.
- NetworkManager non è stato modificato.

### Route matrix

| Controllo            | Windows       | Raspberry       |
| -------------------- | ------------- | --------------- |
| IP nella LAN         | PASS          | PASS            |
| Route `10.0.0.2`     | PASS, diretta | PASS, diretta   |
| Interfaccia scelta   | Wi-Fi         | `wlan0`         |
| Neighbour resolution | known         | PASS, REACHABLE |
| ICMP                 | PASS          | PASS            |
| TCP 445              | PASS          | PASS            |
| SMB auth             | PASS          | PASS            |

La route Raspberry seleziona `wlan0` e source `10.0.0.112`; non esistono route
più specifiche, duplicate, VPN, tunnel o policy route alternative. Il
neighbour è passato da assente a REACHABLE dopo il ping bounded. Tre ping su
tre sono riusciti. Il socket TCP 445 è raggiungibile.

### Firewall e componenti SMB

- `nft`, `iptables`, `ip6tables` e `firewall-cmd`: non installati/disponibili;
  l'assenza dei tool non è stata trattata come errore.
- Nessuna modifica firewall eseguita.
- `cifs-utils`: installato, stato `ii`.
- `mount.cifs`: `/usr/sbin/mount.cifs`, versione 7.4.
- Modulo kernel CIFS: disponibile, versione 2.57; caricato dal primo mount.
- `smbclient`: non installato; non è stato installato.
- Helper installato: root:root 0755.
- Policy Polkit installata: root:root 0644.
- Helper e policy installati coincidono con gli hash della sorgente locale.
- Runtime user presente nel gruppo `eidetic-player-network`.
- Sessione Wayland locale: active, remote=no.
- Polkit ha autorizzato ed eseguito realmente l'helper dal backend.

## Autenticazione e mount diagnostico

La password è stata richiesta solo nel terminale visibile, tramite input
`/dev/tty` senza echo. Non è comparsa in chat, argv, environment, output, log,
report, repository o history.

Il primo controller diagnostico leggeva erroneamente dalla pipe dello script,
non dalla TTY: quei tentativi non hanno acquisito la password NAS e i relativi
fallimenti sono stati invalidati. Il controller è stato corretto per leggere
esplicitamente da `/dev/tty`.

Il primo test autenticato valido ha prodotto:

- username: `moode`;
- domain: assente;
- dialect predefinito moderno: PASS;
- SMB 3.1.1/3.0/2.1 non provati perché il default ha funzionato;
- SMB1: mai provato o abilitato;
- guest fallback: mai usato;
- credential directory temporanea: privata;
- credential file: root:root 0600;
- mount: CIFS read-only, PASS;
- `ro`, `nosuid`, `nodev`, `noexec`: PASS;
- entry top-level: 34;
- browse come runtime user: PASS;
- stat e lettura bounded di un file come runtime user: PASS;
- nessuna scrittura o indicizzazione;
- unmount: PASS.

Un primo controllo post-unmount basato su `findmnt --target` ha dato un falso
positivo perché restituiva il filesystem padre. Corretto con
`findmnt --mountpoint`; la verifica separata ha confermato:

- mount diagnostici: 0;
- directory diagnostiche: 0;
- credential file diagnostici: 0.

## Pipeline Eidetic e riproduzione

Pipeline reale:

`UI → POST /api/smb/connections → SmbConnectionService →`
`LinuxSmbCredentialStore → LinuxSmbAdapter → pkexec →`
`eidetic-player-smb-helper → mount -t cifs → mountpoint →`
`DirectoryBrowserService → MPV`

Input e ownership:

- UI/API: server IP letterale, share, account e password nel body;
- credential store: file 0600 del runtime user in directory 0700;
- adapter: target sotto `XDG_RUNTIME_DIR`;
- helper: root:root, autorizzato dalla policy Polkit;
- kernel CIFS: mount read-only;
- browse e player: runtime user.

Riproduzione:

1. UI Add Share con password verificata localmente: FAIL,
   `Unable to mount this share`.
2. API loopback con password digitata via TTY e body stdin/in-memory: HTTP 409,
   `generic-failure`, stesso errore.
3. Snapshot dopo failure: zero record, zero credenziali e zero mount
   persistenti.
4. Probe lifecycle a 5 ms:
   - credential vista, mode 0600 e owner runtime user: PASS;
   - target runtime visto;
   - mount CIFS mai raggiunto;
   - durata failure: 581 ms;
   - quattro directory runtime vuote residue.

Quick Browse UI/API e playback Eidetic pre-fix: non raggiungibili. Nessuna
Library Source è stata creata e la share non è stata indicizzata.

## Root cause

Classificazione: **backend lifecycle / helper contract**, con cleanup POSIX
secondario.

Il backend genera:

`smb-` + 32 caratteri esadecimali

tramite `randomBytes(16).toString("hex")`.

L'helper installato accettava invece soltanto:

`smb-` + 16 caratteri esadecimali.

Di conseguenza l'helper usciva con codice 65 prima di invocare CIFS. La
connessione nativa funzionava, ma il percorso Eidetic falliva.

Inoltre il cleanup usava `fs.rm(..., {recursive: false})` su directory:
l'operazione non le rimuoveva e lasciava un target vuoto per ogni tentativo
fallito. Il probe ne ha misurati quattro.

Sono esclusi come root cause:

- IP/subnet;
- route o interfaccia;
- neighbour/L2 e AP isolation;
- TCP 445;
- firewall locale dimostrabile;
- dialect SMB;
- autenticazione;
- share inesistente;
- UID/GID o lettura runtime;
- Polkit;
- NetworkManager;
- UI password transport.

## Fix minimo locale

- Helper: target regex allineata a esattamente 32 hex lowercase.
- Adapter Linux: cleanup dei soli mountpoint vuoti tramite `rmdir`.
- Cleanup non ricorsivo; nessun contenuto remoto può essere rimosso.
- Runner dell'adapter iniettabile soltanto per il test unitario mirato.
- Fixture staging aggiornata al contratto ID reale.
- Documentazione SMB/testing aggiornata.

Non sono stati modificati:

- NetworkManager, DHCP, route o Keep/Revert;
- NAS, router, AP o firewall;
- dialect o autenticazione;
- SMB1, guest o `sec=ntlm`;
- UI, shared contract, Library, Queue, player, Favorites o Audio Output;
- installer/updater;
- package plan e dipendenze.

## Windows regression

L'app reale è stata avviata con il comando obbligatorio
`npm.cmd run dev`.

- connessione alla stessa share: PASS;
- Quick Browse: PASS;
- browse nested: PASS;
- playback di una traccia: PASS;
- Queue, Network, Audio Output e Power: nessuna regressione segnalata;
- artwork Quick Browse: non confermata visivamente, senza errore osservato;
- Library NAS: non avviata;
- uscita app: completata;
- backend e frontend dev: nessun listener residuo;
- MPV, FFmpeg, Neutralino, Vite e Node dell'app: nessun processo residuo.

Il solo processo Node inizialmente contato come residuo era il runtime del tool
Codex con working directory nel repository, non un processo Eidetic.

## Test RED e test mirati

- RED: il test helper ha dimostrato che la sorgente non accettava il contratto
  32-hex del backend.
- Dopo il fix:
  - contratto helper 32-hex: PASS;
  - cleanup mountpoint dopo helper exit 65: PASS;
  - `bash -n deploy/linux/runtime/eidetic-player-smb-helper`: PASS;
  - `bash -n deploy/linux/test-staging.sh`: PASS;
  - typecheck: PASS;
  - `git diff --check`: PASS.

## Gate finali

- `npm.cmd run format:check`: PASS.
- `npm.cmd run typecheck`: PASS.
- `npm.cmd run lint`: PASS.
- `npm.cmd run build`: PASS.
- `npm.cmd run build:linux`: PASS.
- `npm.cmd test`: 539 totali, 529 PASS, 10 SKIP previsti.
- `npm.cmd run test:posix`: 3 PASS, 2 SKIP previsti.
- `npm.cmd run verify:network:deployment`: PASS.
- `npm.cmd run verify:linux:executables`: PASS, 41 file.
- `npm.cmd run verify:linux:installer`: PASS.
- Suite install-safe: 71 totali, 60 PASS, 11 SKIP previsti.
- `npm.cmd run verify:linux:release -- --root . --arch x64 --phase build`:
  PASS.
- `npm.cmd run mpv:doctor`: PASS.
- `npm.cmd run test:mpv`: 9/9 PASS.
- `npm.cmd run ffmpeg:doctor`: PASS.
- `npm.cmd run test:ffmpeg`: 3/3 PASS.
- `git diff --check`: PASS.

Due file `__pycache__` generati dai test installer sono stati spostati
puntualmente in una quarantena temporanea esterna al repository. Nessun
artefatto generato rimane nel working tree.

## Diff review e regression firewall

Diff limitato a helper/adapter SMB POSIX, test, documentazione e report.

Diff esplicitamente vuoti:

- `package.json`;
- `package-lock.json`;
- `.github/workflows`;
- installer e updater;
- componenti UI;
- Now Playing;
- reliable touch scrolling;
- Audio Output;
- player;
- shared contracts.

La build installata sul Raspberry non è stata patchata. I quattro mountpoint
vuoti misurati appartengono ai tentativi effettuati con il vecchio helper:
sono smontati, non contengono credenziali e saranno eliminati durante il
cleanup della validazione post-CI. Mount e credenziali residue attuali: zero.

## File modificati

- `apps/backend/src/smb/smb-platform-adapter.ts`
- `apps/backend/test/linux-installation.test.ts`
- `apps/backend/test/smb-connections.test.ts`
- `deploy/linux/runtime/eidetic-player-smb-helper`
- `deploy/linux/test-staging.sh`
- `docs/development/smb.md`
- `docs/development/testing.md`
- `prompts/step2.17.5_output.md`

## Package plan

`package.json` e `package-lock.json` invariati. Nessuna dipendenza o package di
runtime aggiunto.

## Fasi ancora richieste

1. commit e push manuali;
2. exact-head CI verde;
3. update Raspberry normale;
4. test completo UI Connect, Quick Browse root/nested, playback, reconnect e
   restart;
5. updater no-op;
6. credential leak audit e cleanup finale.

Nessun commit o push automatico.

`READY FOR CI VALIDATION — RASPBERRY NAS FIX NOT DEPLOYED`
