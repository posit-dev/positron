/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Hygiene works by creating cascading subsets of all our files and
 * passing them through a sequence of checks. Here are the current subsets,
 * named according to the checks performed on them. Each subset contains
 * the following one, as described in mathematical notation:
 *
 * all ⊃ eol ⊇ indentation ⊃ copyright ⊃ typescript
 */

export const all = Object.freeze<string[]>([
	'*',
	'build/**/*',
	'extensions/**/*',
	'scripts/**/*',
	'src/**/*',
	'test/**/*',
	'!cli/**/*',
	'!out*/**',
	'!extensions/**/out*/**',
	'!test/**/out/**',
	'!**/node_modules/**',
	'!**/*.js.map',

	// --- Start Positron ---
	// Excluded since it's generated code (an OpenAPI client)
	'!extensions/positron-supervisor/src/kcclient/**/*',

	// Excluded since it comes from an external source with its own hygiene
	// rules
	'!extensions/positron-python/**/*',

	// Excluded since it comes from an external source with its own hygiene
	'!src/esm-package-dependencies/**/*',

	// Excluded since it's third-party PDF.js distribution
	'!extensions/positron-pdf-server/pdfjs-dist/**/*',

	// Excluded since it isn't shipping code
	'!test/smoke/test-repo/**/*',
	'!test/e2e/test-repo/**/*',
	// --- End Positron ---
]);

export const unicodeFilter = Object.freeze<string[]>([
	'**',

	'!**/ThirdPartyNotices.txt',
	'!**/ThirdPartyNotices.cli.txt',
	'!**/LICENSE.{txt,rtf}',
	'!LICENSES.chromium.html',
	'!**/LICENSE',
	'!**/NOTICE',

	'!**/*.{dll,exe,png,bmp,jpg,scpt,cur,ttf,woff,eot,template,ico,icns,opus,wasm}',
	'!**/test/**',
	'!**/*.test.ts',
	'!**/*.{d.ts,json,md}',
	'!**/*.mp3',

	'!build/win32/**',
	'!extensions/markdown-language-features/notebook-out/*.js',
	'!extensions/markdown-math/notebook-out/**',
	'!extensions/mermaid-chat-features/chat-webview-out/**',
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
	'!extensions/terminal-suggest/src/shell/fishBuiltinsCache.ts',

	'!src/vs/base/browser/dompurify/**',
	'!src/vs/workbench/services/keybinding/browser/keyboardLayouts/**',
	'!src/vs/workbench/contrib/terminal/common/scripts/psreadline/**',

	// --- Start Positron ---
	'!scripts/positron/**/*',
	// --- End Positron ---
]);

export const indentationFilter = Object.freeze<string[]>([
	'**',

	// except specific files
	'!**/ThirdPartyNotices.txt',
	'!**/ThirdPartyNotices.cli.txt',
	'!**/LICENSE.{txt,rtf}',
	'!LICENSES.chromium.html',
	'!**/LICENSE',
	'!**/NOTICE',
	'!**/*.mp3',
	'!src/vs/loader.js',
	'!src/vs/base/browser/dompurify/*',
	'!src/vs/base/common/marked/marked.js',
	'!src/vs/base/common/semver/semver.js',
	'!src/vs/base/node/terminateProcess.sh',
	'!src/vs/base/node/cpuUsage.sh',
	'!src/vs/editor/common/languages/highlights/*.scm',
	'!src/vs/editor/common/languages/injections/*.scm',
	'!test/unit/assert.js',
	'!resources/linux/snap/electron-launch',
	'!build/ext.js',
	'!build/npm/gyp/patches/gyp_spectre_mitigation_support.patch',
	'!product.overrides.json',

	// except specific folders
	'!test/monaco/out/**',
	'!test/smoke/out/**',
	'!extensions/terminal-suggest/src/shell/zshBuiltinsCache.ts',
	'!extensions/terminal-suggest/src/shell/fishBuiltinsCache.ts',
	'!extensions/terminal-suggest/src/completions/upstream/**',
	'!extensions/typescript-language-features/test-workspace/**',
	'!extensions/typescript-language-features/resources/walkthroughs/**',
	'!extensions/typescript-language-features/package-manager/node-maintainer/**',
	'!extensions/markdown-math/notebook-out/**',
	'!extensions/ipynb/notebook-out/**',
	'!extensions/vscode-api-tests/testWorkspace/**',
	'!extensions/vscode-api-tests/testWorkspace2/**',
	'!build/monaco/**',
	'!build/win32/**',
	'!build/checker/**',
	'!src/vs/workbench/contrib/terminal/common/scripts/psreadline/**',

	// except multiple specific files
	'!**/package.json',
	'!**/package-lock.json',

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
	'!**/*.{svg,exe,png,bmp,jpg,scpt,bat,cmd,cur,ttf,woff,eot,md,ps1,psm1,template,yaml,yml,d.ts.recipe,ico,icns,plist,opus,admx,adml,wasm}',
	'!build/{lib,download,linux,darwin}/**/*.js',
	'!build/**/*.sh',
	'!build/azure-pipelines/**/*.js',
	'!build/azure-pipelines/**/*.config',
	'!build/npm/gyp/custom-headers/*.patch',
	'!**/Dockerfile',
	'!**/Dockerfile.*',
	'!**/*.Dockerfile',
	'!**/*.dockerfile',

	// except for built files
	'!extensions/mermaid-chat-features/chat-webview-out/*.js',
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
	// Excluded: contains HTML template with embedded CSS that uses space indentation
	'!test/e2e/tests/assistant-eval/evaluator/eval-results.ts',
	'!test/e2e/tests/assistant-eval/LLM_EVAL_TEST_CATALOG.html',
	// --- End Positron ---
]);

export const copyrightFilter = Object.freeze<string[]>([
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
	'!build/npm/gyp/custom-headers/*.patch',
	'!resources/linux/snap/snapcraft.yaml',
	'!resources/win32/bin/code.js',
	'!resources/completions/**',
	'!extensions/configuration-editing/build/inline-allOf.ts',
	'!extensions/markdown-language-features/media/highlight.css',
	'!extensions/markdown-math/notebook-out/**',
	'!extensions/ipynb/notebook-out/**',
	'!extensions/simple-browser/media/codicon.css',
	'!extensions/typescript-language-features/node-maintainer/**',
	'!extensions/html-language-features/server/src/modes/typescript/*',
	'!extensions/*/server/bin/*',
	'!src/vs/editor/test/node/classification/typescript-test.ts',
	'!src/vs/workbench/contrib/terminal/common/scripts/psreadline/**',

	// --- Start Positron ---
	'!extensions/positron-r/resources/testing/**',
	`!**/*.jsonl`,
	// --- End Positron ---
]);

export const tsFormattingFilter = Object.freeze<string[]>([
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
	'!extensions/terminal-suggest/src/shell/zshBuiltinsCache.ts',
	'!extensions/terminal-suggest/src/shell/fishBuiltinsCache.ts',
]);

export const eslintFilter = Object.freeze<string[]>([
	'**/*.js',
	'**/*.cjs',
	'**/*.mjs',
	'**/*.ts',
	// --- Start Positron ---
	'**/*.tsx',
	// --- End Positron ---
	'.eslint-plugin-local/**/*.ts',
	...readFileSync(join(import.meta.dirname, '..', '.eslint-ignore'))
		.toString()
		.split(/\r\n|\n/)
		.filter(line => line && !line.startsWith('#'))
		.map(line => line.startsWith('!') ? line.slice(1) : `!${line}`)
]);

export const stylelintFilter = Object.freeze<string[]>([
	'src/**/*.css'
]);
