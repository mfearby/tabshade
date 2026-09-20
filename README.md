# TabShade

TabShade is a Firefox extension that shades the current browser tab to reduce
its brightness, making pages easier on the eyes in dark environments.

## Features

- **Shade by default** — turn on "Shade by default" in the toolbar popup and
  choose a default level. Every site is then shaded to that level automatically,
  without cluttering your saved-sites list.
- **Save this site's shade level** — for sites you want to treat specially,
  tick "Save this site's shade level" in the popup and set a level with the
  slider. Only saved sites are remembered per domain and shown on the
  preferences page. This keeps the list free of sites you visited only once.
- **Toolbar badge** — the active tab's shade level is shown as a number on the
  TabShade toolbar icon, so you can see it at a glance without opening the popup.
- **Preferences page** — from the extension's preferences (about:addons →
  TabShade → Preferences) you can see every domain you have saved a shade level
  for, adjust each one, or remove it.
- **Keyboard shortcuts** — adjust the current tab without opening the popup:
  - `Alt+Shift+↑` — more dim (increase the shade level by 5%)
  - `Alt+Shift+↓` — less dim (decrease the shade level by 5%)
  - `Alt+Shift+D` — toggle shading on or off
  - Rebind these at about:addons → ⚙ → **Manage Extension Shortcuts**.

## How it works

- A content script injects a full-page overlay whose opacity corresponds to the
  shade level in effect.
- On page load the level is resolved in this order: a saved level for the
  domain takes precedence, otherwise the global default (when "Shade by default"
  is on), otherwise no shading.
- Settings and saved sites are stored with the WebExtensions `storage.local`
  API, so your choices persist across sessions. Only sites you explicitly save
  are remembered per domain.
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

## Built with Kiro

This extension was built with the help of [Kiro](https://kiro.dev), an
AI-powered development environment.

## License

This project is licensed under the GNU General Public License v3.0. See the
[LICENSE](LICENSE) file for details.
