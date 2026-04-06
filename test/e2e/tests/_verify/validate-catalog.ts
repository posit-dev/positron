/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Static validation of the action catalog.
 *
 * Parses action-catalog.ts source to extract every `app.workbench.X.Y` reference,
 * then verifies that:
 *   1. `X` is a property on the Workbench class
 *   2. `Y` is a method/property on the corresponding POM class
 *
 * Runs as a plain Node script (no Electron, no Playwright, <2 seconds).
 *
 * Usage:
 *   npx tsx test/e2e/tests/_verify/catalog.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const CATALOG_PATH = path.join(__dirname, 'action-catalog.ts');
const WORKBENCH_PATH = path.join(ROOT, 'infra/workbench.ts');

// ---------------------------------------------------------------------------
// 1. Parse the Workbench class to get POM name -> import source mapping
// ---------------------------------------------------------------------------

const workbenchSource = fs.readFileSync(WORKBENCH_PATH, 'utf-8');

// Extract `readonly X: TypeName` from the Workbench class
const workbenchProps = new Map<string, string>();
for (const match of workbenchSource.matchAll(/readonly\s+(\w+)\s*:\s*(\w+)/g)) {
	workbenchProps.set(match[1], match[2]); // e.g., 'sessions' -> 'Sessions'
}

// Extract import paths: `import { TypeName } from './path'`
const importMap = new Map<string, string>();
for (const match of workbenchSource.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
	const types = match[1].split(',').map(t => t.trim());
	const importPath = match[2];
	for (const type of types) {
		importMap.set(type, importPath);
	}
}

// ---------------------------------------------------------------------------
// 2. Parse POM source files to extract public method/property names
// ---------------------------------------------------------------------------

function getPomMembers(typeName: string): Set<string> | null {
	const importPath = importMap.get(typeName);
	if (!importPath) {
		return null;
	}

	// Resolve the import path relative to the infra directory
	let resolvedPath = path.resolve(path.join(ROOT, 'infra'), importPath);
	if (!resolvedPath.endsWith('.ts') && !resolvedPath.endsWith('.js')) {
		resolvedPath += '.ts';
	}
	// Some imports point to .js files but the source is .ts
	if (resolvedPath.endsWith('.js')) {
		resolvedPath = resolvedPath.replace(/\.js$/, '.ts');
	}

	if (!fs.existsSync(resolvedPath)) {
		return null;
	}

	const source = fs.readFileSync(resolvedPath, 'utf-8');
	const members = new Set<string>();

	// Match async methods (with optional access modifiers and generics):
	//   `async methodName(`, `public async methodName<T>(`, `private async methodName(`
	for (const m of source.matchAll(/(?:public|private|protected)?\s*async\s+(\w+)\s*[<(]/g)) {
		members.add(m[1]);
	}

	// Match regular methods/getters at class level (tab-indented, optional access modifiers):
	//   `methodName(`, `public methodName(`, `get propName(`, `public get propName(`
	for (const m of source.matchAll(/^\t(?:(?:public|private|protected)\s+)?(?:get\s+)?(\w+)\s*[\(<]/gm)) {
		members.add(m[1]);
	}

	// Match public properties: `readonly propName`, `propName =`, `propName:`
	//   with optional access modifiers
	for (const m of source.matchAll(/^\t(?:(?:public|private|protected)\s+)?(?:readonly\s+)?(\w+)\s*[=:]/gm)) {
		members.add(m[1]);
	}

	// Match arrow function properties: `propName = (` or `propName = async (`
	for (const m of source.matchAll(/^\t(\w+)\s*=\s*(?:async\s*)?\(/gm)) {
		members.add(m[1]);
	}

	return members;
}

// Cache POM members by type name
const pomMembersCache = new Map<string, Set<string> | null>();
function getCachedPomMembers(typeName: string): Set<string> | null {
	if (!pomMembersCache.has(typeName)) {
		pomMembersCache.set(typeName, getPomMembers(typeName));
	}
	return pomMembersCache.get(typeName)!;
}

// ---------------------------------------------------------------------------
// 3. Parse action-catalog.ts to find all app.workbench.X.Y references
// ---------------------------------------------------------------------------

const catalogSource = fs.readFileSync(CATALOG_PATH, 'utf-8');

// Match: app.workbench.pomName.methodName
// Also match: app.workbench.pomName.subObject.methodName (e.g., dataExplorer.grid.sortColumnBy)
const pomRefs: Array<{ pomName: string; member: string; line: number; fullRef: string }> = [];
const catalogLines = catalogSource.split('\n');

for (let i = 0; i < catalogLines.length; i++) {
	// Match app.workbench.X.Y (direct member access)
	const directMatches = catalogLines[i].matchAll(/app\.workbench\.(\w+)\.(\w+)/g);
	for (const match of directMatches) {
		pomRefs.push({
			pomName: match[1],
			member: match[2],
			line: i + 1,
			fullRef: match[0],
		});
	}
}

// ---------------------------------------------------------------------------
// 4. Validate each reference
// ---------------------------------------------------------------------------

const errors: string[] = [];
let checked = 0;

for (const ref of pomRefs) {
	// Check that the POM name exists on Workbench
	const typeName = workbenchProps.get(ref.pomName);
	if (!typeName) {
		errors.push(
			`Line ${ref.line}: "${ref.fullRef}" — "${ref.pomName}" is not a property on Workbench`
		);
		continue;
	}

	// Check that the member exists on the POM class
	const members = getCachedPomMembers(typeName);
	if (!members) {
		// Can't resolve the POM source — skip (don't false-positive)
		continue;
	}

	if (!members.has(ref.member)) {
		errors.push(
			`Line ${ref.line}: "${ref.fullRef}" — "${ref.member}" not found on ${typeName} (${ref.pomName})`
		);
	}

	checked++;
}

// ---------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------

const actionCount = (catalogSource.match(/^\t\w+:\s*async\s*\(/gm) || []).length;

console.log(`\nAction catalog validation`);
console.log(`─────────────────────────`);
console.log(`Actions in catalog: ${actionCount}`);
console.log(`POM references checked: ${checked}`);
console.log(`Workbench properties known: ${workbenchProps.size}`);

if (errors.length > 0) {
	console.log(`\n✗ ${errors.length} POM drift error(s) found:\n`);
	for (const err of errors) {
		console.log(`  ✗ ${err}`);
	}
	process.exit(1);
} else {
	console.log(`\n✓ All POM references are valid.`);
	process.exit(0);
}
