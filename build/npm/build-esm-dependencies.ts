/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import esbuild from 'esbuild';

/**
 * Build ESM dependencies. This is necessary because some dependencies (e.g. React) are
 * only published as CommonJS and need to be bundled into ESM for use.
 */
export function buildESMDependencies(outdir: string = 'out/esm-package-dependencies') {
	const entryPoints = ['he', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'react-window', 'scheduler'];

	console.log(`Building ESM dependencies to ${outdir}...`);

	// Bundle with esbuild.
	esbuild.buildSync({
		entryPoints,
		bundle: true,
		format: 'esm',
		outdir,
		minify: true,
		splitting: true,
	});

	// Post-process: Replace default-only exports with named + default exports.
	const exportMap: Record<string, string[]> = {
		'he': ['decode', 'encode', 'escape', 'unescape'],
		'react/jsx-runtime': ['jsx', 'jsxs', 'Fragment'],
		'react': ['Component', 'PureComponent', 'Fragment', 'StrictMode', 'Suspense',
			'useState', 'useEffect', 'useContext', 'useReducer', 'useCallback',
			'useMemo', 'useRef', 'useImperativeHandle', 'useLayoutEffect', 'useDebugValue',
			'createElement', 'createContext', 'forwardRef', 'memo', 'lazy'],
		'react-dom/client': ['createRoot', 'hydrateRoot'],
		'react-dom': ['render', 'hydrate', 'unmountComponentAtNode', 'findDOMNode', 'createPortal', 'flushSync'],
		'react-window': ['FixedSizeList', 'VariableSizeList', 'FixedSizeGrid', 'VariableSizeGrid'],
	};

	for (const [entry, exportNames] of Object.entries(exportMap)) {
		const outputPath = path.join(outdir, entry + '.js');
		if (fs.existsSync(outputPath)) {
			let content = fs.readFileSync(outputPath, 'utf-8');

			// Replace "export default X;" with named exports + default export.
			// Find the default export statement (usually at the end).
			const defaultExportMatch = content.match(/export default ([^;]+);/);
			if (defaultExportMatch) {
				const defaultValue = defaultExportMatch[1];
				const replacement = `const _mod = ${defaultValue};\nexport default _mod;\n${exportNames.map(name => `export const ${name} = _mod?.${name};`).join('\n')}`;
				content = content.replace(/export default ([^;]+);/, replacement);
				fs.writeFileSync(outputPath, content);
			}
		}
	}
}
