import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
	files: "out/test/**/*.test.js",
	// Disable other extensions during testing to avoid interference
	launchArgs: ["--disable-extensions", "--disable-workspace-trust"],
	// Retry failed tests once
	retries: 1,
});
