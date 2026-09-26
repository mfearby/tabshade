const SETTINGS_KEY = "settings";

// Shared pure helpers (see lib/tabshade-core.js), loaded before this script.
const { normalizeLevel, normalizeSettings } = globalThis.TabShade;

/**
 * Get the currently active tab in the current window.
 */
async function getActiveTab() {
    const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    return tab;
}

/**
 * Log the error to the console.
 */
function reportError(error) {
    console.error(`Could not apply shader: ${error}`);
}

/**
 * Read the global settings (shade by default + default level) from storage.
 */
async function getSettings() {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(result[SETTINGS_KEY]);
}

/**
 * Apply the given theme ("light" or "dark") to the popup.
 */
function applyTheme(theme) {
    document.body.classList.toggle("dark", theme === "dark");
}

/**
 * Persist the global settings to storage. The content scripts pick up the
 * change via a storage listener and re-apply shading to open tabs.
 */
async function saveSettings(settings) {
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Send a message to the active tab's content script.
 */
async function messageActiveTab(message) {
    const tab = await getActiveTab();
    return browser.tabs.sendMessage(tab.id, message);
}

/**
 * Update a slider's position and its "%" label together.
 */
function setSlider(sliderId, valueId, level) {
    const slider = document.querySelector(`#${sliderId}`);
    const valueEl = document.querySelector(`#${valueId}`);
    if (slider) {
        slider.value = String(level);
    }
    if (valueEl) {
        valueEl.textContent = `${level}%`;
    }
}

/**
 * Enable or disable the default-level slider depending on whether shading by
 * default is switched on.
 */
function setDefaultSectionEnabled(enabled) {
    const section = document.querySelector("#default-section");
    const slider = document.querySelector("#default-level");
    const skipDark = document.querySelector("#skip-dark-sites");
    section.classList.toggle("disabled", !enabled);
    slider.disabled = !enabled;
    skipDark.disabled = !enabled;
}

/**
 * Wire up the "Shade by default" toggle and its default-level slider.
 */
function listenForDefaultControls() {
    const toggle = document.querySelector("#shade-by-default");
    const slider = document.querySelector("#default-level");

    toggle.addEventListener("change", async () => {
        const settings = await getSettings();
        settings.shadeByDefault = toggle.checked;
        setDefaultSectionEnabled(toggle.checked);
        await saveSettings(settings);
    });

    slider.addEventListener("input", async () => {
        const level = normalizeLevel(slider.value);
        setSlider("default-level", "default-level-value", level);
        const settings = await getSettings();
        settings.defaultLevel = level;
        await saveSettings(settings);
    });

    const skipDark = document.querySelector("#skip-dark-sites");
    skipDark.addEventListener("change", async () => {
        const settings = await getSettings();
        settings.skipDarkSites = skipDark.checked;
        await saveSettings(settings);
    });
}

/**
 * Wire up the per-site slider and the "Save this site's shade level" checkbox.
 * The slider always adjusts the current tab's level live; if the site is saved,
 * the content script's changeLevel persists the new level automatically. The
 * checkbox saves the current level for this site, or removes it when unchecked.
 */
function listenForSiteControls() {
    const checkbox = document.querySelector("#save-site");
    const slider = document.querySelector("#site-level");

    checkbox.addEventListener("change", async () => {
        try {
            if (checkbox.checked) {
                // Save the level currently shown on the slider.
                const level = normalizeLevel(slider.value);
                await messageActiveTab({ command: "saveSite", level });
            } else {
                await messageActiveTab({ command: "unsaveSite" });
            }
        } catch (error) {
            reportError(error);
        }
    });

    slider.addEventListener("input", async () => {
        const level = normalizeLevel(slider.value);
        setSlider("site-level", "site-level-value", level);
        try {
            if (checkbox.checked) {
                // Persist while saved.
                await messageActiveTab({ command: "saveSite", level });
            } else {
                // Preview live without saving.
                await messageActiveTab({ command: "changeLevel", level });
            }
        } catch (error) {
            reportError(error);
        }
    });
}

/**
 * Initialise the popup controls from stored settings and the active tab's
 * current state.
 */
async function initControls(tabId) {
    const settings = await getSettings();

    // Default section.
    document.querySelector("#shade-by-default").checked = settings.shadeByDefault;
    setSlider("default-level", "default-level-value", settings.defaultLevel);
    document.querySelector("#skip-dark-sites").checked = settings.skipDarkSites;
    setDefaultSectionEnabled(settings.shadeByDefault);

    // Site section, based on what the content script reports.
    const state = await browser.tabs.sendMessage(tabId, { command: "getState" });
    const saved = !!(state && state.saved);
    const currentLevel = state && typeof state.level === "number" ? state.level : 0;
    const siteLevel = saved ? normalizeLevel(state.savedLevel) : currentLevel;

    // Show a hint when this page is detected as already dark.
    const isDark = !!(state && state.isDark);
    document.querySelector("#dark-detected-hint").classList.toggle("hidden", !isDark);

    document.querySelector("#save-site").checked = saved;
    setSlider("site-level", "site-level-value", siteLevel);
}

/**
 * There was an error executing the script.
 * Display the popup's error message, and hide the normal UI.
 */
function reportExecuteScriptError(error) {
    document.querySelector("#popup-content").classList.add("hidden");
    document.querySelector("#error-content").classList.remove("hidden");
    console.error(`Failed to execute shader content script: ${error.message}`);
}

/**
 * When the popup loads, inject the content script into the active tab, wire up
 * the controls, and initialise them from stored settings and tab state.
 * If the extension couldn't inject the script, handle the error.
 */
(async function runOnPopupOpened() {
    // Apply the saved theme first so it shows even if shading isn't available.
    applyTheme((await getSettings()).theme);

    // The Preferences button works regardless of whether shading is available
    // on the current page, so wire it up before attempting script injection.
    document
        .querySelector("#open-preferences")
        .addEventListener("click", () => {
            browser.runtime.openOptionsPage();
            window.close();
        });

    // The Chrome build turns the shortcut hint into a link (Chrome can open
    // chrome://extensions/shortcuts via tabs.create). Firefox can't open
    // about:addons programmatically, so its hint stays as plain text and this
    // element is absent there.
    const shortcutLink = document.querySelector("#shortcut-link");
    if (shortcutLink) {
        shortcutLink.addEventListener("click", (event) => {
            event.preventDefault();
            const url = event.currentTarget.dataset.url;
            browser.tabs.create({ url });
            window.close();
        });
    }

    try {
        const tab = await getActiveTab();

        // Inject the shared core before the content script, since shader.js
        // reads globalThis.TabShade at the top. The manifest content_scripts
        // entry loads both on page load, but this programmatic injection (for
        // pages already open when the popup is first used) must include both.
        await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["/lib/tabshade-core.js", "/content_scripts/shader.js"],
        });

        listenForDefaultControls();
        listenForSiteControls();
        await initControls(tab.id);
    } catch (e) {
        reportExecuteScriptError(e);
    }
})();
