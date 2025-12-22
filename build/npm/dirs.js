/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');
const path = require('path');

// Complete list of directories where npm should be executed to install node modules
let dirs = [
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
	'extensions/positron-dev-containers',
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

// --- Start Positron ---
// CI Cache optimization: Support filtered installation based on change frequency
// This enables split caching strategy where volatile extensions (that change frequently)
// can be cached separately from stable extensions (that change rarely).
//
// DEPENDENCY ISOLATION:
// Each extension has its own package.json and node_modules/ directory.
// Volatile and stable extensions have zero shared dependencies (except parent-level
// devDependencies like esbuild). This means:
//   - Caching volatile separately does NOT affect stable extensions
//   - npm ci in one extension cannot corrupt another
//   - Cache invalidation is fully independent
//
// Volatile extensions: Change frequently (71% of extension commits over 6 months)
// THIS IS THE SINGLE SOURCE OF TRUTH for volatile extension list
const volatileExtensions = [
	'extensions/positron-python',
	'extensions/positron-assistant',
	'extensions/positron-r'
];

// Usage: Set POSITRON_EXTENSIONS_FILTER=volatile|stable to install subset
//   - volatile: Install only frequently-changed extensions (python, assistant, r)
//   - stable: Install all other extensions
//   - unset/empty: Install all extensions (default behavior)
const POSITRON_EXTENSIONS_FILTER = process.env.POSITRON_EXTENSIONS_FILTER;

if (POSITRON_EXTENSIONS_FILTER) {

	if (POSITRON_EXTENSIONS_FILTER === 'volatile') {
		// allow-any-unicode-next-line
		console.log('🔥 Installing volatile extensions only (python, assistant, r)');
		// Keep base dirs + volatile extensions
		//
		// OPTIMIZATION: Skip reinstalling extensions/node_modules if it already exists
		//
		// This branch only executes when the stable extensions cache had an EXACT key match
		// (cache-hit = 'true' in GitHub Actions). An exact match guarantees that:
		//   1. extensions/package.json hasn't changed (it's part of the cache key hash)
		//   2. extensions/node_modules is valid for the current extensions/package.json
		//   3. Safe to skip reinstalling to avoid wasteful delete/recreate cycle
		//
		// SAFETY: Partial cache hits via restore-keys return cache-hit = 'false', which
		// sets POSITRON_EXTENSIONS_FILTER = '' (empty), causing full reinstall of all
		// directories including extensions/. No stale dependencies can occur.
		const extensionsNodeModulesPath = path.join(__dirname, '../../extensions/node_modules');
		const extensionsNodeModulesExists = fs.existsSync(extensionsNodeModulesPath);

		if (extensionsNodeModulesExists) {
			console.log('  → Skipping extensions/ directory (node_modules already exists)');
			const baseDirs = dirs.filter(d => !d.startsWith('extensions/') && d !== 'extensions');
			dirs = [...baseDirs, ...volatileExtensions];
		} else {
			const baseDirs = dirs.filter(d => !d.startsWith('extensions/') || d === 'extensions');
			dirs = [...baseDirs, ...volatileExtensions];
		}
	} else if (POSITRON_EXTENSIONS_FILTER === 'stable') {
		// allow-any-unicode-next-line
		console.log('🧊 Installing stable extensions only (all except python, assistant, r)');
		// Keep base dirs + parent 'extensions' + stable extensions
		const allExtensions = dirs.filter(d => d.startsWith('extensions/') && d !== 'extensions');
		const stableExtensions = allExtensions.filter(d => !volatileExtensions.includes(d));
		const baseDirs = dirs.filter(d => !d.startsWith('extensions/') || d === 'extensions');
		dirs = [...baseDirs, ...stableExtensions];
	}
}

exports.volatileExtensions = volatileExtensions;
// --- End Positron ---

exports.dirs = dirs;
