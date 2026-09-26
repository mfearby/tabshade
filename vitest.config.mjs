import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // The core logic is pure JS with no DOM/browser dependency, so the
        // lightweight Node environment is all the tests need.
        environment: "node",
        include: ["test/**/*.test.js"],
    },
});
