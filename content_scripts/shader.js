(function () {
    /**
     * Check and set a global guard variable to ensure that if this content
     * script is injected into a page again, it returns (and does nothing).
     */
    if (window.hasRun) {
        return;
    }
    window.hasRun = true;

    const OVERLAY_ID = "tabshade-overlay";

    /**
     * Toggle a full-page black overlay that does not receive mouse clicks.
     * If the overlay exists, remove it; otherwise create and insert it.
     */
    function toggleOverlay() {
        const existingOverlay = document.getElementById(OVERLAY_ID);
        if (existingOverlay) {
            existingOverlay.remove();
            return;
        }
        let overlay = document.createElement("div");
        overlay.id = OVERLAY_ID;
        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.backgroundColor = "rgba(0, 0, 0, 0.3)";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "2147483647";
        document.body.appendChild(overlay);
    }

    /**
     * Listen for messages from the background script.
     */
    browser.runtime.onMessage.addListener((message) => {
        if (message.command === "toggleOverlay") {
            toggleOverlay();
        }
    });
})();