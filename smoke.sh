#!/usr/bin/env bash
# Headless smoke test: pack, boot a throwaway gnome-shell with only Revelio enabled,
# print its state (1 = ENABLED) and any JS errors. Doesn't touch your real settings.
# ponytail: fixed 12 s boot wait; poll the D-Bus name if it gets flaky.
set -e
cd "$(dirname "$0")"
gnome-extensions pack --force --extra-source=src . 2>/dev/null || gnome-extensions pack --force .
T=$(mktemp -d /tmp/rv.XXXX)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/cfg" "$T/data/gnome-shell/extensions/revelio@midra" "$T/run" && chmod 700 "$T/run"
unzip -q revelio@midra.shell-extension.zip -d "$T/data/gnome-shell/extensions/revelio@midra"
glib-compile-schemas "$T/data/gnome-shell/extensions/revelio@midra/schemas"  # what `gnome-extensions install` does
XDG_CONFIG_HOME=$T/cfg XDG_DATA_HOME=$T/data XDG_RUNTIME_DIR=$T/run dbus-run-session bash -c '
  gsettings set org.gnome.shell enabled-extensions "[\"revelio@midra\"]"
  gsettings set org.gnome.shell disable-user-extensions false
  timeout 20 gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x720 &
  sleep 12
  gdbus call --session -d org.gnome.Shell.Extensions -o /org/gnome/Shell/Extensions \
    -m org.gnome.Shell.Extensions.GetExtensionInfo revelio@midra | grep -oE "'"'"'(state|error)'"'"': <[^>]*>"
  wait' 2>&1 | grep -E "state|error'|JS ERROR|revelio" || true
