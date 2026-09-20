/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';

// Extensions cannot share source, so a handful of modules are copied verbatim
// between positron-r and positron-python. Each pair below must stay identical
// modulo two differences that are normalized away before comparing: the
// extensions indent differently (tabs, four spaces), and each vitest copy
// imports its own extension's registry module under that extension's file name.
// Anything else that differs is drift.
interface CopyPair {
	readonly label: string;
	readonly rCopy: string;
	readonly pythonCopy: string;
	readonly normalizePython?: (content: string) => string;
}

const PAIRS: readonly CopyPair[] = [
	{
		label: 'quarto-cells.ts / quartoCells.ts',
		rCopy: 'positron-r/src/quarto-cells.ts',
		pythonCopy: 'positron-python/src/client/positron/quartoCells.ts',
	},
	{
		label: 'quarto-cells.vitest.ts / quartoCells.vitest.ts',
		rCopy: 'positron-r/src/quarto-cells.vitest.ts',
		pythonCopy: 'positron-python/src/client/positron/quartoCells.vitest.ts',
		normalizePython: content => content.replace("from './quartoCells'", "from './quarto-cells'"),
	},
];

// `__dirname` is this file's own directory (`extensions/`), so the paths hold
// wherever Vitest is started from.
function readWithWidenedTabs(relativePath: string): string {
	return fs.readFileSync(path.join(__dirname, relativePath), 'utf8')
		.split('\n')
		.map(line => line.replace(/^\t+/, tabs => '    '.repeat(tabs.length)))
		.join('\n');
}

describe('quartoCells copies', () => {
	it.each(PAIRS)('keeps the Python copy in step with the R copy: $label', ({ rCopy, pythonCopy, normalizePython }) => {
		const python = readWithWidenedTabs(pythonCopy);
		expect(normalizePython ? normalizePython(python) : python).toBe(readWithWidenedTabs(rCopy));
	});
});
