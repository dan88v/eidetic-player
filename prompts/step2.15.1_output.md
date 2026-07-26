# Step 2.15.1 — Raspberry audio bring-up audit

Date: 2026-07-26

## Esito

`BLOCKED — RASPBERRY AUDIO BRING-UP REQUIRES SYSTEM CHANGE`

L'audit SSH read-only ha rilevato correttamente HDMI, ma il PCM5102A non è
enumerato da ALSA, PipeWire o MPV. Nei file boot leggibili non risultano
`dtparam=i2s` né un overlay DAC/I²S. Il gate hardware dello Step 2.15.1 richiede
che il PCM5102A sia presente almeno in ALSA, quindi non sono state avviate
modifiche applicative, baseline/smoke Windows o suite finali.

È necessario uno step correttivo separato e autorizzato per identificare la
configurazione I²S effettivamente adatta al DAC e al cablaggio presenti,
ripristinarla a livello di sistema e verificare che il PCM5102A compaia in
ALSA. Questo step non ha applicato né tentato tale configurazione.

## Baseline Git e CI

- branch: `main`;
- working tree iniziale: pulito;
- HEAD: `aa9d173350c9479b4b283b9d139cd615347e517e`;
- `origin/main`: uguale a HEAD, divergenza `0 0`;
- Step 2.15 presente nel commit
  `aa9d173 # Step 2.15 — Basic Audio Output Settings`;
- `git fetch --prune origin`: completato;
- `git diff --check`: PASS;
- GitHub Actions, workflow `Eidetic Player CI`, run `30205383033` sullo stesso
  SHA: `completed/success`;
- nessun merge, rebase, reset, restore, stash o clean.

## Modalità SSH e sicurezza

- OpenSSH standard verso `<runtime-user>@<raspberry-host>`;
- host key ED25519 mostrata e accettata solo dopo conferma esplicita;
- password inserita esclusivamente nel prompt interattivo OpenSSH visibile;
- password non inserita in command line, environment, file, script, repository
  o report;
- nessuna chiave utente creata e nessuna modifica ad `authorized_keys`;
- host-key checking non disabilitato;
- audit eseguito in una singola sessione read-only dopo l'autenticazione;
- nessun `sudo`, package manager, playback, cambio device/volume, riavvio
  servizi, mount, power action o modifica remota;
- output grezzo mantenuto solo temporaneamente fuori dal repository e rimosso
  dopo la sanitizzazione.

## Sistema remoto sanitizzato

- host: `<raspberry-host>`;
- utente: `<runtime-user>`;
- modello: Raspberry Pi 3 Model B Rev 1.2;
- OS: Debian GNU/Linux 13.6, Trixie;
- kernel: `6.18.34+rpt-rpi-v8`;
- architettura: `aarch64`, 64 bit;
- sessione rilevata dalla shell SSH: `tty`;
- MPV: v0.40.0.

## Audio stack e servizi

- PipeWire: active;
- pipewire-pulse: active;
- WirePlumber: active;
- PulseAudio standalone: inactive;
- stack effettivo più probabile: PipeWire con compatibilità
  pipewire-pulse;
- `wpctl`: disponibile;
- `pw-cli`: disponibile;
- `pactl`: not-available;
- `aplay`: disponibile.

Il default sink osservato è `Built-in Audio Stereo`, mappato alla card ALSA 0
`bcm2835 Headphones`. Non è stato cambiato.

## ALSA, HDMI e PCM5102A

ALSA enumera due card:

- card 0 `Headphones`, device 0, `bcm2835 Headphones`;
- card 1 `vc4hdmi`, device 0, `MAI PCM i2s-hifi-0`.

HDMI è disponibile come `hw/plughw/default/sysdefault/hdmi/dmix` sulla card
`vc4hdmi`. Il nome PCM ALSA `MAI PCM i2s-hifi-0` appartiene al controller HDMI
`vc4-hdmi` e non costituisce rilevamento del DAC PCM5102A.

Non risultano:

- una card ALSA PCM5102A/I²S dedicata;
- un PCM playback PCM5102A;
- un sink PipeWire PCM5102A;
- un device MPV PCM5102A.

## I²S e boot configuration

Righe audio pertinenti rilevate in `/boot/firmware/config.txt`:

- `dtparam=audio=on`;
- `dtoverlay=vc4-kms-v3d`.

Non sono state rilevate:

- `dtparam=i2s`;
- overlay PCM5102A/DAC/I²S;
- duplicazioni o overlay audio I²S conflittuali.

`/boot/config.txt` è presente come percorso leggibile ma non ha restituito righe
audio pertinenti. Nessun file boot è stato modificato.

## MPV

Driver audio disponibili:

- `pipewire`;
- `pulse`;
- `alsa`;
- `jack`;
- `sdl`;
- `sndio`;
- `null`;
- `pcm`.

La lista informativa MPV contiene:

- `auto`;
- default PipeWire;
- `Built-in Audio Stereo`;
- `Built-in Audio Digital Stereo (HDMI)`;
- equivalenti Pulse;
- default ALSA;
- device ALSA Headphones;
- device ALSA `vc4hdmi`.

HDMI è quindi enumerato da MPV; PCM5102A non è enumerato. Il processo MPV
persistente dell'istanza Eidetic esistente usa `--no-config` e non forza né
`--ao` né `--audio-device`. Non è stato usato il suo IPC e non è stato
interrotto.

`current-ao`: NOT TESTED. La build remota precede Step 2.15 e la specifica
vietava di usarla per validare le nuove API o interagire con l'IPC MPV
esistente.

## Matrice hardware

| Livello               | HDMI       | PCM5102A     |
| --------------------- | ---------- | ------------ |
| Kernel/ALSA           | detected   | not detected |
| PipeWire/Pulse        | detected   | not detected |
| MPV audio-device-list | detected   | not detected |
| Physical audio        | not tested | not tested   |

Classificazione:

- audio stack: PipeWire + pipewire-pulse + WirePlumber;
- default sink: bcm2835 Headphones;
- overlay PCM5102A: non rilevato;
- conflitto evidente: nessun overlay I²S conflittuale, ma configurazione
  PCM5102A assente/non attiva;
- modifiche di sistema richieste: sì, da definire e autorizzare in uno step
  separato.

## Audit Eidetic remoto

- `eidetic-player.service`: active;
- launcher: installazione sotto `/opt/eidetic-player`;
- un solo processo MPV persistente osservato;
- nessun `--ao` forzato;
- nessun `--audio-device` forzato;
- nessun environment audio speciale rilevato nelle informazioni consentite;
- build remota precedente a Step 2.15, non aggiornata e non riavviata.

## Modifiche locali e verifiche non eseguite

Nessuna modifica a backend, MPV controller, AudioOutputService, bootstrap,
diagnostica, doctor Linux, installer, UI, persistenza, Queue, sessione,
dipendenze, lockfile o workflow.

Non eseguiti a causa del gate hardware:

- baseline e real smoke Windows;
- implementazione `current-ao`;
- startup wait Linux Appliance;
- estensione doctor Linux;
- test mirati e non-regression;
- build Linux e release verifier;
- gate finali npm/MPV.

Questi controlli non sono dichiarati PASS.

## Stato remoto e fisico

- `RASPBERRY SYSTEM AUDIO AUDIT — BLOCKED`;
- `RASPBERRY STEP 2.15 APPLICATION VALIDATION — NOT TESTED`;
- `PHYSICAL HDMI AUDIO — NOT TESTED`;
- `PHYSICAL PCM5102A AUDIO — NOT TESTED`.

L'audit non ha modificato file, repository, servizi, default sink, device,
volume o boot configuration e non ha lasciato processi persistenti aggiuntivi.

## Step correttivo separato proposto

Prima di riprendere Step 2.15.1 serve un lavoro esplicitamente autorizzato che:

1. identifichi modello/board o overlay precedentemente usato dal PCM5102A senza
   assumerlo dal solo chip;
2. verifichi cablaggio GPIO e requisiti del DAC;
3. definisca la minima configurazione I²S Raspberry Pi OS necessaria;
4. ottenga autorizzazione prima di modificare boot configuration;
5. dopo reboot autorizzato, confermi una card e un PCM playback PCM5102A in
   ALSA;
6. verifichi esposizione PipeWire e MPV senza cambiare automaticamente lo stack
   o il default audio globale.

Nessuno di questi interventi è stato eseguito in questo step.

## Checklist futura dopo correzione e build aggiornata

1. ripetere audit ALSA/PipeWire/MPV;
2. riprendere implementazione Step 2.15.1 solo con gate hardware soddisfatto;
3. installazione/update manuale;
4. avvio Appliance e tempo bootstrap;
5. lista Output e System default;
6. HDMI e PCM5102A;
7. `current-ao`;
8. audio fisicamente udibile su entrambe le uscite;
9. switch durante playback e da fermo;
10. Queue, volume e mute invariati;
11. restart, reboot e persistenza;
12. reconnect senza auto-switch;
13. Power menu, touch, toast e doctor.

## Git e stato finale

Nessun commit o push eseguito. Lo stato non è `READY FOR CI VALIDATION` perché
il prerequisito hardware PCM5102A non è soddisfatto.
