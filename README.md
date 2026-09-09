# TabShade

TabShade is a Firefox extension that shades the current browser tab to reduce
its brightness, making pages easier on the eyes in dark environments.

## Features

- **Adjustable shade level** — open the toolbar popup and use the slider to set
  how dark the current page is shaded, from 0% (off) up to 100%. The current
  level is shown next to the slider.
- **Toolbar badge** — the active tab's shade level is shown as a number on the
  TabShade toolbar icon, so you can see it at a glance without opening the popup.
- **Per-domain memory** — the shade level you choose is remembered per domain in
  local storage. When you load another tab on the same domain, TabShade applies
  the remembered level automatically.
- **Preferences page** — from the extension's preferences (about:addons →
  TabShade → Preferences) you can see every domain that has an automatic shade
  level, adjust each one, or remove it.
- **Keyboard shortcuts** — adjust the current tab without opening the popup:
  - `Alt+Shift+↑` — more dim (increase the shade level by 5%)
  - `Alt+Shift+↓` — less dim (decrease the shade level by 5%)
  - `Alt+Shift+D` — toggle shading on or off
  - Rebind these at about:addons → ⚙ → **Manage Extension Shortcuts**.

## How it works

- A content script injects a full-page overlay whose opacity corresponds to the
  chosen shade level.
- Shade levels are stored per domain using the WebExtensions `storage.local`
  API, so your choices persist across sessions and apply automatically on
  matching domains.
- A background script keeps the toolbar badge in sync with the active tab and
  handles the keyboard shortcuts.

## Installing for development

1. Open `about:debugging` in Firefox.
2. Choose **This Firefox**.
3. Click **Load Temporary Add-on** and select the `manifest.json` file in this
   repository.

## Icons

The icons used in this extension are from **IconBeast Lite**, available at
[IconBeast](https://www.iconbeast.com/free/).

This icon set came from IconBeast (https://www.iconbeast.com/). Per the
IconBeast Lite license, redistribution is permitted provided the source is
acknowledged and a link back to IconBeast is included, which this project does
here.

## License

This project is licensed under the GNU General Public License v3.0. See the
[LICENSE](LICENSE) file for details.
