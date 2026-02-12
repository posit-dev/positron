/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import esbuild from 'esbuild';

/**
 * Build ESM package dependencies. This is necessary because some dependencies (e.g. React) are
 * only published as CommonJS and need to be bundled into ESM for use.
 */
export function buildESMPackageDependencies(outdir: string = 'out/esm-package-dependencies') {
	// Log.
	console.log(`Building ESM package dependencies to ${outdir}...`);

	// Define the export map that specifies which named exports to create for each dependency.
	// Entry points are derived from the keys of this map.
	const exportMap: Record<string, string[]> = {
		'he': [
			'decode',
			'encode',
			'escape',
			'unescape'
		],
		'react/jsx-runtime': [
			'jsx',
			'jsxs',
			'Fragment'
		],
		'react': [
			'Component',
			'PureComponent',
			'Fragment',
			'StrictMode',
			'Suspense',
			'useState',
			'useEffect',
			'useContext',
			'useReducer',
			'useCallback',
			'useMemo',
			'useRef',
			'useImperativeHandle',
			'useLayoutEffect',
			'useDebugValue',
			'createElement',
			'createContext',
			'forwardRef',
			'memo',
			'lazy'],
		'react-dom/client': [
			'createRoot',
			'hydrateRoot'
		],
		'react-dom': [
			'render',
			'hydrate',
			'unmountComponentAtNode',
			'findDOMNode',
			'createPortal',
			'flushSync'
		],
		'react-window': [
			'FixedSizeList',
			'VariableSizeList',
			'FixedSizeGrid',
			'VariableSizeGrid'
		],
	};

	// Derive entry points from the export map keys.
	const entryPoints = Object.keys(exportMap);

	// Bundle the entry points with esbuild.
	esbuild.buildSync({
		entryPoints,
		bundle: true,
		format: 'esm',
		outdir,
		minify: true,
		splitting: true,
	});

	/**
	 * The post-processing step exists because of how esbuild handles CommonJS to ESM conversion.
	 *
	 * The problem:
	 *
	 * When esbuild bundles CommonJS packages (like React) into ESM format, it outputs something like:
	 *
	 * export default react_default;
	 *
	 * Where everything is in the default export.
	 *
	 * But TypeScript code expects to use named imports:
	 *
	 * import { useState, useEffect, Component } from 'react';
	 * import { createRoot } from 'react-dom/client';
	 *
	 * Without the post-processing, these named imports would fail because esbuild only created a default export.
	 *
	 * The solution:
	 *
	 * The post-processing step reads the generated ESM files, finds the default export, and creates named exports
	 * for the expected API surface. This transforms export default react_default; into something like:
	 *
	 * const _mod = react_default;
	 * export default _mod;
	 * export const useState = _mod?.useState;
	 * export const useEffect = _mod?.useEffect;
	 * export const Component = _mod?.Component;
	 * // ... etc for all named exports
	 *
	 * This allows both import styles to work:
	 *
	 * import React from 'react' (default import)
	 * import { useState } from 'react' (named import)
	 *
	 * The exportMap object defines which named exports to extract for each package, ensuring that all
	 * commonly-used APIs are available as named imports just like they were in the original packages.
	 *
	 * Claude will help you identify the correct named exports for each package based on their documentation
	 * and usage patterns.
	*/

	// Post-process: Replace default-only exports with named + default exports.
	for (const [entry, exportNames] of Object.entries(exportMap)) {
		// Construct the path to the generated ESM file for this entry.
		const outputPath = path.join(outdir, entry + '.js');
		// Check if the file exists before trying to read it.
		if (fs.existsSync(outputPath)) {
			// Read the content of the generated ESM file.
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
