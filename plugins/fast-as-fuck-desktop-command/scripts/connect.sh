#!/bin/sh
set -eu
runtime_file="$HOME/.fast-as-fuck-desktop-command/app/runtime.plist"
if [ ! -f "$runtime_file" ]; then
  /usr/bin/open -gj -b dk.mikkel.fast-desktop-command
  attempt=0
  while [ ! -f "$runtime_file" ] && [ "$attempt" -lt 100 ]; do
    /bin/sleep 0.1
    attempt=$((attempt + 1))
  done
fi
if [ ! -f "$runtime_file" ]; then
  echo 'Open Fast Desktop Command and start the connection first.' >&2
  exit 1
fi
node_path=$(/usr/libexec/PlistBuddy -c 'Print :Node' "$runtime_file")
engine_path=$(/usr/libexec/PlistBuddy -c 'Print :Engine' "$runtime_file")
app_path=$(/usr/libexec/PlistBuddy -c 'Print :App' "$runtime_file")
if [ ! -x "$node_path" ]; then
  echo 'Open the installed Fast Desktop Command app to refresh its runtime location.' >&2
  exit 1
fi
export FAF_APP_BUNDLE="$app_path"
exec "$node_path" "$engine_path/scripts/app-connect.mjs"
