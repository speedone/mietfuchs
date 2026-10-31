#!/bin/bash
# Upgrade-Szenario 0.13.1 -> main, reproduzierbar. Alle Daten unter ./data, Schnappschüsse unter ./snap.
set -e
cd "$(dirname "$0")"
D=$PWD/data; SN=$PWD/snap
rm -rf $D/v0131 $D/main-upgrade $D/main-restore $SN/a-v0131 $SN/b-main $SN/c-restore
node try-seed.mjs $D/v0131                     # Bestand mit 0.13.1 anlegen (Port 3411, NKA_TEST_IDS=seq)
node snap-run.mjs v0131 $D/v0131 $SN/a-v0131   # a) Schnappschuss 0.13.1 samt Backup-ZIP
cp -a $D/v0131 $D/main-upgrade                 # gleicher Datenordner (Kopie, damit a) wiederholbar bleibt)
node snap-run.mjs main $D/main-upgrade $SN/b-main   # b) main startet auf demselben Bestand (Migration)
node restore-run.mjs main $D/main-restore $SN/a-v0131/backup.zip $SN/c-restore   # c) Backup in frisches main
node diff.mjs $SN/a-v0131 $SN/b-main $SN/diff-a-b.json
node diff.mjs $SN/a-v0131 $SN/c-restore $SN/diff-a-c.json
node diff.mjs $SN/b-main $SN/c-restore $SN/diff-b-c.json
