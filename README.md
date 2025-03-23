# Quick Launch GNOME Extension 🚀

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
![GNOME Version](https://img.shields.io/badge/GNOME-45%2B-success.svg)
[![GitHub Release](https://img.shields.io/github/v/release/your-username/quicklaunch?include_prereleases&style=flat-square)](https://github.com/your-username/quicklaunch/releases)

**Quick Launch** turns your GNOME top panel into a powerful and intuitive application launcher. Keep your favorite apps just one click away with this lightweight extension designed to enhance your GNOME experience.

![Quick Launch in Action](images/image.png)


## ✨ Key Features

### ✅ Current Features
- **Visual application pinning**: *directly from the GNOME app menu*
- **Integrated GUI**: *for managing shortcuts and pinned apps*
- **Instant search**: *across installed applications*
- **Automatic settings reload**: *after any changes made*
- **Customizable icon size**: *Adjust the size of icons to your preference*

### 🚧 Upcoming Features
- **Drag & drop support**: *for icon rearrangement*
- **Advanced customization options**: *(spacing, etc.)*
- **Support for custom launchers**: *(URLs, terminal commands)*
- **Alternative icon themes**
- **Multi-monitor support**

## 📥 Installation

### Via GNOME Extensions Marketplace (Recommended)
1. Visit [Quick Launch GNOME Extension Page](https://extensions.gnome.org/extension/8005/quick-launch/).
2. Toggle the switch to install the extension.
3. Press **Alt+F2**, type `r`, and press Enter to reload GNOME Shell.

### Manual Installation (for advanced users)
If you prefer to install the extension manually, follow these steps:

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/quicklaunch.git
   cd quicklaunch
   ```
2. Build the extension using **Meson** and **Ninja**:
    ```bash
    meson build
    ninja -C build
    ```
3. Install the extension:
     ```bash
     ninja -C build install
    ```
4. Enable the extension via GNOME Tweaks or the Extensions app.

    >You may need to restart GNOME Shell (`Alt`+`F2`, then type `r`).

## 💡 Usage

Once installed, you can access the Quick Launch panel from your GNOME top bar. Pin your favorite apps and launch them instantly with a single click. To configure settings, use the integrated GUI accessible from the GNOME Extensions app.

## 📄 License

This extension is licensed under the [GPL v3 License](https://www.gnu.org/licenses/gpl-3.0).


## 💬 Contributing

Contributions are welcome! If you encounter any bugs or have feature requests, feel free to open an issue or submit a pull request.