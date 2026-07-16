/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import es from 'event-stream';
import fs from 'fs';
import cp from 'child_process';
import glob from 'glob';
import { gulp, filter, rename, buffer, vinylZip, jsonEditor } from './gulp/facade.ts';
import path from 'path';
import crypto from 'crypto';
import { Stream } from 'stream';
import File from 'vinyl';
import { createStatsStream } from './stats.ts';
import * as util2 from './util.ts';
import fancyLog from 'fancy-log';
import ansiColors from 'ansi-colors';
import * as jsoncParser from 'jsonc-parser';
import { getProductionDependencies } from './dependencies.ts';
import { type IExtensionDefinition, getExtensionStream } from './builtInExtensions.ts';
import { fetchUrls, fetchGithub } from './fetch.ts';
import { createTsgoStream, spawnTsgo } from './tsgo.ts';
import watcher from './watch/index.ts';
// --- Start Positron ---
import os from 'os';
import { getBootstrapExtensionStream } from './bootstrapExtensions.ts';
// --- End Positron ---

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const root = path.dirname(path.dirname(import.meta.dirname));
// const commit = getVersion(root);
// const sourceMappingURLBase = `https://main.vscode-cdn.net/sourcemaps/${commit}`;

function minifyExtensionResources(input: Stream): Stream {
	const jsonFilter = filter(['**/*.json', '**/*.code-snippets'], { restore: true });
	return input
		.pipe(jsonFilter)
		.pipe(buffer())
		.pipe(es.mapSync((f: File) => {
			const errors: jsoncParser.ParseError[] = [];
			const value = jsoncParser.parse(f.contents!.toString('utf8'), errors, { allowTrailingComma: true });
			if (errors.length === 0) {
				// file parsed OK => just stringify to drop whitespace and comments
				f.contents = Buffer.from(JSON.stringify(value));
			}
			return f;
		}))
		.pipe(jsonFilter.restore);
}

function updateExtensionPackageJSON(input: Stream, update: (data: any) => any): Stream {
	const packageJsonFilter = filter('extensions/*/package.json', { restore: true });
	return input
		.pipe(packageJsonFilter)
		.pipe(buffer())
		.pipe(es.mapSync((f: File) => {
			const data = JSON.parse(f.contents!.toString('utf8'));
			f.contents = Buffer.from(JSON.stringify(update(data)));
			return f;
		}))
		.pipe(packageJsonFilter.restore);
}

// --- Start Positron ---
// Extensions that are still bundled with webpack instead of esbuild. Upstream
// removed the webpack pathway from this file during their esbuild migration,
// but positron-python still relies on it: its webpack config rewrites module
// requests so dependencies like reflect-metadata are inlined into the bundle,
// and its .vscodeignore excludes node_modules so those dependencies are not
// otherwise shipped. Without webpack, release builds fail to activate the
// extension at runtime ("Cannot find module 'reflect-metadata'").
//
// This is intentionally a hard-coded allowlist (not a generic file-existence
// check) so that new extensions cannot accidentally adopt webpack. Remove this
// list, the webpack branch in fromLocal, and fromLocalWebpack below once
// positron-python is migrated to esbuild.
const positronWebpackExtensions = new Set([
	'positron-python',
]);
// --- End Positron ---

function fromLocal(extensionPath: string, forWeb: boolean, disableMangle: boolean): Stream {

	let esbuildConfigFileName = forWeb
		? 'esbuild.browser.mts'
		: 'esbuild.mts';

	let hasEsbuild = fs.existsSync(path.join(extensionPath, esbuildConfigFileName));

	// Fallback: check for .esbuild.mts/.esbuild.ts (used by extensions with their own build system, e.g. copilot)
	if (!hasEsbuild && !forWeb) {
		for (const fallback of ['.esbuild.mts', '.esbuild.ts']) {
			if (fs.existsSync(path.join(extensionPath, fallback))) {
				esbuildConfigFileName = fallback;
				hasEsbuild = true;
				break;
			}
		}
	}

	// --- Start Positron ---
	const webpackConfigFileName = forWeb
		? 'extension-browser.webpack.config.js'
		: 'extension.webpack.config.js';
	const hasWebpack = !hasEsbuild
		&& positronWebpackExtensions.has(path.basename(extensionPath))
		&& fs.existsSync(path.join(extensionPath, webpackConfigFileName));
	// --- End Positron ---

	let input: Stream;
	let isBundled = false;

	if (hasEsbuild) {
		const isStandardEsbuild = !esbuildConfigFileName.startsWith('.');
		input = isStandardEsbuild
			? es.merge(
				fromLocalEsbuild(extensionPath, esbuildConfigFileName),
				// Standard esbuild extensions need a separate type check step
				...getBuildRootsForExtension(extensionPath).map(root => typeCheckExtensionStream(root, forWeb)),
			)
			// Extensions with their own build system (e.g. .esbuild.mts) handle type checking internally
			: fromLocalEsbuild(extensionPath, esbuildConfigFileName);
		isBundled = true;
		// --- Start Positron ---
	} else if (hasWebpack) {
		input = fromLocalWebpack(extensionPath, webpackConfigFileName, disableMangle);
		isBundled = true;
		// --- End Positron ---
	} else {
		input = fromLocalNormal(extensionPath);
	}

	if (isBundled) {
		input = updateExtensionPackageJSON(input, (data: any) => {
			delete data.scripts;
			delete data.dependencies;
			delete data.devDependencies;
			if (data.main) {
				data.main = data.main.replace('/out/', '/dist/');
			}
			return data;
		});
	}

	return input;
}

export function typeCheckExtension(extensionPath: string, forWeb: boolean): Promise<void> {
	const tsconfigFileName = forWeb ? 'tsconfig.browser.json' : 'tsconfig.json';
	const tsconfigPath = path.join(extensionPath, tsconfigFileName);
	return spawnTsgo(tsconfigPath, { taskName: 'typechecking extension (tsgo)', noEmit: true });
}

export function typeCheckExtensionStream(extensionPath: string, forWeb: boolean): Stream {
	const tsconfigFileName = forWeb ? 'tsconfig.browser.json' : 'tsconfig.json';
	const tsconfigPath = path.join(extensionPath, tsconfigFileName);
	return createTsgoStream(tsconfigPath, { taskName: 'typechecking extension (tsgo)', noEmit: true });
}

function fromLocalNormal(extensionPath: string): Stream {
	const vsce = require('@vscode/vsce') as typeof import('@vscode/vsce');
	const result = es.through();

	// --- Start PWB: from Positron ---
	// Replace vsce.listFiles with listExtensionFiles to queue the work
	listExtensionFiles({ cwd: extensionPath, packageManager: vsce.PackageManager.Npm })
		.then(fileNames => {
			createSequentialFileStream(extensionPath, fileNames).pipe(result);
		})
		.catch(err => result.emit('error', err));
	// --- End PWB: from Positron ---

	return result.pipe(createStatsStream(path.basename(extensionPath)));
}

// --- Start Positron ---
// TEMPORARY: kept solely so positron-python can be bundled with webpack until
// it is migrated to esbuild. See positronWebpackExtensions above. Delete this
// function (and its caller) once that migration lands.
//
// Implementation notes: we deliberately spawn the extension's own webpack
// install as a child process rather than require()-ing webpack from the repo
// root. The root install ends up with an ajv-keywords/ajv version mismatch
// (eslint pins ajv@6 at the root; webpack's schema-utils chain wants ajv@8)
// that npm's hoister cannot resolve under the repo's legacy-peer-deps=true
// setting. positron-python ships its own webpack 5 install where the tree is
// internally consistent, so shelling out there sidesteps the problem entirely.
function fromLocalWebpack(extensionPath: string, webpackConfigFileName: string, _disableMangle: boolean): Stream {
	const vsce = require('@vscode/vsce') as typeof import('@vscode/vsce');
	const result = es.through();
	const extensionName = path.basename(extensionPath);

	// Invoke webpack's JS entry directly with the current Node binary rather
	// than the .bin shim. Node >= 20.12 rejects spawning .cmd / .bat files
	// without shell: true (CVE-2024-27980), which broke the Windows build when
	// we shelled out to webpack.cmd. Running the .js file is cross-platform
	// and avoids needing a shell.
	const webpackJs = path.join(extensionPath, 'node_modules', 'webpack', 'bin', 'webpack.js');

	if (!fs.existsSync(webpackJs)) {
		setImmediate(() => result.emit('error', new Error(
			`fromLocalWebpack: ${webpackJs} not found. Did you run 'npm install' in ${extensionName}?`
		)));
		return result.pipe(createStatsStream(extensionName));
	}

	new Promise<void>((resolve, reject) => {
		const proc = cp.execFile(
			process.execPath,
			[webpackJs, '--config', webpackConfigFileName, '--mode', 'production', '--devtool', 'source-map'],
			{ cwd: extensionPath, maxBuffer: 200 * 1024 * 1024 },
			(err, _stdout, stderr) => {
				if (err) {
					fancyLog.error(stderr);
					return reject(err);
				}
				fancyLog(`Bundled extension: ${ansiColors.yellow(path.join(extensionName, webpackConfigFileName))}`);
				resolve();
			}
		);
		proc.stdout?.on('data', data => {
			fancyLog(`${ansiColors.green('webpacking')} ${extensionName}: ${data.toString('utf8').trimEnd()}`);
		});
	}).then(() => {
		// Webpack inlines runtime dependencies, so PackageManager.None keeps
		// node_modules out of the packaged extension.
		return listExtensionFiles({ cwd: extensionPath, packageManager: vsce.PackageManager.None });
	}).then(fileNames => {
		const files = fileNames
			.map(fileName => path.join(extensionPath, fileName))
			.map(filePath => new File({
				path: filePath,
				stat: fs.statSync(filePath),
				base: extensionPath,
				contents: fs.createReadStream(filePath)
			}));

		es.readArray(files).pipe(result);
	}).catch(err => {
		console.error(extensionPath);
		result.emit('error', err);
	});

	return result.pipe(createStatsStream(extensionName));
}
// --- End Positron ---

function fromLocalEsbuild(extensionPath: string, esbuildConfigFileName: string): Stream {
	const vsce = require('@vscode/vsce') as typeof import('@vscode/vsce');
	const result = es.through();
	const extensionName = path.basename(extensionPath);

	// Extensions built with esbuild can still externalize runtime dependencies.
	// Ensure those externals are included in the packaged built-in extension.
	const packagedDependenciesByExtension: Record<string, string[]> = {
		'git': ['@vscode/fs-copyfile']
	};
	const packagedDependencies = packagedDependenciesByExtension[extensionName] ?? [];

	const esbuildScript = path.join(extensionPath, esbuildConfigFileName);

	// Run esbuild, then collect the files
	new Promise<void>((resolve, reject) => {
		const proc = cp.execFile(process.argv[0], [esbuildScript], { cwd: extensionPath }, (error, _stdout, stderr) => {
			if (error) {
				return reject(error);
			}

			const matches = (stderr || '').match(/\> (.+): error: (.+)?/g);
			fancyLog(`Bundled extension: ${ansiColors.yellow(path.join(path.basename(extensionPath), esbuildConfigFileName))} with ${matches ? matches.length : 0} errors.`);
			for (const match of matches || []) {
				fancyLog.error(match);
			}
			return resolve();
		});

		proc.stdout!.on('data', (data) => {
			fancyLog(`${ansiColors.green('esbuilding')}: ${data.toString('utf8')}`);
		});
	}).then(() => {
		// After esbuild completes, collect all files using vsce
		// --- Start Positron ---

		// The upstream strategy is currently to ignore external
		// dependencies, and some built-in extensions (e.g. git) do not
		// package correctly with the Npm strategy. However, several
		// Positron extensions have npm dependencies that need to be
		// packaged. This list is used to determine which extensions
		// should be packaged with the Npm strategy.
		const extensionsWithNpmDeps = [
			'positron-proxy',
			'positron-duckdb',
			'positron-catalog-explorer',
			'positron-pdf-server',
			'positron-data-driver-duckdb',
			'positron-data-driver-pins',
			'positron-data-driver-postgresql',
			'positron-data-driver-redshift',
			'positron-data-driver-sqlite'
		];

		// If the extension has npm dependencies, use the Npm package manager
		// dependency strategy.
		const packageJsonConfig = require(path.join(extensionPath, 'package.json'));
		const packageManager = extensionsWithNpmDeps.includes(packageJsonConfig.name) ?
			vsce.PackageManager.Npm :
			vsce.PackageManager.None;
		// --- End Positron ---
		// --- Start PWB ---
		// Replace vsce.listFiles with listExtensionFiles to queue the work
		return listExtensionFiles({ cwd: extensionPath, packageManager: packageManager });
		// --- End PWB ---
	}).then(fileNames => {
		if (packagedDependencies.length > 0) {
			const packagedDependencyFileNames = packagedDependencies.flatMap(dependency =>
				glob.sync(path.join(extensionPath, 'node_modules', dependency, '**'), { nodir: true, dot: true })
					.map(filePath => path.relative(extensionPath, filePath))
					.filter(filePath => {
						// Exclude non-.node files from build directories to avoid timestamp-sensitive
						// artifacts (e.g. Makefile) that break macOS universal builds due to SHA mismatches.
						const parts = filePath.split(path.sep);
						const buildIndex = parts.indexOf('build');
						if (buildIndex !== -1) {
							return filePath.endsWith('.node');
						}
						return true;
					})
			);

			fileNames = Array.from(new Set([...fileNames, ...packagedDependencyFileNames]));
		}

		const files = fileNames
			.map(fileName => path.join(extensionPath, fileName))
			.map(filePath => new File({
				path: filePath,
				stat: fs.statSync(filePath),
				base: extensionPath,
				contents: fs.createReadStream(filePath)
			}));

		es.readArray(files).pipe(result);
	}).catch(err => {
		console.error(extensionPath);
		console.error(packagedDependencies);
		result.emit('error', err);
	});

	return result.pipe(createStatsStream(path.basename(extensionPath)));
}

const userAgent = 'VSCode Build';
const baseHeaders = {
	'X-Market-Client-Id': 'VSCode Build',
	'User-Agent': userAgent,
	'X-Market-User-Id': '291C1CD0-051A-4123-9B4B-30D60EF52EE2',
};

// --- Start Positron ---

function getPlatformDownloads(): string[] {
	// Respect npm_config_arch when cross-building (e.g. building x64 on arm64 macOS).
	const targetArch = process.env['npm_config_arch'] || os.arch();
	switch (targetArch) {
		case 'arm64':
			return [`${process.platform}-arm64`];
		case 'x64':
		case 'x86_64':
			return [`${process.platform}-x64`];
		default:
			throw new Error(`Unsupported architecture: ${targetArch}`);
	}
}

function createPlatformSpecificUrl(resourceUrlTemplate: string, publisher: string, name: string, version: string, platformDownload: string): string {
	// Construct the platform-specific VSIX URL from the resource URL template, replacing the web resource
	// path suffix with the VSIX package asset type and appending the target platform query parameter.
	return resourceUrlTemplate
		.replace('{publisher}', publisher)
		.replace('{name}', name)
		.replace('{version}', version)
		.replace(/Microsoft\.VisualStudio\.Code\.WebResources\/\{path\}$/, `Microsoft.VisualStudio.Services.VSIXPackage?targetPlatform=${platformDownload}`);
}

export function fromMarketplace(resourceUrlTemplate: string, { name: extensionName, version, sha256, metadata }: IExtensionDefinition, bootstrap: boolean = false): Stream {
	// --- End Positron ---
	const [publisher, name] = extensionName.split('.');
	// --- Start Positron ---
	let urls: string[];
	let platformDownloads: string[] = [];

	if (metadata.multiPlatformServiceUrl) {
		// Download a platform-specific VSIX for each target platform.
		platformDownloads = getPlatformDownloads();
		urls = platformDownloads.map(platformDownload => createPlatformSpecificUrl(resourceUrlTemplate, publisher, name, version, platformDownload));
		fancyLog('Downloading multi-platform extension:', ansiColors.yellow(`${extensionName}@${version}`),
			`for ${platformDownloads.join(', ')}...`);
	} else {
		// Construct the single-platform VSIX URL from the resource URL template.
		urls = [resourceUrlTemplate
			.replace('{publisher}', publisher)
			.replace('{name}', name)
			.replace('{version}', version)
			.replace(/Microsoft\.VisualStudio\.Code\.WebResources\/\{path\}$/, 'Microsoft.VisualStudio.Services.VSIXPackage')
		];
		fancyLog('Downloading extension:', ansiColors.yellow(`${extensionName}@${version}`), '...');
	}
	// --- End Positron ---


	const packageJsonFilter = filter('package.json', { restore: true });

	// --- Start Positron ---
	if (bootstrap) {
		return fetchUrls('', {
			base: urls[0],
			nodeFetchOptions: {
				headers: baseHeaders
			},
			checksumSha256: sha256,
			expectZip: true
		})
			.pipe(buffer());
	} else {
		if (urls.length > 1) {
			fancyLog(`Developer error: Unexpected number of URLS for built-in extension.`);
		}
		return fetchUrls('', {
			base: urls[0],
			nodeFetchOptions: {
				headers: baseHeaders
			},
			checksumSha256: sha256,
			expectZip: true
		})
			.pipe(vinylZip.src())
			.pipe(filter('extension/**'))
			.pipe(rename(p => p.dirname = p.dirname!.replace(/^extension\/?/, '')))
			.pipe(packageJsonFilter)
			.pipe(buffer())
			.pipe(jsonEditor({ __metadata: metadata }))
			.pipe(packageJsonFilter.restore);
	}
	// --- End Positron ---
}

// --- Start PWB: Bundle PWB extension ---
export function fromPositUrl({ name: extensionName, version, sha256, positUrl, metadata }: IExtensionDefinition): Stream {
	const [, name] = extensionName.split('.');
	const url = `${positUrl}/${name}-${version}.vsix`;

	fancyLog('Downloading extension from Posit CDN:', ansiColors.yellow(`${extensionName}@${version}`), '...');

	const packageJsonFilter = filter('package.json', { restore: true });

	return fetchUrls('', {
		base: url,
		nodeFetchOptions: {
			headers: baseHeaders
		},
		checksumSha256: sha256
	})
		.pipe(vinylZip.src())
		.pipe(filter('extension/**'))
		.pipe(rename(p => p.dirname = p.dirname!.replace(/^extension\/?/, '')))
		.pipe(packageJsonFilter)
		.pipe(buffer())
		.pipe(jsonEditor({ __metadata: metadata }))
		.pipe(packageJsonFilter.restore);
}
// --- End PWB: Bundle PWB extension ---

export function fromVsix(vsixPath: string, { name: extensionName, version, sha256, metadata }: IExtensionDefinition): Stream {
	fancyLog('Using local VSIX for extension:', ansiColors.yellow(`${extensionName}@${version}`), '...');

	const packageJsonFilter = filter('package.json', { restore: true });

	return gulp.src(vsixPath)
		.pipe(buffer())
		.pipe(es.mapSync((f: File) => {
			const hash = crypto.createHash('sha256');
			hash.update(f.contents as Buffer);
			const checksum = hash.digest('hex');
			if (checksum !== sha256) {
				throw new Error(`Checksum mismatch for ${vsixPath} (expected ${sha256}, actual ${checksum}))`);
			}
			return f;
		}))
		.pipe(vinylZip.src())
		.pipe(filter('extension/**'))
		.pipe(rename(p => p.dirname = p.dirname!.replace(/^extension\/?/, '')))
		.pipe(packageJsonFilter)
		.pipe(buffer())
		.pipe(jsonEditor({ __metadata: metadata }))
		.pipe(packageJsonFilter.restore);
}

export function fromGithub({ name, version, repo, sha256, metadata }: IExtensionDefinition): Stream {
	fancyLog('Downloading extension from GH:', ansiColors.yellow(`${name}@${version}`), '...');

	const packageJsonFilter = filter('package.json', { restore: true });

	return fetchGithub(new URL(repo).pathname, {
		version,
		name: name => name.endsWith('.vsix'),
		checksumSha256: sha256
	})
		.pipe(buffer())
		.pipe(vinylZip.src())
		.pipe(filter('extension/**'))
		.pipe(rename(p => p.dirname = p.dirname!.replace(/^extension\/?/, '')))
		.pipe(packageJsonFilter)
		.pipe(buffer())
		.pipe(jsonEditor({ __metadata: metadata }))
		.pipe(packageJsonFilter.restore);
}

/**
 * All extensions that are known to have some native component and thus must be built on the
 * platform that is being built.
 */
const nativeExtensions = [
	'git',
	'microsoft-authentication',
];

const excludedExtensions = [
	'copilot',
	'vscode-api-tests',
	'vscode-colorize-tests',
	'vscode-colorize-perf-tests',
	'vscode-test-resolver',
	'ms-vscode.node-debug',
	'ms-vscode.node-debug2',
	// --- Start Positron ---
	'positron-zed',
	'positron-javascript',
	// Build-time-only package: generated Data Explorer protocol types/enums that
	// the data driver extensions bundle via esbuild. It is not an extension and
	// must not be packaged or activated at runtime.
	'positron-data-explorer-protocol',
	// --- End Positron ---
];

// --- Start Positron ---
// Conditionally exclude open-remote-wsl on non-Windows platforms
if (os.platform() !== 'win32') {
	excludedExtensions.push('open-remote-wsl');
}
// --- End Positron ---

const marketplaceWebExtensionsExclude = new Set([
	'ms-vscode.node-debug',
	'ms-vscode.node-debug2',
	'ms-vscode.js-debug-companion',
	'ms-vscode.js-debug',
	'ms-vscode.vscode-js-profile-table'
]);

const productJson = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../../product.json'), 'utf8'));
const builtInExtensions: IExtensionDefinition[] = productJson.builtInExtensions || [];
const webBuiltInExtensions: IExtensionDefinition[] = productJson.webBuiltInExtensions || [];
// --- Start Positron ---
const bootstrapExtensions: IExtensionDefinition[] = productJson.bootstrapExtensions || [];
// --- End Positron ---

type ExtensionKind = 'ui' | 'workspace' | 'web';
interface IExtensionManifest {
	main?: string;
	browser?: string;
	extensionKind?: ExtensionKind | ExtensionKind[];
	extensionPack?: string[];
	extensionDependencies?: string[];
	contributes?: { [id: string]: any };
}
/**
 * Loosely based on `getExtensionKind` from `src/vs/workbench/services/extensions/common/extensionManifestPropertiesService.ts`
 */
export function isWebExtension(manifest: IExtensionManifest): boolean {
	if (Boolean(manifest.browser)) {
		return true;
	}
	if (Boolean(manifest.main)) {
		return false;
	}
	// neither browser nor main
	if (typeof manifest.extensionKind !== 'undefined') {
		const extensionKind = Array.isArray(manifest.extensionKind) ? manifest.extensionKind : [manifest.extensionKind];
		if (extensionKind.indexOf('web') >= 0) {
			return true;
		}
	}
	if (typeof manifest.contributes !== 'undefined') {
		for (const id of ['debuggers', 'terminal', 'typescriptServerPlugins']) {
			if (manifest.contributes.hasOwnProperty(id)) {
				return false;
			}
		}
	}
	return true;
}

/**
 * Package local extensions that are known to not have native dependencies. Mutually exclusive to {@link packageNativeLocalExtensionsStream}.
 * @param forWeb build the extensions that have web targets
 * @param disableMangle disable the mangler
 * @returns a stream
 */
export function packageNonNativeLocalExtensionsStream(forWeb: boolean, disableMangle: boolean): Stream {
	return doPackageLocalExtensionsStream(forWeb, disableMangle, false);
}

/**
 * Package local extensions that are known to have native dependencies. Mutually exclusive to {@link packageNonNativeLocalExtensionsStream}.
 * @note it's possible that the extension does not have native dependencies for the current platform, especially if building for the web,
 * but we simplify the logic here by having a flat list of extensions (See {@link nativeExtensions}) that are known to have native
 * dependencies on some platform and thus should be packaged on the platform that they are building for.
 * @param forWeb build the extensions that have web targets
 * @param disableMangle disable the mangler
 * @returns a stream
 */
export function packageNativeLocalExtensionsStream(forWeb: boolean, disableMangle: boolean): Stream {
	return doPackageLocalExtensionsStream(forWeb, disableMangle, true);
}

/**
 * Package all the local extensions... both those that are known to have native dependencies and those that are not.
 * @param forWeb build the extensions that have web targets
 * @param disableMangle disable the mangler
 * @returns a stream
 */
export function packageAllLocalExtensionsStream(forWeb: boolean, disableMangle: boolean): Stream {
	return es.merge([
		packageNonNativeLocalExtensionsStream(forWeb, disableMangle),
		packageNativeLocalExtensionsStream(forWeb, disableMangle)
	]);
}

/**
 * @param forWeb build the extensions that have web targets
 * @param disableMangle disable the mangler
 * @param native build the extensions that are marked as having native dependencies
 */
function doPackageLocalExtensionsStream(forWeb: boolean, disableMangle: boolean, native: boolean): Stream {
	const nativeExtensionsSet = new Set(nativeExtensions);
	const localExtensionsDescriptions = (
		(glob.sync('extensions/*/package.json') as string[])
			.map(manifestPath => {
				const absoluteManifestPath = path.join(root, manifestPath);
				const extensionPath = path.dirname(path.join(root, manifestPath));
				const extensionName = path.basename(extensionPath);
				return { name: extensionName, path: extensionPath, manifestPath: absoluteManifestPath };
			})
			.filter(({ name }) => native ? nativeExtensionsSet.has(name) : !nativeExtensionsSet.has(name))
			.filter(({ name }) => excludedExtensions.indexOf(name) === -1)
			.filter(({ name }) => builtInExtensions.every(b => b.name !== name))
			.filter(({ manifestPath }) => (forWeb ? isWebExtension(require(manifestPath)) : true))
	);

	// --- Start Positron ---

	// Process the local extensions serially to avoid running out of file
	// descriptors (EMFILE) when building.

	const serialStream = es.through();
	const queue = [...localExtensionsDescriptions];

	function processNext() {
		if (queue.length === 0) {
			serialStream.end();
			return;
		}

		const extension = queue.shift();
		if (!extension) {
			return;
		}
		const stream = fromLocal(extension.path, forWeb, disableMangle)
			.pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`))
			.pipe(es.through(undefined, processNext));

		stream.pipe(serialStream, { end: false });
	}

	processNext();

	const localExtensionsStream = minifyExtensionResources(serialStream);
	// --- End Positron ---

	let result: Stream;
	if (forWeb) {
		result = localExtensionsStream;
	} else {
		// also include shared production node modules
		const productionDependencies = getProductionDependencies('extensions/');
		const dependenciesSrc = productionDependencies.map(d => path.relative(root, d)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`]).flat();

		if (dependenciesSrc.length) {
			result = es.merge(
				localExtensionsStream,
				gulp.src(dependenciesSrc, { base: '.' })
					.pipe(util2.cleanNodeModules(path.join(root, 'build', '.moduleignore')))
					.pipe(util2.cleanNodeModules(path.join(root, 'build', `.moduleignore.${process.platform}`))));
		} else {
			result = localExtensionsStream;
		}
	}

	return (
		result
			.pipe(util2.setExecutableBit(['**/*.sh']))
	);
}

/**
 * Package the built-in copilot extension specifically.
 * This is used by non-CI local builds where copilot is not downloaded as a VSIX
 * but must be compiled from source and included in the build.
 */
export function packageCopilotExtensionStream(disableMangle: boolean): Stream {
	const extensionPath = path.join(root, 'extensions', 'copilot');
	if (!fs.existsSync(extensionPath)) {
		return es.readArray([]);
	}

	const localExtensionsStream = minifyExtensionResources(
		// --- Start Positron ---
		// Stamp `buildType: 'prod'` in the packaged manifest. Upstream's
		// extensions/copilot/.esbuild.ts has an applyPackageJsonPatch() that does
		// this, but it is gated on VSCODE_QUALITY (their marketplace publishing
		// flow) and Positron's release builders do not set that env var. Without
		// the flip the shipped package.json keeps `buildType: 'dev'` from source,
		// and the extension's runtime check
		// `isProduction = (buildType !== 'dev')` (in
		// src/platform/env/common/packagejson.ts) is false. That routes
		// activation through configureDevPackages(), which require()s
		// `source-map-support` and `dotenv` -- both devDependencies that are not
		// present in the production node_modules of the packaged extension.
		updateExtensionPackageJSON(fromLocal(extensionPath, false, disableMangle), (data: any) => {
			data.buildType = 'prod';
			return data;
		})
			.pipe(rename(p => p.dirname = `extensions/copilot/${p.dirname}`))
		// --- End Positron ---
	);

	const productionDependencies = getProductionDependencies('extensions/copilot');
	const dependenciesSrc = productionDependencies.map(d => path.relative(root, d)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`]).flat();

	return es.merge(
		localExtensionsStream,
		gulp.src(dependenciesSrc, { base: '.' })
			.pipe(util2.cleanNodeModules(path.join(root, 'build', '.moduleignore')))
			.pipe(util2.cleanNodeModules(path.join(root, 'build', `.moduleignore.${process.platform}`)))
	).pipe(util2.setExecutableBit(['**/*.sh']));
}

export function packageMarketplaceExtensionsStream(forWeb: boolean): Stream {
	const marketplaceExtensionsDescriptions = [
		...builtInExtensions.filter(({ name }) => (forWeb ? !marketplaceWebExtensionsExclude.has(name) : true)),
		...(forWeb ? webBuiltInExtensions : [])
	];
	const marketplaceExtensionsStream = minifyExtensionResources(
		es.merge(
			...marketplaceExtensionsDescriptions
				.map(extension => {
					const src = getExtensionStream(extension).pipe(rename(p => p.dirname = `extensions/${p.dirname}`));
					return updateExtensionPackageJSON(src, (data: any) => {
						delete data.scripts;
						delete data.dependencies;
						delete data.devDependencies;
						return data;
					});
				})
		)
	);

	return (
		marketplaceExtensionsStream
			.pipe(util2.setExecutableBit(['**/*.sh']))
	);
}

// --- Start Positron ---
export function packageBootstrapExtensionsStream(): Stream {
	return es.merge(
		...bootstrapExtensions
			.map(extension => {
				const src = getBootstrapExtensionStream(extension).pipe(rename(p => {
					p.dirname = `extensions/bootstrap/${p.dirname}`;
				}));
				return src;
			})
	);
}
// --- End Positron ---

export interface IScannedBuiltinExtension {
	readonly extensionPath: string;
	readonly packageJSON: unknown;
	readonly packageNLS: unknown | undefined;
	readonly readmePath: string | undefined;
	readonly changelogPath: string | undefined;
}

export function scanBuiltinExtensions(extensionsRoot: string, exclude: string[] = []): IScannedBuiltinExtension[] {
	const scannedExtensions: IScannedBuiltinExtension[] = [];

	try {
		const extensionsFolders = fs.readdirSync(extensionsRoot);
		for (const extensionFolder of extensionsFolders) {
			if (exclude.indexOf(extensionFolder) >= 0) {
				continue;
			}
			const packageJSONPath = path.join(extensionsRoot, extensionFolder, 'package.json');
			if (!fs.existsSync(packageJSONPath)) {
				continue;
			}
			const packageJSON = JSON.parse(fs.readFileSync(packageJSONPath).toString('utf8'));
			if (!isWebExtension(packageJSON)) {
				continue;
			}
			const children = fs.readdirSync(path.join(extensionsRoot, extensionFolder));
			const packageNLSPath = children.filter(child => child === 'package.nls.json')[0];
			const packageNLS = packageNLSPath ? JSON.parse(fs.readFileSync(path.join(extensionsRoot, extensionFolder, packageNLSPath)).toString()) : undefined;
			const readme = children.filter(child => /^readme(\.txt|\.md|)$/i.test(child))[0];
			const changelog = children.filter(child => /^changelog(\.txt|\.md|)$/i.test(child))[0];

			scannedExtensions.push({
				extensionPath: extensionFolder,
				packageJSON,
				packageNLS,
				readmePath: readme ? path.join(extensionFolder, readme) : undefined,
				changelogPath: changelog ? path.join(extensionFolder, changelog) : undefined,
			});
		}
		return scannedExtensions;
	} catch (ex) {
		return scannedExtensions;
	}
}

export function translatePackageJSON(packageJSON: string, packageNLSPath: string) {
	interface NLSFormat {
		[key: string]: string | { message: string; comment: string[] };
	}
	const CharCode_PC = '%'.charCodeAt(0);
	const packageNls: NLSFormat = JSON.parse(fs.readFileSync(packageNLSPath).toString());
	const translate = (obj: any) => {
		for (const key in obj) {
			const val = obj[key];
			if (Array.isArray(val)) {
				val.forEach(translate);
			} else if (val && typeof val === 'object') {
				translate(val);
			} else if (typeof val === 'string' && val.charCodeAt(0) === CharCode_PC && val.charCodeAt(val.length - 1) === CharCode_PC) {
				const translated = packageNls[val.substr(1, val.length - 2)];
				if (translated) {
					obj[key] = typeof translated === 'string' ? translated : (typeof translated.message === 'string' ? translated.message : val);
				}
			}
		}
	};
	translate(packageJSON);
	return packageJSON;
}

const extensionsPath = path.join(root, 'extensions');

export async function esbuildExtensions(taskName: string, isWatch: boolean, scripts: { script: string; outputRoot?: string }[]): Promise<void> {
	function reporter(stdError: string, script: string) {
		const matches = (stdError || '').match(/\> (.+): error: (.+)?/g);
		fancyLog(`Finished ${ansiColors.green(taskName)} ${script} with ${matches ? matches.length : 0} errors.`);
		for (const match of matches || []) {
			fancyLog.error(match);
		}
	}

	const tasks = scripts.map(({ script, outputRoot }) => {
		return new Promise<void>((resolve, reject) => {
			const args = [script];
			if (isWatch) {
				args.push('--watch');
			}
			if (outputRoot) {
				args.push('--outputRoot', outputRoot);
			}
			const proc = cp.execFile(process.argv[0], args, {}, (error, _stdout, stderr) => {
				if (error) {
					return reject(error);
				}
				reporter(stderr, script);
				return resolve();
			});

			proc.stdout!.on('data', (data) => {
				fancyLog(`${ansiColors.green(taskName)}: ${data.toString('utf8')}`);
			});
		});
	});

	await Promise.all(tasks);
}


// Additional projects to run esbuild on. These typically build code for webviews
const esbuildMediaScripts: { script: string; tsconfig: string }[] = [
	{ script: 'ipynb/esbuild.notebook.mts', tsconfig: 'ipynb/notebook-src/tsconfig.json' },
	{ script: 'markdown-language-features/esbuild.notebook.mts', tsconfig: 'markdown-language-features/notebook/tsconfig.json' },
	{ script: 'markdown-language-features/esbuild.webview.mts', tsconfig: 'markdown-language-features/preview-src/tsconfig.json' },
	{ script: 'markdown-math/esbuild.notebook.mts', tsconfig: 'markdown-math/notebook/tsconfig.json' },
	{ script: 'mermaid-markdown-features/esbuild.webview.mts', tsconfig: 'mermaid-markdown-features/preview-src/tsconfig.json' },
	{ script: 'notebook-renderers/esbuild.notebook.mts', tsconfig: 'notebook-renderers/tsconfig.json' },
	{ script: 'simple-browser/esbuild.webview.mts', tsconfig: 'simple-browser/preview-src/tsconfig.json' },
	// --- Start Positron ---
	{ script: 'positron-ipywidgets/renderer/esbuild.js', tsconfig: 'positron-ipywidgets/renderer/tsconfig.json' },
	// --- End Positron ---
];

export function buildExtensionMedia(isWatch: boolean, outputRoot?: string): Promise<void> {
	const esbuildTask = esbuildExtensions('esbuilding extension media', isWatch, esbuildMediaScripts.map(({ script }) => ({
		script: path.join(extensionsPath, script),
		outputRoot: outputRoot ? path.join(root, outputRoot, path.dirname(script)) : undefined
	})));

	const typeCheckTasks = esbuildMediaScripts.map(({ tsconfig }) => {
		const tsconfigPath = path.join(extensionsPath, tsconfig);
		const config = { taskName: 'typechecking extension media (tsgo)', noEmit: true };
		if (!isWatch) {
			return spawnTsgo(tsconfigPath, config);
		} else {
			return watchTypeCheckExtensionMedia(tsconfigPath, config);
		}
	});

	return Promise.all([esbuildTask, ...typeCheckTasks]).then(() => undefined);
}

function watchTypeCheckExtensionMedia(tsconfigPath: string, config: { taskName: string; noEmit?: boolean }): Promise<void> {
	const srcDir = path.dirname(tsconfigPath);
	const watchInput = watcher([
		path.join(srcDir, '**', '*.{ts,tsx,d.ts}'),
		tsconfigPath,
		'!' + path.join(srcDir, '**', 'node_modules', '**'),
		'!' + path.join(srcDir, '**', 'out', '**'),
		'!' + path.join(srcDir, '**', 'dist', '**'),
	], { cwd: root, base: srcDir, dot: true, readDelay: 200 });
	const stream = watchInput
		.pipe(util2.debounce(() => {
			const tsgoStream = createTsgoStream(tsconfigPath, config);
			// Always emit 'end' (even on tsgo error) so the debounce resets to idle
			// and can process future file changes. Errors are already logged by
			// spawnTsgo's runReporter, so swallowing the stream error is safe.
			const result = es.through();
			tsgoStream.on('end', () => result.emit('end'));
			tsgoStream.on('error', () => result.emit('end'));
			return result;
		}, 200));

	return new Promise<void>((_resolve, reject) => {
		stream.on('error', reject);
	});
}

export function getBuildRootsForExtension(extensionPath: string): string[] {
	// These extensions split their code between a client and server folder. We should treat each as build roots
	if (extensionPath.endsWith('css-language-features') || extensionPath.endsWith('html-language-features') || extensionPath.endsWith('json-language-features')) {
		return [
			path.join(extensionPath, 'client'),
			path.join(extensionPath, 'server'),
		];
	}

	return [extensionPath];
}

// --- Start PWB: from Positron ---

/**
 * Create a stream that emits files in the order of `fileNames`, one at a time,
 * reading each file from disk before emitting it.
 *
 * This is used to serialize file reads when packaging extensions, to avoid
 * running out of file descriptors (EMFILE) when building.
 *
 * @param extensionPath The root path of the extension
 * @param fileNames The list of file names to emit, relative to `extensionPath`
 * @returns A stream that emits the files in order
 */
function createSequentialFileStream(extensionPath: string, fileNames: string[]): Stream {
	const stream = es.through();
	const queue = [...fileNames];
	let ended = false;

	const finish = () => {
		if (!ended) {
			ended = true;
			stream.emit('end');
		}
	};

	stream.on('close', () => {
		ended = true;
		queue.length = 0;
	});

	stream.on('error', () => {
		ended = true;
		queue.length = 0;
	});

	const pump = () => {
		if (ended) {
			return;
		}
		if (queue.length === 0) {
			finish();
			return;
		}

		const relativePath = queue.shift()!;
		const absolutePath = path.join(extensionPath, relativePath);
		let stats: fs.Stats;
		try {
			stats = fs.statSync(absolutePath);
		} catch (error) {
			ended = true;
			queue.length = 0;
			stream.emit('error', error);
			return;
		}

		let fileStream: fs.ReadStream;
		try {
			fileStream = fs.createReadStream(absolutePath);
		} catch (error) {
			ended = true;
			queue.length = 0;
			stream.emit('error', error);
			return;
		}

		let settled = false;
		const cleanup = () => {
			if (settled) {
				return;
			}
			settled = true;
			fileStream.removeListener('end', cleanup);
			fileStream.removeListener('close', cleanup);
			fileStream.removeListener('error', onError);
			setImmediate(pump);
		};

		const onError = (err: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			fileStream.removeListener('end', cleanup);
			fileStream.removeListener('close', cleanup);
			fileStream.removeListener('error', onError);
			ended = true;
			queue.length = 0;
			stream.emit('error', err);
		};

		fileStream.on('end', cleanup);
		fileStream.on('close', cleanup);
		fileStream.on('error', onError);

		const file = new File({
			path: absolutePath,
			stat: stats,
			base: extensionPath,
			contents: fileStream as any
		});

		stream.emit('data', file);
	};

	setImmediate(pump);

	return stream;
}


// Node 20 consistently crashes when there are too many `vsce.listFiles`
// operations in flight at once; these operations are expensive as they recurse
// back into `yarn`. The code below serializes these operations when building
// Positron to avoid these crashes.

/**
 * A class representing a promise to list the files in an extension
 */
class ListPromise extends util2.PromiseHandles<string[]> {
	readonly opts: any;

	constructor(opts: any) {
		super();
		this.opts = opts;
	}
}

/** A queue of pending list promises */
const listQueue: Array<ListPromise> = [];

/** Whether we are currently processing a list promise */
let listBusy = false;

/**
 * Lists the files in an extension.
 *
 * @param opts The list options
 * @returns A promise that resolves with the list of files
 */
function listExtensionFiles(opts: any): Promise<string[]> {
	// Create a promise to represent the deferred work
	const promise = new ListPromise(opts);
	listQueue.push(promise);

	// Tickle processing of the work queue
	processListQueue();

	// Return the deferred promise
	return promise.promise;
}

/**
 * Processes the queue of pending work
 */
function processListQueue() {
	const vsce = require('@vscode/vsce') as typeof import('@vscode/vsce');

	// Ignore if we are currently doing work
	if (listBusy) {
		return;
	}

	// Ignore if there's no work to do
	if (listQueue.length === 0) {
		return;
	}

	// Splice off the next piece of work from the front of the array; since new
	// work is pushed to the end, this gives us a FIFO queue
	const next = listQueue.splice(0, 1)[0];

	// Mark as busy so we don't try to do more work
	listBusy = true;

	// Do the work!
	vsce.listFiles(next.opts).then((fileNames) => {
		next.resolve(fileNames);
	}).catch((e) => {
		next.reject(e);
	}).finally(() => {
		// When work is complete, mark no longer busy and move to the next
		// element in the queue, if any
		listBusy = false;
		processListQueue();
	});
}

// This Gulp task is used to copy binaries verbatim from built-in extensions to
// the output folder. VS Code's built-in extensions are webpacked, and weback
// doesn't support copying binaries in any useful way (even with
// CopyWebpackPlugin, binaries are UTF corrupted and lose executable
// permissions), so we need to do it in a separate task.
export async function copyExtensionBinaries(outputRoot: string) {
	return new Promise<void>((resolve, _reject) => {
		// Collect all the Positron extension metadata for binaries that need to
		// be copied.  The Positron extension metadata lives in the
		// `positron.json` file in the extension's root directory.
		const binaryMetadata = (
			(glob.sync('extensions/*/positron.json') as string[])
				.filter(metadataPath => {
					// Don't copy binaries for excluded extensions.
					const extension = path.basename(path.dirname(metadataPath));
					return excludedExtensions.indexOf(extension) === -1;
				})
				.map(metadataPath => {
					// Read the metadata file.
					const metadata = JSON.parse(fs.readFileSync(metadataPath).toString('utf8'));

					// Resolve the paths to the binaries.
					if (metadata.binaries) {
						return metadata.binaries.reduce((result: any[], bin: any) => {
							// Filter out binaries that aren't for this platform.
							if (bin.platforms && !bin.platforms.includes(process.platform)) {
								return result;
							}

							// Check the executable bit. Gulp can lose this on
							// copy, so we may need to restore it later.
							const src = path.join(path.dirname(metadataPath), bin.from);
							let isExecutable = false;
							if (fs.existsSync(src)) {
								const stat = fs.statSync(src);
								isExecutable = (stat.mode & 0o100) !== 0;
							}
							result.push({
								...bin,
								exe: isExecutable,
								base: path.basename(path.dirname(metadataPath)),
							});

							return result;
						}, []);
					}
					return null;
				})
		).flat();

		fancyLog(`Copying ${binaryMetadata.length} binary sets for built-in Positron extensions`);

		// Create a stream of all the binaries.
		es.merge(
			// Map the metadata to a stream of Vinyl files from the source to the
			// destination.
			...binaryMetadata.map((bin: any) => {
				const srcLoc = path.resolve('extensions', bin.base, bin.from);
				const destLoc = path.resolve(outputRoot, bin.base, bin.to);
				return gulp.src(srcLoc).pipe(
					gulp.dest(destLoc)
				);
			}),

			// Restore the executable bit on the binaries that had it.
			util2.setExecutableBit(binaryMetadata
				.filter((bin: any) => bin.exe)
				.map((bin: any) => path.join(outputRoot, bin.base, bin.to))));

		resolve();
	});
}
// --- End PWB: from Positron ---
