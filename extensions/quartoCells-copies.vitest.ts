/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as path from 'path';

// A handful of modules are copied verbatim between positron-r and
// positron-python. Each pair below must stay identical modulo the one
// difference normalized away before comparing: the extensions indent
// differently, tabs against four spaces. Anything else is drift.
//
// Copied rather than shared because each extension needs a registry instance of
// its own; see the header of positron-r/src/quarto-cells.ts. Sharing is
// otherwise possible here, through a local `file:` package in the shape of
// extensions/positron-data-explorer-protocol.
//
// This is also what covers the Python copy's behaviour. Only the R copy has
// tests of its own; identical source plus this guard is what makes them hold
// for the Python one, without running a second, identical suite.
interface CopyPair {
	readonly label: string;
	readonly rCopy: string;
	readonly pythonCopy: string;
}

const PAIRS: readonly CopyPair[] = [
	{
		label: 'quarto-cells.ts / quartoCells.ts',
		rCopy: 'positron-r/src/quarto-cells.ts',
		pythonCopy: 'positron-python/src/client/positron/quartoCells.ts',
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
	it.each(PAIRS)('keeps the Python copy in step with the R copy: $label', ({ rCopy, pythonCopy }) => {
		expect(readWithWidenedTabs(pythonCopy)).toBe(readWithWidenedTabs(rCopy));
	});
});
