# Revelio

A Dynamic Island for GNOME.

Revelio puts a small black notch at the top of your screen. Closed, it shows the time, or what's
playing. Hover over it and it opens into a row of tabs for music, focus, tasks, money, calendar and
system stats. Volume, battery, headphones and notifications pop up from it.

It runs inside GNOME Shell as an extension, so there's no extra app in the background. It reacts to
events instead of polling, and it pauses while the screen is locked or off.

Requires **GNOME 50** (Ubuntu 26.04 LTS, Fedora 44 and other GNOME 50 distributions).

## Features

**Music**
- Controls for any MPRIS player (Spotify, Firefox, Rhythmbox, mpv…), with a seek bar and album art
- Synced lyrics from [LRCLIB](https://lrclib.net), with the current line highlighted beside the player
- On the closed island: the track title, small playback controls and animated bars

**Tabs**
- **Focus**: a Pomodoro timer whose countdown stays on the closed island
- **Tasks**: a to-do list where `#tag` sets a category and `@tomorrow 9:00` sets a deadline. Overdue tasks raise an alert, and the list also opens in its own window
- **Money**: a monthly budget split into cash and e-wallet. Set money aside for bills or savings goals, see what's left for today, and export a report to `~/Documents/Revelio/Money.xlsx`
- **Today**: a calendar with your events from GNOME Calendar and Evolution
- **Shelf**: drop files on the island to keep them close
- **System**: CPU, memory, drives, network, battery, GPU, top apps, and a power page showing how much each part draws

**Pop-ups**
- Volume, charging and battery level, and Bluetooth headphones with their battery level

**Add-ons** (off by default, switch on in settings)
- Notifications from other apps, with a history tab and privacy switches
- Clipboard history
- A teleprompter for reading scripts
- A shortcut to GNOME's screen recorder

**Settings**
- Hover or click to open, open and close delays, width
- Clock, minimal, hidden-until-hover or status-bar look when closed
- Which monitor it appears on, and whether it hides over full-screen apps
- 24-hour clock and sounds

## Install

### From a release

1. Download `revelio@midra.shell-extension.zip` from the [latest release](https://github.com/admir4ljoni/Revelio/releases/latest).
2. Install it:
   ```bash
   gnome-extensions install --force revelio@midra.shell-extension.zip
   ```
3. Log out and back in (Wayland can't load new extensions in a running session).
4. Enable it:
   ```bash
   gnome-extensions enable revelio@midra
   ```

Settings open with `gnome-extensions prefs revelio@midra`, or from the gear on the open island.

### From source

```bash
git clone https://github.com/admir4ljoni/Revelio.git
cd Revelio
gnome-extensions pack --force --extra-source=src .
gnome-extensions install --force revelio@midra.shell-extension.zip
```

Then log out and back in, and enable it as above.

### Optional

- GPU stats need `nvidia-smi` on NVIDIA. AMD and Intel are read directly.
- Calendar events come from Evolution Data Server, which ships with GNOME.

## Privacy

Revelio only sends two kinds of requests: lyrics lookups to lrclib.net (the track's title, artist,
album and length), and album-art downloads from the address your music player gives. Tasks and money
stay in `~/.local/share/revelio@midra`. Clipboard and notification history are kept in memory only.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
