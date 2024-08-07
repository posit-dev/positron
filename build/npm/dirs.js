/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('fs');

// Complete list of directories where yarn should be executed to install node modules
const dirs = [
	'',
	'build',
	'extensions',
	// --- Start Positron ---
	'extensions/open-remote-ssh',
	'extensions/positron-code-cells',
	'extensions/positron-connections',
	'extensions/positron-ipywidgets',
	'extensions/positron-javascript',
	'extensions/positron-notebook-controllers',
	'extensions/positron-notebooks',
	'extensions/positron-r',
	'extensions/positron-rstudio-keymap',
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
	// --- Start Positron ---
	'extensions/jupyter-adapter',
	// --- End Positron ---
	'extensions/markdown-language-features/server',
	'extensions/markdown-language-features',
	'extensions/markdown-math',
	'extensions/media-preview',
	'extensions/merge-conflict',
	'extensions/microsoft-authentication',
	'extensions/notebook-renderers',
	'extensions/npm',
	'extensions/php-language-features',
	'extensions/references-view',
	'extensions/search-result',
	'extensions/simple-browser',
	'extensions/tunnel-forwarding',
	'extensions/typescript-language-features',
	'extensions/vscode-api-tests',
	'extensions/vscode-colorize-tests',
	'extensions/vscode-test-resolver',
	'remote',
	'remote/web',
	// --- Start Positron
	'test/integration/browser',
	'test/monaco',
	// no need to compile smoke tests during release builds
	// 'test/automation',
	// 'test/smoke',
	// --- End Positron
	'.vscode/extensions/vscode-selfhost-test-provider',
];

if (fs.existsSync(`${__dirname}/../../.build/distro/npm`)) {
	dirs.push('.build/distro/npm');
	dirs.push('.build/distro/npm/remote');
	dirs.push('.build/distro/npm/remote/web');
}

exports.dirs = dirs;
