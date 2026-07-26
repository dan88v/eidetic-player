# Step 2.15.1-R1 — PCM5102A GPIO/I²S system configuration

Date: 2026-07-26

## Esito

`PCM5102A ENUMERATION — PASS`

Il Raspberry Pi di test è stato configurato con il solo overlay
`dtoverlay=i2s-dac`. Dopo reboot il DAC è stato enumerato come nuova card
playback da ALSA, esposto da PipeWire/WirePlumber e rilevato da MPV. HDMI, jack
integrato, PipeWire, WirePlumber ed Eidetic Player sono rimasti disponibili.

Un test diretto stereo di cinque secondi sul PCM5102A è stato completato.
L'utente, tecnico audio, ha confermato funzionamento perfetto di entrambi i
canali, senza forte distorsione o rumore anomalo.

Questo è esclusivamente uno step di configurazione del Raspberry. Nessun codice
o servizio Eidetic è stato modificato e Step 2.15.1 applicativo resta da
completare.

## Baseline Git e CI

- branch locale: `main`;
- HEAD e `origin/main`:
  `cbbc6221fc392f9b8394be3a6d2cd565a8e41fa1`;
- divergenza: `0 0`;
- Step 2.15 e audit Step 2.15.1 presenti in HEAD;
- workflow `Eidetic Player CI` sullo stesso SHA:
  `completed/success`, run `30209167389`;
- working tree finale: esclusivamente questo nuovo report R1 non tracciato;
- nessun commit, push, merge, rebase, reset, restore, stash o clean.

## Metodo SSH e sicurezza

- OpenSSH standard verso `<runtime-user>@<raspberry-host>`;
- host key ED25519 verificata e accettata solo dopo conferma utente;
- password SSH e `sudo` inserite esclusivamente dall'utente nelle finestre
  Windows Terminal interattive;
- nessuna password in command line, environment, file, script, repository o
  report;
- `StrictHostKeyChecking` mantenuto attivo;
- nessuna chiave SSH creata e nessuna modifica ad `authorized_keys`;
- output SSH grezzi conservati solo temporaneamente fuori dal repository e
  rimossi durante il cleanup.

## Sistema

- modello: Raspberry Pi 3 Model B Rev 1.2;
- OS: Debian GNU/Linux 13.6, Trixie;
- kernel: `6.18.34+rpt-rpi-v8`;
- architettura: `aarch64`, 64 bit;
- PipeWire: active prima e dopo;
- pipewire-pulse: active prima;
- WirePlumber: active prima e dopo;
- PulseAudio standalone: inactive;
- MPV: v0.40.0;
- Eidetic Player service: active prima e dopo.

## Cablaggio confermato

I numeri indicano pin fisici della testata Raspberry:

| PCM5102A | Pin fisico | Funzione Raspberry   |
| -------- | ---------: | -------------------- |
| VIN      |          2 | 5 V                  |
| GND      |          6 | GND                  |
| SCK      |          9 | GND                  |
| BCK      |         12 | GPIO18 / I²S BCLK    |
| LCK      |         35 | GPIO19 / I²S LRCK/WS |
| DIN      |         40 | GPIO21 / I²S DOUT    |

Conferme utente:

- modulo compatibile con VIN 5 V e regolatore onboard;
- SCK intenzionalmente collegato a massa;
- assenza di pin aggiuntivi `XSMT`, `FMT`, `FLT`, `DMP` e `DEMP`;
- volume dell'impianto a valle ridotto prima del test;
- nessuna modifica a cablaggio, alimentazione o ponticelli.

## Audit pre-modifica

`/boot/firmware/config.txt`:

- file boot attivo, presente e non vuoto;
- mode/owner: `0755`, `root:root`;
- `dtparam=audio=on` presente;
- nessun `dtparam=i2s`;
- nessun overlay DAC/audio/I²S concorrente;
- ultima sezione globale: `[all]`;
- HDMI e jack integrato rilevati;
- PCM5102A assente.

Overlay:

- `/boot/firmware/overlays/i2s-dac.dtbo`: disponibile;
- descrizione locale: passive I²S DAC soundcard;
- parametri overlay: nessuno;
- nessun overlay alternativo provato.

## Backup e modifica

Backup creato:

`/boot/firmware/config.txt.eidetic-pcm5102a-<timestamp>.bak`

Verifiche:

- backup presente;
- `cmp` byte-per-byte: identical;
- mode/owner backup: `0755`, `root:root`;
- dimensione originale/backup: 1286 byte;
- candidato temporaneo generato in `/tmp`;
- conferma utente ottenuta immediatamente prima della scrittura;
- installazione atomica tramite file stage nella stessa filesystem;
- mode/owner finale preservati: `0755`, `root:root`;
- file finale non vuoto;
- backup conservato per rollback.

Diff esatto applicato nella sezione `[all]`:

```diff
+
+# Eidetic PCM5102A GPIO/I2S
+dtoverlay=i2s-dac
```

`dtparam=audio=on` è rimasto presente. Nessun'altra riga è cambiata.

## Reboot

- configurazione riletta e verificata prima del reboot;
- piano di rollback mostrato e backup disponibile;
- conferma utente separata ottenuta immediatamente prima del reboot;
- reboot eseguito con `sudo systemctl reboot`;
- SSH effettivamente non disponibile durante il riavvio;
- Raspberry tornato raggiungibile dopo quattro controlli distanziati di circa
  dieci secondi;
- uptime post-reboot osservato: circa un minuto.

## Enumerazione prima e dopo

### ALSA prima

- card 0: `bcm2835 Headphones`;
- card 1: `vc4hdmi`, device 0 `MAI PCM i2s-hifi-0`;
- PCM5102A/I²S dedicato: assente.

### ALSA dopo

- card 0: `bcm2835 Headphones`, invariata;
- card 1: `vc4hdmi`, invariata;
- nuova card 2: `sndrpirpidac`;
- nuovo PCM playback:
  `RPi-DAC HiFi pcm1794a-hifi-0`, device 0.

Moduli pertinenti caricati:

- `snd_soc_bcm2835_i2s`;
- `snd_soc_pcm1794a`;
- `snd_soc_rpi_simple_soundcard`;
- `snd_soc_core`;
- `snd_pcm`.

Non sono stati restituiti errori kernel gravi pertinenti nel filtro
post-reboot.

### PipeWire prima

- sink jack integrato presente;
- sink HDMI presente;
- PCM5102A assente.

### PipeWire dopo

- PipeWire e WirePlumber: active;
- tre device ALSA presenti;
- jack integrato presente;
- HDMI presente;
- nuovo sink DAC esposto come
  `alsa_output.platform-soc_sound.stereo-fallback`;
- default sink non modificato.

### MPV prima

- `auto`, PipeWire, Pulse e ALSA presenti;
- jack integrato e HDMI enumerati;
- PCM5102A assente.

### MPV dopo

Nuovi device relativi al DAC:

- `pipewire/alsa_output.platform-soc_sound.stereo-fallback`;
- `pulse/alsa_output.platform-soc_sound.stereo-fallback`;
- `alsa/plughw:CARD=sndrpirpidac,DEV=0`;
- `alsa/default:CARD=sndrpirpidac`;
- `alsa/sysdefault:CARD=sndrpirpidac`;
- `alsa/dmix:CARD=sndrpirpidac,DEV=0`.

`auto`, jack e HDMI restano enumerati. Non è stato modificato il default audio
globale e non è stato forzato `--ao`.

## Test audio fisico

Autorizzazione utente separata ottenuta immediatamente prima del test.

Comando:

```text
timeout 5s speaker-test \
  -D plughw:CARD=sndrpirpidac,DEV=0 \
  -c 2 \
  -t sine \
  -f 440
```

Risultato tecnico:

- `speaker-test` già disponibile in `/usr/bin`;
- device corretto aperto;
- 48 kHz, S16_LE, 2 canali;
- Front Left e Front Right eseguiti;
- terminazione `124` attesa dal timeout di cinque secondi;
- PipeWire active prima e dopo;
- Eidetic Player active prima e dopo;
- nessun default sink, volume, mixer o gain modificato.

Conferma fisica utente:

- canale sinistro: PASS;
- canale destro: PASS;
- forte distorsione: assente;
- rumore anomalo: assente;
- valutazione complessiva: funzionamento perfetto.

`PHYSICAL PCM5102A AUDIO — PASS`

L'audio fisico HDMI non è stato riprodotto in questo step:

`PHYSICAL HDMI AUDIO — NOT TESTED`

## Rollback

Rollback non eseguito perché tutti i gate sono PASS e non si sono verificate
regressioni.

Backup conservato. Contratto di rollback:

```text
sudo cp --preserve=mode,ownership,timestamps \
  /boot/firmware/config.txt.eidetic-pcm5102a-<timestamp>.bak \
  /boot/firmware/config.txt
```

Un eventuale rollback richiede nuova conferma esplicita e un secondo reboot
confermato.

## Regression firewall

- repository Eidetic remoto: invariato;
- repository applicativo locale: nessuna modifica;
- applicazione, service, launcher e MPV Eidetic: invariati;
- PipeWire, WirePlumber, PulseAudio e ALSA config: invariati;
- `~/.asoundrc` e `/etc/asound.conf`: non creati/modificati;
- default sink, mixer, volume e mute: invariati;
- HDMI e audio onboard: non disabilitati;
- boot cmdline: invariata;
- package installati/rimossi: nessuno;
- kernel, firmware e sistema: non aggiornati;
- file audio di sistema e media utente: invariati;
- Network, SMB, Power, autostart, display e touch: invariati.

L'utente ha autorizzato l'eventuale installazione di ciò che fosse necessario,
ma nessun package era richiesto: overlay e strumenti erano già disponibili.

## Stato remoto finale

- Raspberry raggiungibile;
- configurazione boot verificata;
- PCM5102A enumerato da ALSA, PipeWire e MPV;
- HDMI presente;
- jack presente;
- PipeWire active;
- WirePlumber active;
- Eidetic Player active;
- backup disponibile;
- nessun processo di audit persistente;
- nessun aggiornamento Eidetic eseguito.

## File locali

Creato soltanto:

- `prompts/step2.15.1_r1_pcm5102a_output.md`.

Il precedente `prompts/step2.15.1_output.md` è tracciato in HEAD ed è rimasto
invariato. Gli output SSH grezzi temporanei non sono inclusi nel repository.

## Lavoro successivo

Step 2.15.1 applicativo non è dichiarato completo. Restano da implementare e
validare in uno step successivo:

- diagnostica `current-ao`;
- attesa event-driven Linux Appliance;
- bootstrap audio conservativo;
- doctor Linux audio;
- test Windows/Linux;
- aggiornamento manuale della build Raspberry e relativa validazione
  applicativa.

## Git

Nessun commit o push eseguito.
