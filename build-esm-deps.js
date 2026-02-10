/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import esbuild from 'esbuild';
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const require = createRequire(import.meta.url);

const outdir = 'src/esm-package-dependencies';

const entryPoints = ['he', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'react-window', 'scheduler'];

// Bundle all entry points together with splitting enabled. This
// deduplicates shared dependencies (like React) into shared chunks
// so every package uses the same instance.
await esbuild.build({
	entryPoints,
	bundle: true,
	format: 'esm',
	outdir,
	minify: true,
	splitting: true,
});

// Post-process: add named exports for CJS packages that esbuild wraps
// with only a default export. ESM-native packages (like react-window)
// already have named exports and are skipped.
for (const entry of entryPoints) {
	const outFile = join(outdir, entry + '.js');
	const content = readFileSync(outFile, 'utf8');

	// Skip if the file already has named exports.
	if (/export\s*\{/.test(content)) {
		continue;
	}

	// Get the CJS module's export keys.
	const mod = require(entry);
	const keys = Object.keys(mod).filter(k => k !== 'default' && k !== '__esModule');

	if (keys.length > 0) {
		// Replace `export default <expr>;` with named re-exports derived
		// from the default export object.
		const namedExports = `export var {${keys.join(',')}}=_mod;`;
		const newContent = content.replace(
			/export default ([^;]+);/,
			`var _mod=$1;export default _mod;${namedExports}`
		);
		writeFileSync(outFile, newContent);
	}
}
