# Quick Launch

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![GNOME Version](https://img.shields.io/badge/GNOME-45%2B-success.svg)
[![GitHub Release](https://img.shields.io/github/v/release/comitanigiacomo/quicklaunch?include_prereleases&style=flat-square)](https://github.com/comitanigiacomo/quicklaunch/releases)

A lightweight and customizable dock integrated directly into the GNOME top panel. Quick Launch provides instant access to your frequently used applications and web links without requiring you to open the activities overview.

<p align="center">
  <img src="Screencast From 2025-04-26 15-01-20.gif" alt="Quick Launch Demo">
</p>

## Features

**Core Capabilities**
- Pin installed applications and web links directly to the top panel.
- Launch items instantly via mouse click or assigned keyboard shortcuts.
- Built-in search menu to find and pin applications on the fly.
- Full compatibility with native packages, Flatpaks, and custom `.desktop` files.
- Long-press to reorder pinned items intuitively.

**Customization**
- Position the dock on the Left, Center, or Right side of the top panel.
- Adjust icon size (16-24px) and spacing to match your desktop aesthetic.
- Toggle text labels for pinned items.
- Configure running application indicators with custom colors.

**System Integration**
- Define auto-start applications to launch automatically at login.
- Built on an event-driven architecture to minimize CPU and battery usage.
- Seamless state synchronization across sleep/wake cycles.
- Modern Libadwaita preferences window.
- Automatic cleanup of orphaned or uninstalled application entries.

## Installation

**GNOME Extensions (Recommended)**
Available directly on the [GNOME Extensions website](https://extensions.gnome.org/extension/8005/quick-launch/).
Toggle the switch to install.

**Manual Installation**
Clone the repository and copy the source files to your local extensions directory:
```bash
git clone https://github.com/comitanigiacomo/quicklaunch.git
cp -r quicklaunch/src ~/.local/share/gnome-shell/extensions/quicklaunch@comitanigiacomo.github.com
```
After copying the files, restart GNOME Shell (`Alt+F2`, type `r`, and press Enter on X11, or log out and log back in on Wayland) and enable the extension via the GNOME Extensions app.

## Planned Features

- Drag and drop support for icon rearrangement.
- Multi-monitor support.

## License

This project is licensed under the [GPL v3 License](https://www.gnu.org/licenses/gpl-3.0).

## Contributing

Bug reports and pull requests are welcome. Feel free to open an issue to discuss proposed changes or feature requests.
