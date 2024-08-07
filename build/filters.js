/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Hygiene works by creating cascading subsets of all our files and
 * passing them through a sequence of checks. Here are the current subsets,
 * named according to the checks performed on them. Each subset contains
 * the following one, as described in mathematical notation:
 *
 * all ⊃ eol ⊇ indentation ⊃ copyright ⊃ typescript
 */

const { readFileSync } = require('fs');
const { join } = require('path');

module.exports.all = [
	'*',
	'build/**/*',
	'extensions/**/*',
	'scripts/**/*',
	'src/**/*',
	'test/**/*',
	'!cli/**/*',
	'!out*/**',
	'!test/**/out/**',
	'!**/node_modules/**',

	// --- Start Positron ---
	'!extensions/positron-python/**/*',
	'!extensions/open-remote-ssh/**/*',
	'!test/smoke/test-repo/**/*'
	// --- End Positron ---
];

module.exports.unicodeFilter = [
	'**',

	'!**/ThirdPartyNotices.txt',
	'!**/ThirdPartyNotices.cli.txt',
	'!**/LICENSE.{txt,rtf}',
	'!LICENSES.chromium.html',
	'!**/LICENSE',

	'!**/*.{dll,exe,png,bmp,jpg,scpt,cur,ttf,woff,eot,template,ico,icns,opus,wasm}',
	'!**/test/**',
	'!**/*.test.ts',
	'!**/*.{d.ts,json,md}',
	'!**/*.mp3',

	'!build/win32/**',
	'!extensions/markdown-language-features/notebook-out/*.js',
	'!extensions/markdown-math/notebook-out/**',
	'!extensions/ipynb/notebook-out/**',
	'!extensions/notebook-renderers/renderer-out/**',
	'!extensions/php-language-features/src/features/phpGlobalFunctions.ts',
	'!extensions/typescript-language-features/test-workspace/**',
	'!extensions/vscode-api-tests/testWorkspace/**',
	'!extensions/vscode-api-tests/testWorkspace2/**',
	'!extensions/**/dist/**',
	'!extensions/**/out/**',
	'!extensions/**/snippets/**',
	'!extensions/**/colorize-fixtures/**',

	'!src/vs/base/browser/dompurify/**',
	'!src/vs/workbench/services/keybinding/browser/keyboardLayouts/**',

	// --- Start Positron ---
	'!scripts/positron/**/*',
	// --- End Positron ---
];

module.exports.indentationFilter = [
	'**',

	// except specific files
	'!**/ThirdPartyNotices.txt',
	'!**/ThirdPartyNotices.cli.txt',
	'!**/LICENSE.{txt,rtf}',
	'!LICENSES.chromium.html',
	'!**/LICENSE',
	'!**/*.mp3',
	'!src/vs/loader.js',
	'!src/vs/base/browser/dompurify/*',
	'!src/vs/base/common/marked/marked.js',
	'!src/vs/base/common/semver/semver.js',
	'!src/vs/base/node/terminateProcess.sh',
	'!src/vs/base/node/cpuUsage.sh',
	'!test/unit/assert.js',
	'!resources/linux/snap/electron-launch',
	'!build/ext.js',
	'!build/npm/gyp/patches/gyp_spectre_mitigation_support.patch',
	'!product.overrides.json',

	// except specific folders
	'!test/automation/out/**',
	'!test/monaco/out/**',
	'!test/smoke/out/**',
	'!extensions/typescript-language-features/test-workspace/**',
	'!extensions/typescript-language-features/resources/walkthroughs/**',
	'!extensions/typescript-language-features/package-manager/node-maintainer/**',
	'!extensions/markdown-math/notebook-out/**',
	'!extensions/ipynb/notebook-out/**',
	'!extensions/vscode-api-tests/testWorkspace/**',
	'!extensions/vscode-api-tests/testWorkspace2/**',
	'!build/monaco/**',
	'!build/win32/**',

	// except multiple specific files
	'!**/package.json',
	'!**/yarn.lock',
	'!**/yarn-error.log',

	// except multiple specific folders
	'!**/codicon/**',
	'!**/fixtures/**',
	'!**/lib/**',
	'!extensions/**/dist/**',
	'!extensions/**/out/**',
	'!extensions/**/snippets/**',
	'!extensions/**/syntaxes/**',
	'!extensions/**/themes/**',
	'!extensions/**/colorize-fixtures/**',

	// except specific file types
	'!src/vs/*/**/*.d.ts',
	'!src/typings/**/*.d.ts',
	'!extensions/**/*.d.ts',
	'!**/*.{svg,exe,png,bmp,jpg,scpt,bat,cmd,cur,ttf,woff,eot,md,ps1,template,yaml,yml,d.ts.recipe,ico,icns,plist,opus,admx,adml,wasm}',
	'!build/{lib,download,linux,darwin}/**/*.js',
	'!build/**/*.sh',
	'!build/azure-pipelines/**/*.js',
	'!build/azure-pipelines/**/*.config',
	'!**/Dockerfile',
	'!**/Dockerfile.*',
	'!**/*.Dockerfile',
	'!**/*.dockerfile',

	// except for built files
	'!extensions/markdown-language-features/media/*.js',
	'!extensions/markdown-language-features/notebook-out/*.js',
	'!extensions/markdown-math/notebook-out/*.js',
	'!extensions/ipynb/notebook-out/**',
	'!extensions/notebook-renderers/renderer-out/*.js',
	'!extensions/simple-browser/media/*.js',

	// --- Start Positron ---
	'!src/react.js',
	'!src/react-dom.js',
	// --- End Positron ---

	// --- Start Positron ---
	'!extensions/positron-r/resources/scripts/*.R',
	'!extensions/positron-r/resources/testing/**',
	'!scripts/positron/**/*',
	'!extensions/positron-r/src/test/snapshots/*.R',
	// --- End Positron ---
];

module.exports.copyrightFilter = [
	'**',
	'!**/*.desktop',
	'!**/*.json',
	'!**/*.html',
	'!**/*.template',
	'!**/*.md',
	'!**/*.bat',
	'!**/*.cmd',
	'!**/*.ico',
	'!**/*.opus',
	'!**/*.mp3',
	'!**/*.icns',
	'!**/*.xml',
	'!**/*.sh',
	'!**/*.zsh',
	'!**/*.fish',
	'!**/*.txt',
	'!**/*.xpm',
	'!**/*.opts',
	'!**/*.disabled',
	'!**/*.code-workspace',
	'!**/*.js.map',
	'!**/*.wasm',
	'!build/**/*.init',
	'!build/linux/libcxx-fetcher.*',
	'!resources/linux/snap/snapcraft.yaml',
	'!resources/win32/bin/code.js',
	'!resources/completions/**',
	'!extensions/configuration-editing/build/inline-allOf.ts',
	'!extensions/markdown-language-features/media/highlight.css',
	'!extensions/markdown-math/notebook-out/**',
	'!extensions/ipynb/notebook-out/**',
	'!extensions/typescript-language-features/node-maintainer/**',
	'!extensions/html-language-features/server/src/modes/typescript/*',
	'!extensions/*/server/bin/*',
	'!src/vs/editor/test/node/classification/typescript-test.ts',

	// --- Start Positron ---
	'!extensions/positron-r/resources/testing/**',
	// --- End Positron ---
];

module.exports.tsFormattingFilter = [
	'src/**/*.ts',
	// --- Start Positron ---
	'src/**/*.tsx',
	// --- End Positron ---
	'test/**/*.ts',
	'extensions/**/*.ts',
	'!src/vs/*/**/*.d.ts',
	'!src/typings/**/*.d.ts',
	'!extensions/**/*.d.ts',
	'!**/fixtures/**',
	'!**/typings/**',
	'!**/node_modules/**',
	'!extensions/**/colorize-fixtures/**',
	'!extensions/vscode-api-tests/testWorkspace/**',
	'!extensions/vscode-api-tests/testWorkspace2/**',
	'!extensions/**/*.test.ts',
	'!extensions/html-language-features/server/lib/jquery.d.ts',
];

module.exports.eslintFilter = [
	'**/*.js',
	'**/*.ts',
	// --- Start Positron ---
	'**/*.tsx',
	// --- End Positron ---
	...readFileSync(join(__dirname, '../.eslintignore'))
		.toString().split(/\r\n|\n/)
		.filter(line => !line.startsWith('#'))
		.filter(line => !!line)
		.map(line => `!${line}`)
];

module.exports.stylelintFilter = [
	'src/**/*.css'
];
