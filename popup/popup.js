const STORAGE_KEY = "shadedDomains";
const SETTINGS_KEY = "settings";

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
 * Clamp a shade level to the valid 0-100 range and coerce it to a number.
 */
function normalizeLevel(level) {
    const n = Number(level);
    if (!Number.isFinite(n)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Read the global settings (shade by default + default level) from storage.
 */
async function getSettings() {
    const result = await browser.storage.local.get(SETTINGS_KEY);
    const stored = result[SETTINGS_KEY];
    return {
        shadeByDefault: !!(stored && stored.shadeByDefault),
        defaultLevel: normalizeLevel(stored && stored.defaultLevel),
    };
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
    section.classList.toggle("disabled", !enabled);
    slider.disabled = !enabled;
}

/**
 * Show or hide the per-site slider based on the "save this site" checkbox.
 */
function setSiteSliderVisible(visible) {
    document.querySelector("#site-level-wrap").classList.toggle("hidden", !visible);
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
}

/**
 * Wire up the "Save this site's shade level" checkbox and the per-site slider.
 */
function listenForSiteControls() {
    const checkbox = document.querySelector("#save-site");
    const slider = document.querySelector("#site-level");

    checkbox.addEventListener("change", async () => {
        setSiteSliderVisible(checkbox.checked);
        try {
            if (checkbox.checked) {
                // Save the level currently in effect for this tab.
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
            await messageActiveTab({ command: "saveSite", level });
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
    setDefaultSectionEnabled(settings.shadeByDefault);

    // Site section, based on what the content script reports.
    const state = await browser.tabs.sendMessage(tabId, { command: "getState" });
    const saved = !!(state && state.saved);
    const currentLevel = state && typeof state.level === "number" ? state.level : 0;
    const siteLevel = saved ? normalizeLevel(state.savedLevel) : currentLevel;

    document.querySelector("#save-site").checked = saved;
    setSiteSliderVisible(saved);
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
    try {
        const tab = await getActiveTab();

        await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["/content_scripts/shader.js"],
        });

        listenForDefaultControls();
        listenForSiteControls();
        await initControls(tab.id);
    } catch (e) {
        reportExecuteScriptError(e);
    }
})();
