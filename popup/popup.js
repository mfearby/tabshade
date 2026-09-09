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
 * Update the label text to show the given shade level as a percentage.
 */
function setLabelValue(level) {
    const valueEl = document.querySelector("#shade-level-value");
    if (valueEl) {
        valueEl.textContent = `${level}%`;
    }
}

/**
 * Update the slider position and the label to reflect the given shade level.
 */
function setSliderValue(level) {
    const slider = document.querySelector("#shade-level");
    if (slider) {
        slider.value = String(level);
    }
    setLabelValue(level);
}

/**
 * Ask the content script for the level currently applied to the page and
 * update the slider to match.
 */
async function syncSliderFromPage(tabId) {
    try {
        const response = await browser.tabs.sendMessage(tabId, {
            command: "getLevel",
        });
        if (response && typeof response.level === "number") {
            // Reflect the level actually applied to the page: 0 when the page
            // is unshaded, or the remembered level when it is shaded.
            setSliderValue(response.level);
        }
    } catch (error) {
        reportError(error);
    }
}

/**
 * Listen for changes on the shade level slider and send the new level to the
 * content script, which applies it and remembers it for the current domain.
 */
function listenForSlider() {
    const slider = document.querySelector("#shade-level");
    if (!slider) {
        return;
    }
    slider.addEventListener("input", async (e) => {
        const level = Number(e.target.value);
        setLabelValue(level);
        try {
            const tab = await getActiveTab();
            await browser.tabs.sendMessage(tab.id, {
                command: "setLevel",
                level,
            });
        } catch (error) {
            reportError(error);
        }
    });
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
 * When the popup loads, inject a content script into the active tab, wire up
 * the controls, and sync the slider to the page's current shade level.
 * If the extension couldn't inject the script, handle the error.
 */
(async function runOnPopupOpened() {
    try {
        const tab = await getActiveTab();

        await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["/content_scripts/shader.js"],
        });

        listenForSlider();
        await syncSliderFromPage(tab.id);
    } catch (e) {
        reportExecuteScriptError(e);
    }
})();
