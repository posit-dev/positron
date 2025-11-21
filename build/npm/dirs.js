/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');

// Complete list of directories where npm should be executed to install node modules
const dirs = [
	'',
	'build',
	'extensions',
	// --- Start Positron ---
	'extensions/open-remote-ssh',
	'extensions/positron-assistant',
	'extensions/positron-catalog-explorer',
	'extensions/positron-code-cells',
	'extensions/positron-copilot-chat',
	'extensions/positron-connections',
	'extensions/positron-duckdb',
	'extensions/positron-environment',
	'extensions/positron-ipywidgets',
	'extensions/positron-javascript',
	'extensions/positron-notebooks',
	'extensions/positron-r',
	'extensions/positron-reticulate',
	'extensions/positron-run-app',
	'extensions/positron-runtime-debugger',
	'extensions/positron-supervisor',
	'extensions/positron-python',
	'extensions/positron-proxy',
	'extensions/positron-viewer',
	'extensions/positron-zed',
	// --- End Positron ---
	'extensions/configuration-editing',
	'extensions/css-language-features',
	'extensions/css-language-features/server',
	'extensions/debug-auto-launch',
	'extensions/debug-server-ready',
	'extensions/emmet',
	'extensions/extension-editing',
	'extensions/git',
	'extensions/git-base',
	'extensions/github',
	'extensions/github-authentication',
	'extensions/grunt',
	'extensions/gulp',
	'extensions/html-language-features',
	'extensions/html-language-features/server',
	'extensions/ipynb',
	'extensions/jake',
	'extensions/json-language-features',
	'extensions/json-language-features/server',
	'extensions/markdown-language-features',
	'extensions/markdown-math',
	'extensions/media-preview',
	'extensions/merge-conflict',
	'extensions/mermaid-chat-features',
	'extensions/microsoft-authentication',
	'extensions/notebook-renderers',
	'extensions/npm',
	'extensions/php-language-features',
	'extensions/references-view',
	'extensions/search-result',
	'extensions/simple-browser',
	'extensions/tunnel-forwarding',
	'extensions/terminal-suggest',
	'extensions/typescript-language-features',
	'extensions/vscode-api-tests',
	'extensions/vscode-colorize-tests',
	'extensions/vscode-colorize-perf-tests',
	'extensions/vscode-test-resolver',
	'remote',
	'remote/web',
	// --- Start Positron ---
	// Note: 'remote/reh-web' must be declared AFTER 'build' for the postinstall script to work.
	'remote/reh-web',
	'test/integration/browser',
	'test/monaco',
	'test/mcp', // TODO 1.104.0 do we remove this?
	// We've removed these test folders
	// 'test/automation',
	// 'test/smoke',

	// no need to compile e2e tests during release builds
	// 'test/e2e',
	// --- End Positron ---
	'.vscode/extensions/vscode-selfhost-import-aid',
	'.vscode/extensions/vscode-selfhost-test-provider',
];

// --- Start Positron ---
// Add the open-remote-wsl extension on Windows
if (process.platform === 'win32') {
	dirs.push('extensions/open-remote-wsl');
}
// --- End Positron ---

if (fs.existsSync(`${__dirname}/../../.build/distro/npm`)) {
	dirs.push('.build/distro/npm');
	dirs.push('.build/distro/npm/remote');
	dirs.push('.build/distro/npm/remote/web');
}

exports.dirs = dirs;
