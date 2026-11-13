/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { execFile } from 'child_process';
import * as esbuild from 'esbuild';
import fancyLog from 'fancy-log';
import * as fs from 'fs';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { getAiLibServerModules } from './ai-lib-dependencies.ts';
import { gulp } from './gulp/facade.ts';
import * as task from './gulp/task.ts';

const REPO_ROOT = fs.realpathSync(path.dirname(path.dirname(import.meta.dirname)));

/** The only ai-lib entry the server loads at runtime (`headlessProviderModule.ts`). */
export const AI_LIB_SERVER_ENTRY = 'ai-provider-bridge/headless';

/**
 * The most files the bundled package may have: `package.json`, the notices,
 * and `dist/*.js`. The bundle has 13 today (11 in `dist/`); most chunks come
 * from the dependencies' own dynamic `import()` calls, so a dependency bump can
 * add more. Raise the budget only after checking that the new chunks are real.
 */
export const AI_LIB_SERVER_FILE_BUDGET = 75;

/**
 * Bundled packages whose runtime file lookups (`__dirname`, `__filename`,
 * `require.resolve(`, `import.meta.`) were reviewed and are safe in the bundle,
 * where the package's own files are not next to the code. Package name to the
 * reason.
 */
export const AI_LIB_SERVER_LOOKUP_ALLOWLIST: ReadonlyMap<string, string> = new Map([
	['open', 'falls back to the system xdg-open when its own copy is missing (open checks with fs.access); opening a browser from a headless server is out of scope'],
]);

const PACKAGE_NAME = 'ai-provider-bridge';

const BANNER = `import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);`;

/**
 * Resolves bare `jsonc-parser` to the ESM build of the copy Node would load for
 * the importer: the search starts at the importer's directory, so a nested or
 * hoisted copy wins over the repository root's. (An esbuild `alias` resolves
 * from `absWorkingDir`, which would always take the root copy.)
 */
const jsoncParserEsmPlugin: esbuild.Plugin = {
	name: 'jsonc-parser-esm',
	setup(build) {
		build.onResolve({ filter: /^jsonc-parser$/ }, args => {
			const manifest = createRequire(path.join(args.resolveDir, 'noop.js')).resolve('jsonc-parser/package.json');
			return { path: path.join(path.dirname(manifest), 'lib', 'esm', 'main.js') };
		});
	},
};

const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

const NOTICES_SEPARATOR = '-'.repeat(80);

interface PackageManifest {
	name: string;
	version: string;
	license?: string;
	author?: string | { name?: string };
}

/**
 * Bundle the server's ai-lib entry ({@link AI_LIB_SERVER_ENTRY}) with all of its
 * dependencies into `<outDir>/node_modules/ai-provider-bridge`, write a
 * `package.json` that exports only that entry and a notices file, and check the
 * output. Returns the written paths, relative to `outDir`, with `/` separators.
 * Throws if the build or a check fails.
 *
 * `overrides` is for tests, for example to mark a package `external`.
 */
export async function bundleAiLibServer(outDir: string, overrides: Pick<esbuild.BuildOptions, 'external'> = {}): Promise<string[]> {
	const packageOut = path.join(outDir, 'node_modules', PACKAGE_NAME);
	fs.rmSync(packageOut, { recursive: true, force: true });

	// The real path is where Node resolves the package from, so the bundle picks
	// the same dependency versions the server would.
	const sourceDir = fs.realpathSync(path.join(REPO_ROOT, 'node_modules', PACKAGE_NAME));
	const sourceManifest = readManifest(sourceDir);

	const result = await esbuild.build({
		entryPoints: { headless: path.join(sourceDir, 'dist', 'headless.js') },
		// Module comments and metafile paths are relative to the repository root.
		absWorkingDir: REPO_ROOT,
		bundle: true,
		platform: 'node',
		format: 'esm',
		// Keeps the dependencies' own dynamic `import()` calls lazy.
		splitting: true,
		target: getNodeTarget(),
		// The default `mainFields` (`main` first, as Node resolves) picks the UMD
		// build of jsonc-parser 3.3.1 (via ai-config): its `require('./impl/format')`
		// sits in an AMD branch that esbuild cannot follow, so the import fails with
		// "Cannot find module './impl/format'". jsonc-parser has no `exports`; the
		// plugin points it at its ESM build instead of changing `mainFields`
		// globally, which would swap every package without `exports` (the AWS SDK,
		// for one) to its ESM build, where Node runs the CommonJS build today.
		plugins: [jsoncParserEsmPlugin],
		// Without this, esbuild adds the `module` condition and bundles the ESM
		// build of packages whose `exports` list it (for example `@smithy/core`).
		// Empty keeps `default`, `import`/`require`, and `node`, as Node does.
		conditions: [],
		outdir: path.join(packageOut, 'dist'),
		chunkNames: 'chunk-[hash]',
		metafile: true,
		sourcemap: false,
		// The notices file carries the licenses.
		legalComments: 'none',
		// Keeps stack traces readable, and the lookup scan needs the module comments.
		minify: false,
		// CommonJS dependencies call `require` for builtins.
		banner: { js: BANNER },
		logLevel: 'warning',
		...overrides,
	});
	if (result.errors.length > 0) {
		throw new Error(`ai-lib server bundle failed with ${result.errors.length} errors`);
	}
	checkNoBuildWarnings(result.warnings);

	fs.writeFileSync(path.join(packageOut, 'package.json'), JSON.stringify({
		name: PACKAGE_NAME,
		version: sourceManifest.version,
		type: 'module',
		exports: { './headless': './dist/headless.js' },
	}, null, '\t') + '\n');

	const bundledPackages = getBundledPackages(Object.keys(result.metafile!.inputs));
	fs.writeFileSync(path.join(packageOut, NOTICES_FILE), formatNotices(bundledPackages));
	logPackagesOutsideClosure(bundledPackages);

	const written = listFiles(outDir, packageOut);
	checkFileBudget(written, AI_LIB_SERVER_FILE_BUDGET);

	const scripts = new Map(written
		.filter(file => file.endsWith('.js'))
		.map(file => [file, fs.readFileSync(path.join(outDir, file), 'utf8')]));
	const lookups = findUnreviewedLookups(scripts, AI_LIB_SERVER_LOOKUP_ALLOWLIST);
	if (lookups.length > 0) {
		throw new Error([
			`The ai-lib server bundle has ${lookups.length} unreviewed file lookups. A bundled package cannot find files next to itself.`,
			'Review each and add the package to AI_LIB_SERVER_LOOKUP_ALLOWLIST in ai-lib-server-bundle.ts, or fix the bundle:',
			...lookups.map(({ packageName, file, line, text }) => `  ${packageName} at ${file}:${line}: ${text}`),
		].join('\n'));
	}

	await verifyAiLibServerIsolation(outDir);

	return written;
}

/** Where the server build stages the bundle before packaging. */
export const AI_LIB_SERVER_BUNDLE_DIR = path.join(REPO_ROOT, '.build', 'ai-lib-server-bundle');

/**
 * Builds and checks the bundle in {@link AI_LIB_SERVER_BUNDLE_DIR}. A failed
 * check rejects, which fails the server build.
 */
export const aiLibServerBundleTask = task.define('positron-ai-lib-server-bundle', async () => {
	await bundleAiLibServer(AI_LIB_SERVER_BUNDLE_DIR);
});
task.task(aiLibServerBundleTask);

/**
 * Streams the bundle that {@link aiLibServerBundleTask} staged, at the
 * `node_modules/ai-provider-bridge/**` paths the server resolves it from.
 */
export function getAiLibServerBundle(): NodeJS.ReadWriteStream {
	const manifest = path.join(AI_LIB_SERVER_BUNDLE_DIR, 'node_modules', PACKAGE_NAME, 'package.json');
	if (!fs.existsSync(manifest)) {
		throw new Error(`The ai-lib server bundle is missing (${manifest}). Run the positron-ai-lib-server-bundle task first.`);
	}
	return gulp.src('node_modules/ai-provider-bridge/**', { cwd: AI_LIB_SERVER_BUNDLE_DIR, base: AI_LIB_SERVER_BUNDLE_DIR, dot: true });
}

/**
 * Prove that the bundle in `<outDir>/node_modules/ai-provider-bridge` runs with
 * no `node_modules` to fall back on: import the entry by its bare specifier, as
 * the server does, then import every file in `dist/`, which loads each lazy
 * chunk. Throws with the child's stderr if any import fails.
 */
export async function verifyAiLibServerIsolation(outDir: string): Promise<void> {
	const distDir = path.join(outDir, 'node_modules', PACKAGE_NAME, 'dist');
	const scripts = fs.readdirSync(distDir).filter(file => file.endsWith('.js')).sort();
	if (scripts.length === 0) {
		throw new Error(`The ai-lib server bundle has no .js files in ${distDir}, so there is nothing to verify.`);
	}
	try {
		await runInAiLibServerIsolation(outDir, isolatedDistDir => [
			`const entry = await import(${JSON.stringify(AI_LIB_SERVER_ENTRY)});`,
			`if (typeof entry.HEADLESS_CONTRACT_VERSION !== 'number') { throw new Error('HEADLESS_CONTRACT_VERSION is not a number'); }`,
			`if (typeof entry.createHeadlessProviders !== 'function') { throw new Error('createHeadlessProviders is not a function'); }`,
			...scripts.map(script => `await import(${JSON.stringify(pathToFileURL(path.join(isolatedDistDir, script)).href)});`),
			// A timer or handle a chunk opens at import time must not keep the child alive.
			'process.exit(0);',
		].join('\n'));
	} catch (error) {
		throw new Error([
			`The ai-lib server bundle does not run without node_modules. ${(error as Error).message}`,
			'Hints:',
			'  "Dynamic require of "x" is not supported": the require banner is missing or shadowed.',
			'  "Cannot find module \'./...\'" from a relative path: esbuild picked a UMD or CommonJS build it cannot follow; check mainFields and the jsonc-parser plugin.',
			'  ERR_MODULE_NOT_FOUND for a package: the package was left out of the bundle.',
			'  ENOENT on a data file: a dependency reads a file at runtime; copy that file next to the chunk in bundleAiLibServer.',
		].join('\n'));
	}
}

/** How long the isolated child may run before it is killed. */
const ISOLATION_TIMEOUT_MS = 60_000;

/**
 * Run an ES module in a child `node` process that can see only the bundled
 * package. The package is copied to `<tmp>/node_modules/ai-provider-bridge` in a
 * fresh temporary directory, which has no `node_modules` above it. ESM ignores
 * `NODE_PATH` and `HOME`, but the banner's CommonJS `require` does not, so
 * `NODE_PATH` is removed and `HOME` and `USERPROFILE` point at `<tmp>`.
 * `NODE_OPTIONS` is removed so the parent's flags (for example `--require`)
 * cannot change the child.
 *
 * `probe` gets the copied `dist/` directory and returns the module source.
 * Returns the child's stdout. Throws with its stderr on a nonzero exit, or when
 * the child runs longer than {@link ISOLATION_TIMEOUT_MS}.
 */
export async function runInAiLibServerIsolation(outDir: string, probe: (isolatedDistDir: string) => string): Promise<string> {
	const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-lib-server-isolation-')));
	try {
		const isolatedPackage = path.join(tmp, 'node_modules', PACKAGE_NAME);
		fs.cpSync(path.join(outDir, 'node_modules', PACKAGE_NAME), isolatedPackage, { recursive: true });
		const probeFile = path.join(tmp, 'probe.mjs');
		fs.writeFileSync(probeFile, probe(path.join(isolatedPackage, 'dist')));

		const env: NodeJS.ProcessEnv = { ...process.env, HOME: tmp, USERPROFILE: tmp };
		delete env.NODE_PATH;
		delete env.NODE_OPTIONS;

		return await new Promise<string>((resolve, reject) => {
			const options = { cwd: tmp, env, maxBuffer: 16 * 1024 * 1024, timeout: ISOLATION_TIMEOUT_MS, killSignal: 'SIGKILL' as const };
			execFile(process.execPath, [probeFile], options, (error, stdout, stderr) => {
				if (error?.killed && error.code === null) {
					reject(new Error(`The child node process did not finish within ${ISOLATION_TIMEOUT_MS / 1000}s and was killed: a module may wait forever at import time.\n${stderr}`));
				} else if (error) {
					reject(new Error(`The child node process exited with ${error.code ?? error.signal}:\n${stderr}`));
				} else {
					resolve(stdout);
				}
			});
		});
	} finally {
		// On Windows the directory can stay busy briefly; a cleanup failure must
		// not replace the child's error.
		try {
			fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
		} catch (error) {
			fancyLog(`[ai-lib-server-bundle] Could not remove ${tmp}: ${(error as Error).message}`);
		}
	}
}

/**
 * Throws when esbuild warned. A computed `require(x)` or `import(x)` is only a
 * warning, and at runtime it would resolve against the server's node_modules.
 */
export function checkNoBuildWarnings(warnings: readonly esbuild.Message[]): void {
	if (warnings.length === 0) {
		return;
	}
	throw new Error([
		`The ai-lib server bundle has ${warnings.length} esbuild warnings:`,
		...warnings.map(({ id, text, location }) => {
			const where = location ? `${location.file}:${location.line}:${location.column}` : '<unknown location>';
			return `  [${id}] ${text} at ${where}`;
		}),
	].join('\n'));
}

/** Throws when the bundle has more files than `budget`. */
export function checkFileBudget(paths: readonly string[], budget: number): void {
	if (paths.length > budget) {
		throw new Error(`The ai-lib server bundle has ${paths.length} files, over the budget of ${budget}: new lazy chunks from a dependency bump? See ai-lib-server-bundle.ts`);
	}
}

/** A file lookup in the bundle that no allowlist entry covers. */
export interface UnreviewedLookup {
	/** The package the code came from, or `<unknown>` before any module comment. */
	packageName: string;
	file: string;
	/** 1-based. */
	line: number;
	text: string;
}

/**
 * esbuild's module comment, `// <path>`, at the start of each module's code in
 * unminified output. The path shape keeps top-level source comments out.
 */
const MODULE_COMMENT = /^\/\/ (?<modulePath>\S+\/\S+\.(?:[cm]?[jt]sx?|json))$/;

/**
 * No trailing word boundary: esbuild renames a merged module's `__dirname` to
 * `__dirname2`, and `import.meta.` covers `url`, `dirname`, and `filename`.
 */
const FILE_LOOKUP = /__dirname|__filename|require\.resolve\(|import\.meta\./;

/**
 * Find the runtime file lookups in bundled files (path to contents) whose
 * package is not in `allowlist`. Each hit is named by the package of the
 * nearest preceding module comment.
 */
export function findUnreviewedLookups(files: ReadonlyMap<string, string>, allowlist: ReadonlyMap<string, string>): UnreviewedLookup[] {
	const lookups: UnreviewedLookup[] = [];
	for (const [file, contents] of files) {
		let packageName = '<unknown>';
		contents.split('\n').forEach((text, index) => {
			const modulePath = MODULE_COMMENT.exec(text)?.groups?.modulePath;
			if (modulePath) {
				packageName = packageFromModulePath(modulePath) ?? '<unknown>';
				return;
			}
			if (text === BANNER || !FILE_LOOKUP.test(text) || allowlist.has(packageName)) {
				return;
			}
			lookups.push({ packageName, file, line: index + 1, text: text.trim() });
		});
	}
	return lookups;
}

/**
 * The package a bundled module path belongs to: the last `node_modules/<name>`
 * segment (with its scope), or `<name>` for ai-lib's own `ai-lib/packages/<name>`.
 */
function packageFromModulePath(modulePath: string): string | undefined {
	return locatePackage(modulePath)?.name;
}

function locatePackage(modulePath: string): { name: string; dir: string } | undefined {
	const marker = 'node_modules/';
	const index = modulePath.lastIndexOf(marker);
	if (index !== -1) {
		const segments = modulePath.slice(index + marker.length).split('/');
		const name = segments[0].startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
		return { name, dir: modulePath.slice(0, index + marker.length) + name };
	}

	const aiLib = /(?:^|\/)ai-lib\/packages\/(?<name>[^/]+)\//.exec(modulePath);
	if (aiLib?.groups) {
		return { name: aiLib.groups.name, dir: modulePath.slice(0, aiLib.index + aiLib[0].length - 1) };
	}

	return undefined;
}

interface BundledPackage {
	name: string;
	version: string;
	license: string;
	/** Repository-relative. */
	dir: string;
}

/** The packages the metafile's inputs come from, sorted by name. */
function getBundledPackages(inputs: string[]): BundledPackage[] {
	const dirs = new Set<string>();
	for (const input of inputs) {
		const location = locatePackage(input);
		if (!location) {
			throw new Error(`Cannot tell which package the bundled file ${input} belongs to, so the notices would miss it.`);
		}
		dirs.add(location.dir);
	}

	return [...dirs]
		.map(dir => {
			const manifest = readManifest(path.join(REPO_ROOT, dir));
			return { name: manifest.name, version: manifest.version, license: manifest.license ?? 'UNKNOWN', dir };
		})
		.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

const LICENSE_FILE = /^(?:licen[cs]e|notice|copying)/i;

function formatNotices(packages: readonly BundledPackage[]): string {
	const sections = packages.map(pkg => {
		const absoluteDir = path.join(REPO_ROOT, pkg.dir);
		const texts = fs.readdirSync(absoluteDir)
			.filter(file => LICENSE_FILE.test(file) && fs.statSync(path.join(absoluteDir, file)).isFile())
			.sort()
			.map(file => fs.readFileSync(path.join(absoluteDir, file), 'utf8').trim())
			.filter(text => text.length > 0);

		if (texts.length === 0) {
			texts.push(fallbackLicenseText(pkg, readManifest(absoluteDir)));
		}

		return `${pkg.name}@${pkg.version} (${pkg.license})\n\n${texts.join('\n\n')}\n`;
	});

	return [
		'Third-party notices for the packages bundled into ai-provider-bridge/dist.',
		'',
		NOTICES_SEPARATOR,
		sections.join(`${NOTICES_SEPARATOR}\n`),
	].join('\n');
}

function fallbackLicenseText(pkg: BundledPackage, manifest: PackageManifest): string {
	const template = SPDX_LICENSE_TEXTS.get(pkg.license);
	if (!template) {
		throw new Error(`${pkg.name}@${pkg.version} ships no license file, and its license '${pkg.license}' has no standard text in ai-lib-server-bundle.ts. Add one to SPDX_LICENSE_TEXTS.`);
	}
	const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
	return template.replace('<copyright holders>', author ?? `the ${pkg.name} authors`).trim();
}

/** Log the bundled packages that `getAiLibServerModules()` does not list (peers, hoisting). */
function logPackagesOutsideClosure(packages: readonly BundledPackage[]): void {
	const closure = new Set(getAiLibServerModules().map(({ destination }) => {
		const location = locatePackage(destination + '/');
		return location?.name;
	}));
	const outside = packages.map(pkg => pkg.name).filter(name => !closure.has(name));
	if (outside.length > 0) {
		fancyLog(`[ai-lib-server-bundle] Bundled packages outside the ai-lib closure: ${outside.join(', ')}`);
	}
}

function listFiles(outDir: string, dir: string): string[] {
	return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile())
		.map(entry => path.relative(outDir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
		.sort();
}

function readManifest(moduleDir: string): PackageManifest {
	return JSON.parse(fs.readFileSync(path.join(moduleDir, 'package.json'), 'utf8'));
}

/** `node<major>` from the Node version the server ships (`remote/.npmrc`). */
function getNodeTarget(): string {
	const npmrc = fs.readFileSync(path.join(REPO_ROOT, 'remote', '.npmrc'), 'utf8');
	const major = /^target="(?<major>\d+)\./m.exec(npmrc)?.groups?.major;
	if (!major) {
		throw new Error('Cannot read the Node target from remote/.npmrc');
	}
	return `node${major}`;
}

const MIT_TEXT = `MIT License

Copyright (c) <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const ISC_TEXT = `ISC License

Copyright (c) <copyright holders>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const BSD_3_CLAUSE_TEXT = `BSD 3-Clause License

Copyright (c) <copyright holders>

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
this list of conditions and the following disclaimer in the documentation
and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const APACHE_2_0_TEXT = `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction,
and distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by
the copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all
other entities that control, are controlled by, or are under common
control with that entity. For the purposes of this definition,
"control" means (i) the power, direct or indirect, to cause the
direction or management of such entity, whether by contract or
otherwise, or (ii) ownership of fifty percent (50%) or more of the
outstanding shares, or (iii) beneficial ownership of such entity.

"You" (or "Your") shall mean an individual or Legal Entity
exercising permissions granted by this License.

"Source" form shall mean the preferred form for making modifications,
including but not limited to software source code, documentation
source, and configuration files.

"Object" form shall mean any form resulting from mechanical
transformation or translation of a Source form, including but
not limited to compiled object code, generated documentation,
and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or
Object form, made available under the License, as indicated by a
copyright notice that is included in or attached to the work
(an example is provided in the Appendix below).

"Derivative Works" shall mean any work, whether in Source or Object
form, that is based on (or derived from) the Work and for which the
editorial revisions, annotations, elaborations, or other modifications
represent, as a whole, an original work of authorship. For the purposes
of this License, Derivative Works shall not include works that remain
separable from, or merely link (or bind by name) to the interfaces of,
the Work and Derivative Works thereof.

"Contribution" shall mean any work of authorship, including
the original version of the Work and any modifications or additions
to that Work or Derivative Works thereof, that is intentionally
submitted to Licensor for inclusion in the Work by the copyright owner
or by an individual or Legal Entity authorized to submit on behalf of
the copyright owner. For the purposes of this definition, "submitted"
means any form of electronic, verbal, or written communication sent
to the Licensor or its representatives, including but not limited to
communication on electronic mailing lists, source code control systems,
and issue tracking systems that are managed by, or on behalf of, the
Licensor for the purpose of discussing and improving the Work, but
excluding communication that is conspicuously marked or otherwise
designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity
on behalf of whom a Contribution has been received by Licensor and
subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable
copyright license to reproduce, prepare Derivative Works of,
publicly display, publicly perform, sublicense, and distribute the
Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
this License, each Contributor hereby grants to You a perpetual,
worldwide, non-exclusive, no-charge, royalty-free, irrevocable
(except as stated in this section) patent license to make, have made,
use, offer to sell, sell, import, and otherwise transfer the Work,
where such license applies only to those patent claims licensable
by such Contributor that are necessarily infringed by their
Contribution(s) alone or by combination of their Contribution(s)
with the Work to which such Contribution(s) was submitted. If You
institute patent litigation against any entity (including a
cross-claim or counterclaim in a lawsuit) alleging that the Work
or a Contribution incorporated within the Work constitutes direct
or contributory patent infringement, then any patent licenses
granted to You under this License for that Work shall terminate
as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
Work or Derivative Works thereof in any medium, with or without
modifications, and in Source or Object form, provided that You
meet the following conditions:

(a) You must give any other recipients of the Work or
Derivative Works a copy of this License; and

(b) You must cause any modified files to carry prominent notices
stating that You changed the files; and

(c) You must retain, in the Source form of any Derivative Works
that You distribute, all copyright, patent, trademark, and
attribution notices from the Source form of the Work,
excluding those notices that do not pertain to any part of
the Derivative Works; and

(d) If the Work includes a "NOTICE" text file as part of its
distribution, then any Derivative Works that You distribute must
include a readable copy of the attribution notices contained
within such NOTICE file, excluding those notices that do not
pertain to any part of the Derivative Works, in at least one
of the following places: within a NOTICE text file distributed
as part of the Derivative Works; within the Source form or
documentation, if provided along with the Derivative Works; or,
within a display generated by the Derivative Works, if and
wherever such third-party notices normally appear. The contents
of the NOTICE file are for informational purposes only and
do not modify the License. You may add Your own attribution
notices within Derivative Works that You distribute, alongside
or as an addendum to the NOTICE text from the Work, provided
that such additional attribution notices cannot be construed
as modifying the License.

You may add Your own copyright statement to Your modifications and
may provide additional or different license terms and conditions
for use, reproduction, or distribution of Your modifications, or
for any such Derivative Works as a whole, provided Your use,
reproduction, and distribution of the Work otherwise complies with
the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
any Contribution intentionally submitted for inclusion in the Work
by You to the Licensor shall be under the terms and conditions of
this License, without any additional terms or conditions.
Notwithstanding the above, nothing herein shall supersede or modify
the terms of any separate license agreement you may have executed
with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
names, trademarks, service marks, or product names of the Licensor,
except as required for reasonable and customary use in describing the
origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
agreed to in writing, Licensor provides the Work (and each
Contributor provides its Contributions) on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied, including, without limitation, any warranties or conditions
of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
PARTICULAR PURPOSE. You are solely responsible for determining the
appropriateness of using or redistributing the Work and assume any
risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
whether in tort (including negligence), contract, or otherwise,
unless required by applicable law (such as deliberate and grossly
negligent acts) or agreed to in writing, shall any Contributor be
liable to You for damages, including any direct, indirect, special,
incidental, or consequential damages of any character arising as a
result of this License or out of the use or inability to use the
Work (including but not limited to damages for loss of goodwill,
work stoppage, computer failure or malfunction, or any and all
other commercial damages or losses), even if such Contributor
has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
the Work or Derivative Works thereof, You may choose to offer,
and charge a fee for, acceptance of support, warranty, indemnity,
or other liability obligations and/or rights consistent with this
License. However, in accepting such obligations, You may act only
on Your own behalf and on Your sole responsibility, not on behalf
of any other Contributor, and only if You agree to indemnify,
defend, and hold each Contributor harmless for any liability
incurred by, or claims asserted against, such Contributor by reason
of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS`;

/**
 * Standard texts for the SPDX ids of bundled packages that ship no license
 * file. Indentation is removed from the Apache text, as the repository's
 * hygiene check rejects space-indented lines.
 */
const SPDX_LICENSE_TEXTS: ReadonlyMap<string, string> = new Map([
	['MIT', MIT_TEXT],
	['ISC', ISC_TEXT],
	['BSD-3-Clause', BSD_3_CLAUSE_TEXT],
	['Apache-2.0', APACHE_2_0_TEXT],
]);
