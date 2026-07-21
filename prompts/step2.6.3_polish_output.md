# Step 2.6.3-P — Cassette metadata, utility controls and time display

Data: 21 luglio 2026  
Esito: completato, senza commit o push e senza iniziare altri step.

## Ambiente e stato Git

- Windows, Neutralino/WebView2, Node `v24.18.0`, npm `11.16.0`.
- Branch `main`; HEAD `14f08b2a905c715dbe38ce4bbd14b2660ccb0b22`; divergenza da `origin/main`: `0 0`; nessun merge o rebase in corso.
- Il working tree iniziale conteneva intenzionalmente lo Step 2.6.3-R non committato: controller animazione, geometria, fisica, progress, reel layer, CSS Cassette, test 2.6.2/2.6.3, documentazione Cassette/performance/testing, test e report di regressione.
- Gli asset Cassette sono rimasti invariati: `cassette-frame.png` SHA-256 `F59D60D5E5C1896F469E1FB2ECC2623370E140EA52DA88D60AA8B2F724AC4A09`; `cassette-master-original.png` SHA-256 `D513DDC96C060480EBC6FD87609EC9C6DC0A72910FF59CD4F7C435116DB1DA7D`.

## Risultato

- L’etichetta avorio usa tutto il rettangolo sicuro `x=150`, `y=567`, `width=770`, `height=82`, `padding=8` nel `viewBox 0 0 1070 710`.
- In seguito allo steering, artista e album sono su un’unica riga, nel formato `Artista - Album`, così il testo può essere più grande. Se un valore manca viene mostrato solo quello disponibile; con entrambi assenti non viene mostrato testo. I placeholder backend `Unknown Artist` e `Unknown Album` sono filtrati.
- Il layer SVG metadata è statico, sopra al frame, usa solo `textContent`, non entra nel percorso `requestAnimationFrame` e si aggiorna soltanto al cambio di identità/metadati o disponibilità del font. La descrizione accessibile è sintetica e non usa `aria-live`.
- L’auto-fit puro e limitato parte da 40 px, scende fino a 14 px con al massimo 12 iterazioni e applica l’ellissi Unicode soltanto se il testo non entra ancora alla misura minima. Whitespace, accenti, apostrofi, trattini, parentesi e ampersand sono coperti dai test.
- Library/Folders sono a sinistra, Volume/Queue a destra, con touch target da 64 px e ancoraggio ai bordi esterni della finestra Cassette. Le regole Folders Only, Library Only e Both non lasciano spazi artificiali.
- I quattro controlli delegano alle callback e allo stato esistenti: navigazione Library/Folders, popup Volume/mute e Queue drawer globale. Non sono stati creati route, API, slider Volume, Queue drawer o business state aggiuntivi.
- Elapsed è ancorato al bordo sinistro e total/remaining al bordo destro della finestra. Dopo l’ultimo steering la dimensione è `clamp(1.5rem, 3.4vh, 2.25rem)`; resta 1.5 rem nel profilo a bassa altezza. Il font usa cifre tabulari.
- La riga tempi riusa esattamente i formatter condivisi del Default, compresi segno del remaining, toggle total/remaining, durata assente e seek preview. Non introduce timer, interrogazioni MPV o una seconda seekbar.
- La struttura finale è: header globale, utility row Cassette, scena Cassette, time row, mini-player globale. Default Player e mini-player non sono stati modificati.

## Font locali

- [Nothing You Could Do — sorgente ufficiale Google Fonts](https://github.com/google/fonts/tree/main/ofl/nothingyoucoulddo): originale `NothingYouCouldDo.ttf`, runtime `NothingYouCouldDo-Regular.ttf`, 34.920 byte, SHA-256 `1DAF8CF79076BF59C5A9117B5EFD6ECEA35E57A05EF127FE4F95B072B8A5245D`, licenza `OFL.txt` inclusa.
- [Bitcount Single — sorgente ufficiale Google Fonts](https://github.com/google/fonts/tree/main/ofl/bitcountsingle): originale `BitcountSingle[CRSV,ELSH,ELXP,slnt,wght].ttf`, runtime `BitcountSingle-Variable.ttf`, 353.980 byte, SHA-256 `007608C704D41CFFF140892070B71F31971EC6D85B9F8AD5FDD0D2625F517C70`, licenza `OFL.txt` inclusa.
- I file non sono stati convertiti o modificati. Sono caricati una sola volta tramite Font Loading API, senza bloccare il playback e con fallback Open Sans locale. Non sono presenti `@import`, CDN, URL font remoti o base64.
- `Eidetic Nothing You Could Do` è limitato ai metadata Cassette; `Eidetic Bitcount Single` è limitato ai tempi Cassette. Nessuna tipografia globale è cambiata.

## Layout, accessibilità e responsive

- CSS interamente scoped sotto `.cassette-player`; focus visibile, controlli semantici, aria-label coerenti col Default, nessun bottone annidato e nessun tab stop per il testo decorativo.
- Verifica reale alle viewport `1280×800`, `1366×768`, `1600×900`, `1280×720` e `1024×600`: nessun overflow, overlap, scroll o layout shift; controlli e tempi rimangono ai bordi, il testo resta nell’avorio e il mini-player resta invariato.
- Verificati in Neutralino/WebView2: metadata brevi, lunghi, mancanti, artist-only, album-only ed ellissi; font locali visibili; Library, Folders, Music browsing visibility, Volume, mute, Queue globale, total/remaining, seek preview, Play/Pause, Next/Previous, ritorno a Default e mini-player globale.
- L’automazione Browser non disponeva di un browser collegabile nella sessione; la QA è stata quindi eseguita direttamente sulla finestra reale Neutralino tramite input Windows e acquisizioni `PrintWindow`, poi eliminate.

## Test e bundle

- `npm.cmd ci`: completato, 212 pacchetti verificati e 0 vulnerabilità.
- `npm.cmd audit`: 0 vulnerabilità.
- `npm.cmd run format:check`: superato.
- `npm.cmd run typecheck`: superato.
- `npm.cmd run lint`: superato.
- `npm.cmd run build`: superato; bundle UI: CSS 61,03 kB (gzip 10,62 kB), JS 169,07 kB (gzip 46,45 kB), Nothing You Could Do 34,92 kB, Bitcount Single 353,98 kB, Open Sans 532,63 kB.
- `npm.cmd test`: 263 test, 261 superati, 2 skip POSIX attesi, 0 errori.
- `npm.cmd run mpv:doctor` e `npm.cmd run test:mpv`: superati, 4/4 test MPV.
- `npm.cmd run ffmpeg:doctor` e `npm.cmd run test:ffmpeg`: superati, 3/3 test FFmpeg.
- `git diff --check`: superato.
- La nuova regressione copre composizione e sicurezza metadata, fitting/ellissi, hash/licenze/font locali, caricamento singolo e scoping, assenza di aggiornamenti nel percorso caldo, mapping e callback dei controlli, formattazione/preview tempi e ancoraggio ai bordi.

## Performance e non regressioni

- Nessun nuovo polling, `setInterval`, `EventSource`, processo FFmpeg, listener ad alta frequenza o loop `requestAnimationFrame`.
- Il polish non modifica formule fisiche, source/destination, direzione, velocità, progress temporale, masse, finestrino, controller a 30 fps o reel layer dello Step 2.6.3-R.
- Default Player, visualizer cycle, toast passivo, artwork, waveform, Queue model/revision, PlayerService, REST/SSE, MPV e session restore restano invariati.
- Unico plumbing esterno al modulo Cassette: `apps/ui/src/main-player/main-player-host.ts`, con passaggio additivo di callback/stato già esistenti e copertura di regressione. Nessuna modifica ad AppShell o screen factory è stata necessaria.

## File del polish e separazione dal 2.6.3-R

- Nuovi moduli Cassette: `cassette-fonts.ts`, `cassette-metadata-layer.ts`, `cassette-text-fit.ts`, `cassette-time-row.ts`, `cassette-utility-controls.ts`.
- Modifiche polish nel modulo: `cassette-main-player.ts`, `cassette-geometry.ts`, `cassette-player.css`.
- Font e licenze: directory `nothing-you-could-do` e `bitcount-single` sotto `apps/ui/src/assets/fonts/`.
- Test: `apps/ui/test/step2.6.3-polish.test.ts`.
- Documentazione: `docs/development/cassette-player.md`, `docs/development/performance.md`, `docs/development/testing.md` e questo report.
- Plumbing esterno: solo `apps/ui/src/main-player/main-player-host.ts`.
- Le altre modifiche già presenti a controller, fisica, progress, reel layer, test 2.6.2/2.6.3 e report regressione appartengono allo Step 2.6.3-R e sono state preservate.

## Cleanup e stato finale

- Chiusura reale verificata: nessun Node del progetto, Neutralino, MPV o FFmpeg residuo e nessun listener sulle porte 4310/5173; observer, callback, timer e rAF Cassette sono stati distrutti con la vista. Le fixture, gli screenshot e i font temporanei di QA sono stati rimossi.
- Le preferenze alterate soltanto per la QA sono state ripristinate: Library Only, tempo remaining, mute disattivato e coda/sessione vuota.
- La verifica CI/Linux resta pending perché il lavoro è locale, non committato e non pubblicato.
- Il working tree resta intenzionalmente non pulito con le modifiche 2.6.3-R e 2.6.3-P. Nessun commit, push, merge, rebase, reset, restore, stash o clean è stato eseguito.
- Non è stato iniziato alcun nuovo step.
