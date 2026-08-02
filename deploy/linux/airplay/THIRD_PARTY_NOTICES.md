# AirPlay receiver third-party notices

Eidetic Player builds its optional receiver integration from exact official
source releases at installation time. The corresponding source identities,
archive checksums, build flags, and Eidetic patch are recorded in
`sources.json`.

## Shairport Sync 5.2.1

Copyright (c) 2011–2013 James Laird and copyright (c) 2014–2017 Mike Brady.
Shairport Sync is distributed under the MIT license and includes components
with their own notices. The complete corresponding source, `LICENSES`, and
component license files are available from the official pinned source archive:
https://github.com/mikebrady/shairport-sync/tree/5.2.1

Eidetic changes the lifecycle command path so a failed blocking before-play
hook prevents the audio backend from opening. The complete patch is shipped in
`patches/shairport-sync-5.2.1-eidetic-fail-closed.patch`.

## NQPTP 1.2.8

Copyright (c) Mike Brady and contributors. NQPTP is distributed under the GNU
General Public License, version 2 or (at your option) any later version. The
complete corresponding source and license are available from the official
pinned source archive: https://github.com/mikebrady/nqptp/tree/1.2.8

No NQPTP source changes are applied by Eidetic Player.
