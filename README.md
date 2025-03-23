# Quick Launch GNOME Extension 🚀

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![GNOME Version](https://img.shields.io/badge/GNOME-45%2B-success.svg)
[![GitHub Release](https://img.shields.io/github/v/release/your-username/quicklaunch?include_prereleases&style=flat-square)](https://github.com/your-username/quicklaunch/releases)

**Transform your GNOME top panel into a powerful application launcher**  
Keep your favorite apps always one click away with this lightweight and intuitive extension.

![Quick Launch in Action](image.png)

![Quick Launch in Action](image-2.png)

## ✨ Key Features

### ✅ Current Features
- **Visual application pinning** directly from GNOME app menu
- **Integrated GUI** for managing shortcuts
- **Instant search** across installed applications
- **Automatic settings reload** after changes

### 🚧 Upcoming Features
- Drag & drop icon rearrangement
- Advanced customization (icon sizes, spacing)
- Support for custom launchers (URLs, terminal commands)
- Alternative icon themes
- Multi-monitor support

## 📥 Installation

### Via GNOME Extensions Marketplace (Recommended)
1. Visit [extensions.gnome.org/extension/XXXX/quick-launch](https://extensions.gnome.org/extension/XXXX/quick-launch)
2. Toggle the switch to install
3. Refresh GNOME Shell (`Alt+F2` then `r`)

### Manual Installation
```bash
git clone https://github.com/your-username/quicklaunch.git
cd quicklaunch
meson build && ninja -C build
ninja -C build install
```