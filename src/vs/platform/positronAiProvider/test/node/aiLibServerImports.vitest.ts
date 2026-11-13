/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from '../../../../base/common/path.js';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

const AI_LIB_PACKAGE = /^(ai-provider-bridge|ai-config|ai-credentials)(\/|$)/;
const SKIPPED_FILE = /\.(vitest\.tsx?|test\.ts|d\.ts)$/;

interface IAiLibImport {
	file: string;
	specifier: string;
}

function* walk(dir: string): Generator<string> {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules') {
			continue;
		}
		const entryPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walk(entryPath);
		} else if (entry.name.endsWith('.ts') && !SKIPPED_FILE.test(entry.name)) {
			yield entryPath;
		}
	}
}

/**
 * Finds the ai-lib specifiers a file loads at runtime. Skips `import type`
 * statements and `typeof import(...)` type positions. Matches import
 * specifiers only, so comments and HTML that mention a package do not count.
 */
function findValueSpecifiers(contents: string): string[] {
	const specifiers: string[] = [];
	const staticImport = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;'"]*?\bfrom\s+['"]([^'"]+)['"]/g;
	for (const match of contents.matchAll(staticImport)) {
		if (!match[1]) {
			specifiers.push(match[2]);
		}
	}
	const sideEffectImport = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
	for (const match of contents.matchAll(sideEffectImport)) {
		specifiers.push(match[1]);
	}
	const dynamicImport = /(typeof\s+)?\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
	for (const match of contents.matchAll(dynamicImport)) {
		if (!match[1]) {
			specifiers.push(match[2]);
		}
	}
	return specifiers.filter(specifier => AI_LIB_PACKAGE.test(specifier));
}

function collectAiLibImports(): IAiLibImport[] {
	const found = new Map<string, IAiLibImport>();
	for (const filePath of walk(SRC_ROOT)) {
		const file = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
		for (const specifier of findValueSpecifiers(fs.readFileSync(filePath, 'utf8'))) {
			found.set(`${file}\0${specifier}`, { file, specifier });
		}
	}
	return [...found.values()].sort((a, b) =>
		a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier));
}

describe('ai-lib imports in src', () => {
	it('src imports only these ai-lib value entries', () => {
		// A new server-side entry also needs a new entry point in
		// build/lib/ai-lib-server-bundle.ts, because the server bundle exports
		// only './headless'. The workbench entry is bundled separately and is
		// not served from the server's node_modules.
		expect(collectAiLibImports()).toEqual([
			{
				file: 'src/vs/platform/positronHeadlessLanguageModel/node/headlessProviderModule.ts',
				specifier: 'ai-provider-bridge/headless',
			},
			{
				file: 'src/vs/workbench/contrib/positronAssistant/common/legacyCredentialCopy.ts',
				specifier: 'ai-credentials/types',
			},
		]);
	});
});
