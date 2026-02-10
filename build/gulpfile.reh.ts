/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import gulp from 'gulp';
import * as path from 'path';
import es from 'event-stream';
import * as util from './lib/util.ts';
import { getVersion } from './lib/getVersion.ts';
import * as task from './lib/task.ts';
import * as optimize from './lib/optimize.ts';
import { inlineMeta } from './lib/inlineMeta.ts';
import product from '../product.json' with { type: 'json' };
import rename from 'gulp-rename';
import replace from 'gulp-replace';
import filter from 'gulp-filter';
import { getProductionDependencies } from './lib/dependencies.ts';
import { readISODate } from './lib/date.ts';
import vfs from 'vinyl-fs';
import packageJson from '../package.json' with { type: 'json' };
import flatmap from 'gulp-flatmap';
import gunzip from 'gulp-gunzip';
import untar from 'gulp-untar';
import File from 'vinyl';
import * as fs from 'fs';
import glob from 'glob';
import { compileBuildWithManglingTask } from './gulpfile.compile.ts';
import { cleanExtensionsBuildTask, compileNonNativeExtensionsBuildTask, compileNativeExtensionsBuildTask, compileExtensionMediaBuildTask } from './gulpfile.extensions.ts';
import { vscodeWebResourceIncludes, createVSCodeWebFileContentMapper } from './gulpfile.vscode.web.ts';
import * as cp from 'child_process';
import log from 'fancy-log';
import buildfile from './buildfile.ts';
import { fetchUrls, fetchGithub } from './lib/fetch.ts';
import jsonEditor from 'gulp-json-editor';

// --- Start Positron ---
import { positronBuildNumber } from './utils.ts';
// eslint-disable-next-line no-duplicate-imports
import { copyExtensionBinariesTask } from './gulpfile.extensions.ts';
// eslint-disable-next-line no-duplicate-imports
import { compileBuildWithoutManglingTask } from './gulpfile.compile.ts';
import { getQuartoBinaries } from './lib/quarto.ts';
// --- End Positron ---

const REPO_ROOT = path.dirname(import.meta.dirname);
const commit = getVersion(REPO_ROOT);
const BUILD_ROOT = path.dirname(REPO_ROOT);
const REMOTE_FOLDER = path.join(REPO_ROOT, 'remote');
// --- Start Positron ---
const REMOTE_REH_WEB_FOLDER = path.join(REPO_ROOT, 'remote', 'reh-web');
// --- End Positron ---

// Targets

const BUILD_TARGETS = [
	{ platform: 'win32', arch: 'x64' },
	{ platform: 'win32', arch: 'arm64' },
	{ platform: 'darwin', arch: 'x64' },
	{ platform: 'darwin', arch: 'arm64' },
	{ platform: 'linux', arch: 'x64' },
	{ platform: 'linux', arch: 'armhf' },
	{ platform: 'linux', arch: 'arm64' },
	{ platform: 'alpine', arch: 'arm64' },
	// legacy: we use to ship only one alpine so it was put in the arch, but now we ship
	// multiple alpine images and moved to a better model (alpine as the platform)
	{ platform: 'linux', arch: 'alpine' },
];

// --- Start Positron ---
// Base server resources without PWB-specific files (for reh-web-server builds)
const positronServerResourceIncludes = [
	// NLS
	'out-build/nls.messages.json',
	'out-build/nls.keys.json',

	// Process monitor
	'out-build/vs/base/node/cpuUsage.sh',
	'out-build/vs/base/node/ps.sh',

	// External Terminal
	'out-build/vs/workbench/contrib/externalTerminal/**/*.scpt',

	// Terminal shell integration
	'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration.ps1',
	'out-build/vs/workbench/contrib/terminal/common/scripts/CodeTabExpansion.psm1',
	'out-build/vs/workbench/contrib/terminal/common/scripts/GitTabExpansion.psm1',
	'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-bash.sh',
	'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-env.zsh',
	'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-profile.zsh',
	'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-rc.zsh',
	'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration-login.zsh',
	'out-build/vs/workbench/contrib/terminal/common/scripts/shellIntegration.fish',
];
// --- End Positron ---

// --- Start PWB ---
// Web resources including PWB-specific files (for reh-web builds)
const webResourceIncludes = [
	...positronServerResourceIncludes,
	'out-build/vs/code/browser/workbench/rsLoginCheck.js',
];
// --- End PWB ---

// Legacy alias for compatibility
const serverResourceIncludes = webResourceIncludes;

const serverResourceExcludes = [
	'!out-build/vs/**/{electron-browser,electron-main,electron-utility}/**',
	'!out-build/vs/editor/standalone/**',
	'!out-build/vs/workbench/**/*-tb.png',
	'!**/test/**'
];

const serverResources = [
	...serverResourceIncludes,
	...serverResourceExcludes
];

const serverWithWebResourceIncludes = [
	...serverResourceIncludes,
	'out-build/vs/code/browser/workbench/*.html',
	...vscodeWebResourceIncludes
];

const serverWithWebResourceExcludes = [
	...serverResourceExcludes,
	'!out-build/vs/code/**/*-dev.html'
];

const serverWithWebResources = [
	...serverWithWebResourceIncludes,
	...serverWithWebResourceExcludes
];

// --- Start Positron ---
// Server with web resources for reh-web-server (without PWB-specific rsLoginCheck.js)
const positronServerWithWebResourceIncludes = [
	...positronServerResourceIncludes,
	'out-build/vs/code/browser/workbench/*.html',
	...vscodeWebResourceIncludes
];

const positronServerWithWebResources = [
	...positronServerWithWebResourceIncludes,
	...serverWithWebResourceExcludes
];
// --- End Positron ---

const serverEntryPoints = buildfile.codeServer;

const webEntryPoints = [
	buildfile.workerEditor,
	buildfile.workerExtensionHost,
	buildfile.workerNotebook,
	buildfile.workerLanguageDetection,
	buildfile.workerLocalFileSearch,
	buildfile.workerOutputLinks,
	buildfile.workerBackgroundTokenization,
	buildfile.keyboardMaps,
	buildfile.codeWeb
].flat();

const serverWithWebEntryPoints = [

	// Include all of server
	...serverEntryPoints,

	// Include all of web
	...webEntryPoints,
].flat();

const bootstrapEntryPoints = [
	'out-build/server-main.js',
	'out-build/server-cli.js',
	'out-build/bootstrap-fork.js'
];

function getNodeVersion() {
	const npmrc = fs.readFileSync(path.join(REPO_ROOT, 'remote', '.npmrc'), 'utf8');
	const nodeVersion = /^target="(.*)"$/m.exec(npmrc)![1];
	const internalNodeVersion = /^ms_build_id="(.*)"$/m.exec(npmrc)![1];
	return { nodeVersion, internalNodeVersion };
}

function getNodeChecksum(expectedName: string): string | undefined {
	const nodeJsChecksums = fs.readFileSync(path.join(REPO_ROOT, 'build', 'checksums', 'nodejs.txt'), 'utf8');
	for (const line of nodeJsChecksums.split('\n')) {
		const [checksum, name] = line.split(/\s+/);
		if (name === expectedName) {
			return checksum;
		}
	}
	return undefined;
}

function extractAlpinefromDocker(nodeVersion: string, platform: string, arch: string) {
	const imageName = arch === 'arm64' ? 'arm64v8/node' : 'node';
	log(`Downloading node.js ${nodeVersion} ${platform} ${arch} from docker image ${imageName}`);
	const contents = cp.execSync(`docker run --rm ${imageName}:${nodeVersion}-alpine /bin/sh -c 'cat \`which node\`'`, { maxBuffer: 100 * 1024 * 1024, encoding: 'buffer' });
	// eslint-disable-next-line local/code-no-dangerous-type-assertions
	return es.readArray([new File({ path: 'node', contents, stat: { mode: parseInt('755', 8) } as fs.Stats })]);
}

const { nodeVersion, internalNodeVersion } = getNodeVersion();

BUILD_TARGETS.forEach(({ platform, arch }) => {
	gulp.task(task.define(`node-${platform}-${arch}`, () => {
		const nodePath = path.join('.build', 'node', `v${nodeVersion}`, `${platform}-${arch}`);

		if (!fs.existsSync(nodePath)) {
			util.rimraf(nodePath);

			return nodejs(platform, arch)!
				.pipe(vfs.dest(nodePath));
		}

		return Promise.resolve(null);
	}));
});

const defaultNodeTask = gulp.task(`node-${process.platform}-${process.arch}`);

if (defaultNodeTask) {
	// eslint-disable-next-line local/code-no-any-casts
	gulp.task(task.define('node', defaultNodeTask as any));
}

function nodejs(platform: string, arch: string): NodeJS.ReadWriteStream | undefined {

	if (arch === 'armhf') {
		arch = 'armv7l';
	} else if (arch === 'alpine') {
		platform = 'alpine';
		arch = 'x64';
	}

	log(`Downloading node.js ${nodeVersion} ${platform} ${arch} from ${product.nodejsRepository}...`);

	const glibcPrefix = process.env['VSCODE_NODE_GLIBC'] ?? '';
	let expectedName: string | undefined;
	switch (platform) {
		case 'win32':
			expectedName = product.nodejsRepository !== 'https://nodejs.org' ?
				`win-${arch}-node.exe` : `win-${arch}/node.exe`;
			break;

		case 'darwin':
			expectedName = `node-v${nodeVersion}-${platform}-${arch}.tar.gz`;
			break;
		case 'linux':
			expectedName = `node-v${nodeVersion}${glibcPrefix}-${platform}-${arch}.tar.gz`;
			break;
		case 'alpine':
			expectedName = `node-v${nodeVersion}-linux-${arch}-musl.tar.gz`;
			break;
	}
	const checksumSha256 = expectedName ? getNodeChecksum(expectedName) : undefined;

	if (checksumSha256) {
		log(`Using SHA256 checksum for checking integrity: ${checksumSha256}`);
	} else {
		log.warn(`Unable to verify integrity of downloaded node.js binary because no SHA256 checksum was found!`);
	}

	switch (platform) {
		case 'win32':
			return (product.nodejsRepository !== 'https://nodejs.org' ?
				fetchGithub(product.nodejsRepository, { version: `${nodeVersion}-${internalNodeVersion}`, name: expectedName!, checksumSha256 }) :
				fetchUrls(`/dist/v${nodeVersion}/win-${arch}/node.exe`, { base: 'https://nodejs.org', checksumSha256 }))
				.pipe(rename('node.exe'));
		case 'darwin':
		case 'linux':
			return (product.nodejsRepository !== 'https://nodejs.org' ?
				fetchGithub(product.nodejsRepository, { version: `${nodeVersion}-${internalNodeVersion}`, name: expectedName!, checksumSha256 }) :
				fetchUrls(`/dist/v${nodeVersion}/node-v${nodeVersion}-${platform}-${arch}.tar.gz`, { base: 'https://nodejs.org', checksumSha256 })
			).pipe(flatmap(stream => stream.pipe(gunzip()).pipe(untar())))
				.pipe(filter('**/node'))
				.pipe(util.setExecutableBit('**'))
				.pipe(rename('node'));
		case 'alpine':
			return product.nodejsRepository !== 'https://nodejs.org' ?
				fetchGithub(product.nodejsRepository, { version: `${nodeVersion}-${internalNodeVersion}`, name: expectedName!, checksumSha256 })
					.pipe(flatmap(stream => stream.pipe(gunzip()).pipe(untar())))
					.pipe(filter('**/node'))
					.pipe(util.setExecutableBit('**'))
					.pipe(rename('node'))
				: extractAlpinefromDocker(nodeVersion, platform, arch);
	}
}

function packageTask(type: string, platform: string, arch: string, sourceFolderName: string, destinationFolderName: string) {
	const destination = path.join(BUILD_ROOT, destinationFolderName);

	return () => {
		const src = gulp.src(sourceFolderName + '/**', { base: '.' })
			.pipe(rename(function (path) { path.dirname = path.dirname!.replace(new RegExp('^' + sourceFolderName), 'out'); }))
			.pipe(util.setExecutableBit(['**/*.sh']))
			.pipe(filter(['**', '!**/*.{js,css}.map']));

		const workspaceExtensionPoints = ['debuggers', 'jsonValidation'];
		const isUIExtension = (manifest: { extensionKind?: string; main?: string; contributes?: Record<string, unknown> }) => {
			switch (manifest.extensionKind) {
				case 'ui': return true;
				case 'workspace': return false;
				default: {
					if (manifest.main) {
						return false;
					}
					if (manifest.contributes && Object.keys(manifest.contributes).some(key => workspaceExtensionPoints.indexOf(key) !== -1)) {
						return false;
					}
					// Default is UI Extension
					return true;
				}
			}
		};
		// --- Start Positron ---
		const excludedExtensions = [
			'vscode-api-tests',
			'vscode-test-resolver',
			'positron-zed',
			'positron-javascript',
		];
		// --- End Positron ---
		const localWorkspaceExtensions = glob.sync('extensions/*/package.json')
			.filter((extensionPath) => {
				if (type === 'reh-web' || type === 'reh-web-server') {
					return true; // web: ship all extensions for now
				}

				// Skip shipping UI extensions because the client side will have them anyways
				// and they'd just increase the download without being used
				const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, extensionPath)).toString());
				return !isUIExtension(manifest);
			}).map((extensionPath) => path.basename(path.dirname(extensionPath)))
			// --- Start Positron ---
			// Add Positron dev extensions to the list that we don't ship with the REH
			// .filter(name => name !== 'vscode-api-tests' && name !== 'vscode-test-resolver'); // Do not ship the test extensions
			.filter(name => excludedExtensions.indexOf(name) === -1);
		// --- End Positron ---
		// --- Start PWB ---
		// Add optional type field to the extension entry
		const builtInExtensions: Array<{ name: string; platforms?: string[]; clientOnly?: boolean; type?: string }> = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'product.json'), 'utf8')).builtInExtensions;
		// --- End PWB ---
		const marketplaceExtensions = builtInExtensions
			.filter(entry => !entry.platforms || new Set(entry.platforms).has(platform))
			.filter(entry => !entry.clientOnly)
			// --- Start PWB ---
			// If an entry specifies a type, ensure that the type specified
			// matches the type we're building. We use this to prevent the
			// Workbench extension from being bundled in non-web releases.
			.filter(entry => !entry.type || entry.type === type)
			// --- End PWB ---
			.map(entry => entry.name);
		const extensionPaths = [...localWorkspaceExtensions, ...marketplaceExtensions]
			.map(name => `.build/extensions/${name}/**`);

		//const extensions = gulp.src(extensionPaths, { base: '.build', dot: true });
		// --- Start Positron ---

		const bootstrapExtensions = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'product.json'), 'utf8')).bootstrapExtensions
			.filter(entry => !entry.platforms || new Set(entry.platforms).has(platform))
			.filter(entry => !entry.type || entry.type === type)
			.map(entry => entry.name);
		const bootstrapExtensionPaths = [...bootstrapExtensions]
			.map(name => `.build/extensions/bootstrap/${name}*.vsix`);

		const extensions = gulp.src([...extensionPaths, ...bootstrapExtensionPaths], { base: '.build', dot: true });

		// --- End Positron ---

		const extensionsCommonDependencies = gulp.src('.build/extensions/node_modules/**', { base: '.build', dot: true });
		const sources = es.merge(src, extensions, extensionsCommonDependencies)
			.pipe(filter(['**', '!**/*.{js,css}.map'], { dot: true }));

		let version = packageJson.version;

		// --- Start Positron ---
		const positronVersion = product.positronVersion;
		// --- End Positron ---

		const quality = (product as typeof product & { quality?: string }).quality;

		if (quality && quality !== 'stable') {
			version += '-' + quality;
		}

		const name = product.nameShort;

		let packageJsonContents = '';
		// --- Start Positron ---
		// Note: The remote/reh-web/package.json is generated/updated in build/npm/postinstall.js
		const packageJsonBase = (type === 'reh-web' || type === 'reh-web-server') ? 'remote/reh-web' : 'remote';
		const packageJsonStream = gulp.src([`${packageJsonBase}/package.json`], { base: packageJsonBase })
			// --- End Positron ---
			.pipe(jsonEditor({ name, version, dependencies: undefined, optionalDependencies: undefined, type: 'module' }))
			.pipe(es.through(function (file) {
				packageJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		let productJsonContents = '';
		const productJsonStream = gulp.src(['product.json'], { base: '.' })
			// --- Start Positron ---
			.pipe(jsonEditor({ commit, date: readISODate('out-build'), version, positronVersion, positronBuildNumber }))
			// --- End Positron ---
			.pipe(es.through(function (file) {
				productJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		const license = es.merge(
			gulp.src(['remote/LICENSE'], { base: 'remote', allowEmpty: true }),
			gulp.src(['NOTICE'], { base: '.', allowEmpty: true })
		);

		const jsFilter = util.filter(data => !data.isDirectory() && /\.js$/.test(data.path));

		// --- Start Positron ---
		const productionDependencies = getProductionDependencies((type === 'reh-web' || type === 'reh-web-server') ? REMOTE_REH_WEB_FOLDER : REMOTE_FOLDER);
		const dependenciesSrc = productionDependencies.map(d => path.relative(REPO_ROOT, d)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`, `!${d}/.bin/**`]).flat();
		const deps = gulp.src(dependenciesSrc, { base: packageJsonBase, dot: true })
			// --- End Positron ---
			// filter out unnecessary files, no source maps in server build
			.pipe(filter(['**', '!**/package-lock.json', '!**/*.{js,css}.map']))
			.pipe(util.cleanNodeModules(path.join(import.meta.dirname, '.moduleignore')))
			.pipe(util.cleanNodeModules(path.join(import.meta.dirname, `.moduleignore.${process.platform}`)))
			.pipe(jsFilter)
			.pipe(util.stripSourceMappingURL())
			.pipe(jsFilter.restore);

		const nodePath = `.build/node/v${nodeVersion}/${platform}-${arch}`;
		const node = gulp.src(`${nodePath}/**`, { base: nodePath, dot: true });

		let web: NodeJS.ReadWriteStream[] = [];
		if (type === 'reh-web' || type === 'reh-web-server') {
			web = [
				'resources/server/favicon.ico',
				// --- Start Positron ---
				'resources/server/positron-192.png',
				'resources/server/positron-512.png',
				// --- End Positron ---
				'resources/server/manifest.json'
			].map(resource => gulp.src(resource, { base: '.' }).pipe(rename(resource)));
		}

		// --- Start Positron ---
		// Include the activation directory with license-manager binaries
		const activation = gulp.src('resources/activation/**', { base: '.', dot: true });

		let all = es.merge(
			getQuartoBinaries(),
			activation,
			// --- End Positron ---
			packageJsonStream,
			productJsonStream,
			license,
			sources,
			deps,
			node,
			...web
		);

		// --- Start Positron ---
		if (type === 'reh-web' || type === 'reh-web-server') {
			// External modules (React, etc.)
			const moduleSources = gulp.src('src/esm-package-dependencies/**').pipe(rename(function (p) { p.dirname = path.join('out', 'esm-package-dependencies', p.dirname); }));
			all = es.merge(all, moduleSources);
		}
		// --- End Positron ---

		let result = all
			.pipe(util.skipDirectories())
			.pipe(util.fixWin32DirectoryPermissions());

		if (platform === 'win32') {
			result = es.merge(result,
				gulp.src('resources/server/bin/remote-cli/code.cmd', { base: '.' })
					.pipe(replace('@@VERSION@@', version))
					// --- Start Positron ---
					.pipe(replace('@@POSITRONVERSION@@', positronVersion))
					.pipe(replace('@@BUILDNUMBER@@', positronBuildNumber))
					// --- End Positron ---
					.pipe(replace('@@COMMIT@@', commit || ''))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(rename(`bin/remote-cli/${product.applicationName}.cmd`)),
				gulp.src('resources/server/bin/helpers/browser.cmd', { base: '.' })
					.pipe(replace('@@VERSION@@', version))
					// --- Start Positron ---
					.pipe(replace('@@POSITRONVERSION@@', positronVersion))
					.pipe(replace('@@BUILDNUMBER@@', positronBuildNumber))
					// --- End Positron ---
					.pipe(replace('@@COMMIT@@', commit || ''))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(rename(`bin/helpers/browser.cmd`)),
				gulp.src('resources/server/bin/code-server.cmd', { base: '.' })
					.pipe(rename(`bin/${product.serverApplicationName}.cmd`)),
			);
		} else if (platform === 'linux' || platform === 'alpine' || platform === 'darwin') {
			result = es.merge(result,
				gulp.src(`resources/server/bin/remote-cli/${platform === 'darwin' ? 'code-darwin.sh' : 'code-linux.sh'}`, { base: '.' })
					.pipe(replace('@@VERSION@@', version))
					// --- Start Positron ---
					.pipe(replace('@@POSITRONVERSION@@', positronVersion))
					.pipe(replace('@@BUILDNUMBER@@', positronBuildNumber))
					// --- End Positron ---
					.pipe(replace('@@COMMIT@@', commit || ''))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(rename(`bin/remote-cli/${product.applicationName}`))
					.pipe(util.setExecutableBit()),
				gulp.src(`resources/server/bin/helpers/${platform === 'darwin' ? 'browser-darwin.sh' : 'browser-linux.sh'}`, { base: '.' })
					.pipe(replace('@@VERSION@@', version))
					// --- Start Positron ---
					.pipe(replace('@@POSITRONVERSION@@', positronVersion))
					.pipe(replace('@@BUILDNUMBER@@', positronBuildNumber))
					// --- End Positron ---
					.pipe(replace('@@COMMIT@@', commit || ''))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(rename(`bin/helpers/browser.sh`))
					.pipe(util.setExecutableBit()),
				gulp.src(`resources/server/bin/${platform === 'darwin' ? 'code-server-darwin.sh' : 'code-server-linux.sh'}`, { base: '.' })
					.pipe(rename(`bin/${product.serverApplicationName}`))
					.pipe(util.setExecutableBit())
			);
		}

		if (platform === 'linux' || platform === 'alpine') {
			result = es.merge(result,
				gulp.src(`resources/server/bin/helpers/check-requirements-linux.sh`, { base: '.' })
					.pipe(rename(`bin/helpers/check-requirements.sh`))
					.pipe(util.setExecutableBit())
			);
		}

		result = inlineMeta(result, {
			targetPaths: bootstrapEntryPoints,
			packageJsonFn: () => packageJsonContents,
			productJsonFn: () => productJsonContents
		});

		return result.pipe(vfs.dest(destination));
	};
}

/**
 * @param product The parsed product.json file contents
 */
function tweakProductForServerWeb(product: typeof import('../product.json')) {
	const result: typeof product & { webEndpointUrlTemplate?: string } = { ...product };
	delete result.webEndpointUrlTemplate;
	return result;
}

['reh', 'reh-web', 'reh-web-server'].forEach(type => {
	const bundleTask = task.define(`bundle-vscode-${type}`, task.series(
		util.rimraf(`out-vscode-${type}`),
		optimize.bundleTask(
			{
				out: `out-vscode-${type}`,
				esm: {
					src: 'out-build',
					entryPoints: [
						...(type === 'reh' ? serverEntryPoints : serverWithWebEntryPoints),
						...bootstrapEntryPoints
					],
					// --- Start Positron ---
					// reh-web-server uses positronServerWithWebResources (no rsLoginCheck.js)
					// reh-web uses serverWithWebResources (includes rsLoginCheck.js for PWB)
					resources: type === 'reh' ? serverResources : (type === 'reh-web-server' ? positronServerWithWebResources : serverWithWebResources),
					// --- End Positron ---
					// --- Start Positron ---
					fileContentMapper: createVSCodeWebFileContentMapper((type === 'reh-web' || type === 'reh-web-server') ? '.build/web/extensions' : '.build/extensions', (type === 'reh-web' || type === 'reh-web-server') ? tweakProductForServerWeb(product) : product)
					// --- End Positron ---
				}
			}
		)
	));

	const minifyTask = task.define(`minify-vscode-${type}`, task.series(
		bundleTask,
		util.rimraf(`out-vscode-${type}-min`),
		optimize.minifyTask(`out-vscode-${type}`, `https://main.vscode-cdn.net/sourcemaps/${commit}/core`)
	));
	gulp.task(minifyTask);

	BUILD_TARGETS.forEach(buildTarget => {
		const dashed = (str: string) => (str ? `-${str}` : ``);
		const platform = buildTarget.platform;
		const arch = buildTarget.arch;

		['', 'min'].forEach(minified => {
			const sourceFolderName = `out-vscode-${type}${dashed(minified)}`;
			const destinationFolderName = `vscode-${type}${dashed(platform)}${dashed(arch)}`;

			const serverTaskCI = task.define(`vscode-${type}${dashed(platform)}${dashed(arch)}${dashed(minified)}-ci`, task.series(
				compileNativeExtensionsBuildTask,
				gulp.task(`node-${platform}-${arch}`) as task.Task,
				util.rimraf(path.join(BUILD_ROOT, destinationFolderName)),
				packageTask(type, platform, arch, sourceFolderName, destinationFolderName)
			));
			gulp.task(serverTaskCI);

			const serverTask = task.define(`vscode-${type}${dashed(platform)}${dashed(arch)}${dashed(minified)}`, task.series(
				// --- Start Positron ---
				// Only mangle when minified is true. This matches the behavior of gulpfile.vscode:628.
				// minified ? compileBuildWithManglingTask,
				minified ? compileBuildWithManglingTask : compileBuildWithoutManglingTask,
				// --- End Positron ---
				cleanExtensionsBuildTask,
				compileNonNativeExtensionsBuildTask,
				compileExtensionMediaBuildTask,
				// --- Start Positron ---
				copyExtensionBinariesTask,
				// --- End Positron ---
				minified ? minifyTask : bundleTask,
				serverTaskCI
			));
			gulp.task(serverTask);
		});
	});
});
