/**
 * Listen for clicks on the buttons, and send the appropriate message to the content script in the page.
 */
function listenForClicks() {
    document.addEventListener("click", async (e) => {
        /**
         * Log the error to the console.
         */
        function reportError(error) {
            console.error(`Could not apply shader: ${error}`);
        }

        if (e.target.tagName !== "BUTTON" || !e.target.closest("#popup-content")) {
            // Ignore when click is not on a button within <div id="popup-content">.
            return;
        }

        /**
         * Get the active tab,
         * then call the appropriate method.
         */
        try {
            const [tab] = await browser.tabs.query({
                active: true,
                currentWindow: true,
            });

            if (e.target.id === "overlay-toggle") {
                await browser.tabs.sendMessage(tab.id, { command: "toggleOverlay" });
            }
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
 * When the popup loads, inject a content script into the active tab and add a click handler.
 * If the extension couldn't inject the script, handle the error.
 */
(async function runOnPopupOpened() {
    try {
        const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
        });

        await browser.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["/content_scripts/shader.js"],
        });
        listenForClicks();
    } catch (e) {
        reportExecuteScriptError(e);
    }
})();