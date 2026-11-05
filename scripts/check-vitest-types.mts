/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Type-checks every Vitest file. Vitest strips types without checking them, and
// the main build excludes *.vitest.ts, so this is the only check they get.
//
// src/ tests use vitest.tsconfig.json. For test/e2e and each extension with
// Vitest files, this script generates a config that extends the project's
// tsconfig.json, so its tests are checked with the options the project builds with.
//
// Usage: npm run test:positron:check-ts [-- --print-configs]

import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import ts from 'typescript';
import { spawnWithRetry } from '../build/lib/spawnRetry.ts';

const root = path.resolve(import.meta.dirname, '..');
// Same lookup as build/lib/tsgo.ts.
const tsc = path.join(path.dirname(createRequire(import.meta.url).resolve('@typescript/native/package.json')), 'bin', 'tsc');
// Written next to each project's tsconfig.json so relative paths and default
// typeRoots resolve the same way; deleted after the run and gitignored. The pid
// keeps concurrent runs from deleting each other's configs.
const generatedName = `tsconfig.vitest.${process.pid}.generated.json`;

function glob(pattern: string): string[] {
	return fs.globSync(pattern, { cwd: root, exclude: p => p.includes('node_modules') })
		.map(p => p.split(path.sep).join('/'))
		.sort();
}

// Each extension or test/e2e directory that has Vitest files.
function findProjects(): string[] {
	const projectDirs = new Set<string>();
	for (const file of glob('{extensions/*/**,test/e2e/**}/*.vitest.{ts,tsx}')) {
		const parts = file.split('/');
		projectDirs.add(parts[0] === 'extensions' ? parts.slice(0, 2).join('/') : 'test/e2e');
	}
	return [...projectDirs].sort();
}

// Keeps the ambient declarations the build compiles, swaps in the Vitest files,
// and drops mocha's globals for Vitest's. TypeScript resolves the project's
// tsconfig, so extends chains, include patterns, and excludes all apply.
function generateConfig(projectDir: string): object {
	const dir = path.join(root, projectDir);
	const tsconfig = path.join(dir, 'tsconfig.json');
	const { config, error } = ts.readConfigFile(tsconfig, ts.sys.readFile);
	if (error) {
		throw new Error(`${tsconfig}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
	}
	const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dir, undefined, tsconfig);
	const toRelative = (file: string) => path.relative(dir, file).split(path.sep).join('/');
	// An unset `types` loads every @types package, including mocha, whose globals clash with Vitest's.
	const types = (parsed.options.types ?? ['node']).filter(t => t !== 'mocha');
	return {
		extends: './tsconfig.json',
		compilerOptions: { noEmit: true, types },
		files: [
			toRelative(path.join(root, 'node_modules/vitest/globals.d.ts')),
			...parsed.fileNames.filter(file => file.endsWith('.d.ts')).map(toRelative),
		],
		include: ['**/*.vitest.ts', '**/*.vitest.tsx'],
		exclude: ['node_modules', 'out'],
	};
}

// TypeScript keeps foo.vitest.ts and silently drops foo.vitest.tsx when both
// match an include, so the .tsx file would never be checked.
function findShadowedFiles(): string[] {
	const files = new Set(glob('{src,extensions,test/e2e}/**/*.vitest.{ts,tsx}'));
	return [...files].filter(file => file.endsWith('.tsx') && files.has(file.slice(0, -1)));
}

// `label` names what was checked; the generated config file is gone by the time errors print.
async function check({ label, config }: { label: string; config: string }): Promise<{ label: string; code: number; output: string }> {
	// spawnWithRetry rides out the transient macOS `spawn EBADF` (see build/lib/spawnRetry.ts).
	const child = await spawnWithRetry(process.execPath, [tsc, '--noEmit', '--skipLibCheck', '-p', config], { cwd: root });
	return new Promise(resolve => {
		let output = '';
		child.stdout?.on('data', chunk => output += chunk);
		child.stderr?.on('data', chunk => output += chunk);
		child.on('error', err => output += `\nFailed to run tsc: ${err.message}`);
		child.on('close', (code, signal) => {
			if (signal) {
				output += `\ntsc was killed by ${signal}`;
			}
			resolve({ label, code: code ?? 1, output });
		});
	});
}

async function main(): Promise<number> {
	const shadowed = findShadowedFiles();
	if (shadowed.length) {
		console.error('These .vitest.tsx files share a name with a .vitest.ts file, so TypeScript never checks them:');
		for (const file of shadowed) {
			console.error(`  ${file}`);
		}
		console.error('Rename one file of each pair.');
		return 1;
	}

	const projects = findProjects();
	const missing = projects.filter(dir => !fs.existsSync(path.join(root, dir, 'tsconfig.json')));
	if (missing.length) {
		console.error(`These directories have Vitest files but no tsconfig.json: ${missing.join(', ')}`);
		return 1;
	}

	const generated = projects.map(dir => ({ dir, path: `${dir}/${generatedName}`, config: generateConfig(dir) }));
	if (process.argv.includes('--print-configs')) {
		for (const { path: file, config } of generated) {
			console.log(`${file}:\n${JSON.stringify(config, null, '\t')}\n`);
		}
		return 0;
	}

	let results;
	try {
		for (const { path: file, config } of generated) {
			fs.writeFileSync(path.join(root, file), JSON.stringify(config, null, '\t'));
		}
		results = await Promise.all([
			{ label: 'src (vitest.tsconfig.json)', config: 'vitest.tsconfig.json' },
			...generated.map(g => ({ label: g.dir, config: g.path })),
		].map(check));
	} finally {
		for (const { path: file } of generated) {
			fs.rmSync(path.join(root, file), { force: true });
		}
	}

	let failed = 0;
	for (const { label, code, output } of results) {
		if (code !== 0) {
			failed++;
			console.error(`\n${label}:`);
			console.error(output.trimEnd());
		}
	}
	console.log(`\nChecked ${results.length} Vitest tsconfigs: ${failed ? `${failed} with errors` : 'no errors'}.`);
	return failed ? 1 : 0;
}

process.exitCode = await main();
