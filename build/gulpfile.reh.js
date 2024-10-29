/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const path = require('path');
const es = require('event-stream');
const util = require('./lib/util');
const { getVersion } = require('./lib/getVersion');
const task = require('./lib/task');
const optimize = require('./lib/optimize');
const { inlineMeta } = require('./lib/inlineMeta');
const product = require('../product.json');
const rename = require('gulp-rename');
const replace = require('gulp-replace');
const filter = require('gulp-filter');
const { getProductionDependencies } = require('./lib/dependencies');
const { readISODate } = require('./lib/date');
const vfs = require('vinyl-fs');
const packageJson = require('../package.json');
const flatmap = require('gulp-flatmap');
const gunzip = require('gulp-gunzip');
const File = require('vinyl');
const fs = require('fs');
const glob = require('glob');
const { compileBuildTask } = require('./gulpfile.compile');
const { compileExtensionsBuildTask, compileExtensionMediaBuildTask } = require('./gulpfile.extensions');
// --- Start Positron ---
const { vscodeWebEntryPoints, vscodeWebResourceIncludes, createVSCodeWebFileContentMapper } = require('./gulpfile.vscode.web');
const { positronBuildNumber } = require('./utils');
// --- End Positron ---
const cp = require('child_process');
const log = require('fancy-log');
const { isESM } = require('./lib/esm');
const buildfile = require('./buildfile');

const REPO_ROOT = path.dirname(__dirname);
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

const serverResourceIncludes = [
	// --- Start Positron ---
	'out-build/react-dom/client.js',
	'out-build/vs/code/browser/workbench/rsLoginCheck.js',
	// --- End Positron ---

	// NLS
	'out-build/nls.messages.json',

	// Process monitor
	'out-build/vs/base/node/cpuUsage.sh',
	'out-build/vs/base/node/ps.sh',

	// Terminal shell integration
	'out-build/vs/workbench/contrib/terminal/browser/media/shellIntegration.ps1',
	'out-build/vs/workbench/contrib/terminal/browser/media/CodeTabExpansion.psm1',
	'out-build/vs/workbench/contrib/terminal/browser/media/GitTabExpansion.psm1',
	'out-build/vs/workbench/contrib/terminal/browser/media/shellIntegration-bash.sh',
	'out-build/vs/workbench/contrib/terminal/browser/media/shellIntegration-env.zsh',
	'out-build/vs/workbench/contrib/terminal/browser/media/shellIntegration-profile.zsh',
	'out-build/vs/workbench/contrib/terminal/browser/media/shellIntegration-rc.zsh',
	'out-build/vs/workbench/contrib/terminal/browser/media/shellIntegration-login.zsh',
	'out-build/vs/workbench/contrib/terminal/browser/media/fish_xdg_data/fish/vendor_conf.d/shellIntegration.fish',
];

const serverResourceExcludes = [
	'!out-build/vs/**/{electron-sandbox,electron-main}/**',
	'!out-build/vs/editor/standalone/**',
	'!out-build/vs/workbench/**/*-tb.png',
	'!**/test/**'
];

const serverResources = [
	...serverResourceIncludes,
	...serverResourceExcludes
];

const serverWithWebResourceIncludes = isESM() ? [
	...serverResourceIncludes,
	'out-build/vs/code/browser/workbench/*.html',
	...vscodeWebResourceIncludes
] : [
	...serverResourceIncludes,
	...vscodeWebResourceIncludes
];

const serverWithWebResourceExcludes = [
	...serverResourceExcludes,
	'!out-build/vs/code/**/*-dev.html',
	'!out-build/vs/code/**/*-dev.esm.html',
];

const serverWithWebResources = [
	...serverWithWebResourceIncludes,
	...serverWithWebResourceExcludes
];

const serverEntryPoints = [
	{
		name: 'vs/server/node/server.main',
		exclude: ['vs/css']
	},
	{
		name: 'vs/server/node/server.cli',
		exclude: ['vs/css']
	},
	{
		name: 'vs/workbench/api/node/extensionHostProcess',
		exclude: ['vs/css']
	},
	{
		name: 'vs/platform/files/node/watcher/watcherMain',
		exclude: ['vs/css']
	},
	{
		name: 'vs/platform/terminal/node/ptyHostMain',
		exclude: ['vs/css']
	}
];

const webEntryPoints = isESM() ? [
	buildfile.base,
	buildfile.workerExtensionHost,
	buildfile.workerNotebook,
	buildfile.workerLanguageDetection,
	buildfile.workerLocalFileSearch,
	buildfile.workerOutputLinks,
	buildfile.workerBackgroundTokenization,
	buildfile.keyboardMaps,
	buildfile.codeWeb
].flat() : [
	buildfile.entrypoint('vs/workbench/workbench.web.main'),
	buildfile.base,
	buildfile.workerExtensionHost,
	buildfile.workerNotebook,
	buildfile.workerLanguageDetection,
	buildfile.workerLocalFileSearch,
	buildfile.keyboardMaps,
	buildfile.workbenchWeb()
].flat();

const serverWithWebEntryPoints = [

	// Include all of server
	...serverEntryPoints,

	// Include all of web
	...webEntryPoints,
].flat();

const commonJSEntryPoints = [
	'out-build/server-main.js',
	'out-build/server-cli.js',
	'out-build/bootstrap-fork.js',
];

function getNodeVersion() {
	const yarnrc = fs.readFileSync(path.join(REPO_ROOT, 'remote', '.yarnrc'), 'utf8');
	const nodeVersion = /^target "(.*)"$/m.exec(yarnrc)[1];
	const internalNodeVersion = /^ms_build_id "(.*)"$/m.exec(yarnrc)[1];
	return { nodeVersion, internalNodeVersion };
}

function getNodeChecksum(expectedName) {
	const nodeJsChecksums = fs.readFileSync(path.join(REPO_ROOT, 'build', 'checksums', 'nodejs.txt'), 'utf8');
	for (const line of nodeJsChecksums.split('\n')) {
		const [checksum, name] = line.split(/\s+/);
		if (name === expectedName) {
			return checksum;
		}
	}
	return undefined;
}

function extractAlpinefromDocker(nodeVersion, platform, arch) {
	const imageName = arch === 'arm64' ? 'arm64v8/node' : 'node';
	log(`Downloading node.js ${nodeVersion} ${platform} ${arch} from docker image ${imageName}`);
	const contents = cp.execSync(`docker run --rm ${imageName}:${nodeVersion}-alpine /bin/sh -c 'cat \`which node\`'`, { maxBuffer: 100 * 1024 * 1024, encoding: 'buffer' });
	return es.readArray([new File({ path: 'node', contents, stat: { mode: parseInt('755', 8) } })]);
}

const { nodeVersion, internalNodeVersion } = getNodeVersion();

BUILD_TARGETS.forEach(({ platform, arch }) => {
	gulp.task(task.define(`node-${platform}-${arch}`, () => {
		const nodePath = path.join('.build', 'node', `v${nodeVersion}`, `${platform}-${arch}`);

		if (!fs.existsSync(nodePath)) {
			util.rimraf(nodePath);

			return nodejs(platform, arch)
				.pipe(vfs.dest(nodePath));
		}

		return Promise.resolve(null);
	}));
});

const defaultNodeTask = gulp.task(`node-${process.platform}-${process.arch}`);

if (defaultNodeTask) {
	gulp.task(task.define('node', defaultNodeTask));
}

function nodejs(platform, arch) {
	const { fetchUrls, fetchGithub } = require('./lib/fetch');
	const untar = require('gulp-untar');

	if (arch === 'armhf') {
		arch = 'armv7l';
	} else if (arch === 'alpine') {
		platform = 'alpine';
		arch = 'x64';
	}

	log(`Downloading node.js ${nodeVersion} ${platform} ${arch} from ${product.nodejsRepository}...`);

	const glibcPrefix = process.env['VSCODE_NODE_GLIBC'] ?? '';
	let expectedName;
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
	const checksumSha256 = getNodeChecksum(expectedName);

	if (checksumSha256) {
		log(`Using SHA256 checksum for checking integrity: ${checksumSha256}`);
	} else {
		log.warn(`Unable to verify integrity of downloaded node.js binary because no SHA256 checksum was found!`);
	}

	switch (platform) {
		case 'win32':
			return (product.nodejsRepository !== 'https://nodejs.org' ?
				fetchGithub(product.nodejsRepository, { version: `${nodeVersion}-${internalNodeVersion}`, name: expectedName, checksumSha256 }) :
				fetchUrls(`/dist/v${nodeVersion}/win-${arch}/node.exe`, { base: 'https://nodejs.org', checksumSha256 }))
				.pipe(rename('node.exe'));
		case 'darwin':
		case 'linux':
			return (product.nodejsRepository !== 'https://nodejs.org' ?
				fetchGithub(product.nodejsRepository, { version: `${nodeVersion}-${internalNodeVersion}`, name: expectedName, checksumSha256 }) :
				fetchUrls(`/dist/v${nodeVersion}/node-v${nodeVersion}-${platform}-${arch}.tar.gz`, { base: 'https://nodejs.org', checksumSha256 })
			).pipe(flatmap(stream => stream.pipe(gunzip()).pipe(untar())))
				.pipe(filter('**/node'))
				.pipe(util.setExecutableBit('**'))
				.pipe(rename('node'));
		case 'alpine':
			return product.nodejsRepository !== 'https://nodejs.org' ?
				fetchGithub(product.nodejsRepository, { version: `${nodeVersion}-${internalNodeVersion}`, name: expectedName, checksumSha256 })
					.pipe(flatmap(stream => stream.pipe(gunzip()).pipe(untar())))
					.pipe(filter('**/node'))
					.pipe(util.setExecutableBit('**'))
					.pipe(rename('node'))
				: extractAlpinefromDocker(nodeVersion, platform, arch);
	}
}

function packageTask(type, platform, arch, sourceFolderName, destinationFolderName) {
	const destination = path.join(BUILD_ROOT, destinationFolderName);

	return () => {
		const json = require('gulp-json-editor');

		const src = gulp.src(sourceFolderName + '/**', { base: '.' })
			.pipe(rename(function (path) { path.dirname = path.dirname.replace(new RegExp('^' + sourceFolderName), 'out'); }))
			.pipe(util.setExecutableBit(['**/*.sh']))
			.pipe(filter(['**', '!**/*.js.map']));

		const workspaceExtensionPoints = ['debuggers', 'jsonValidation'];
		const isUIExtension = (manifest) => {
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
				if (type === 'reh-web') {
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
		const marketplaceExtensions = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'product.json'), 'utf8')).builtInExtensions
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

		const extensions = gulp.src(extensionPaths, { base: '.build', dot: true });
		const extensionsCommonDependencies = gulp.src('.build/extensions/node_modules/**', { base: '.build', dot: true });
		const sources = es.merge(src, extensions, extensionsCommonDependencies)
			.pipe(filter(['**', '!**/*.js.map'], { dot: true }));

		let version = packageJson.version;

		// --- Start Positron ---
		const positronVersion = product.positronVersion;
		// --- End Positron ---

		const quality = product.quality;

		if (quality && quality !== 'stable') {
			version += '-' + quality;
		}

		const name = product.nameShort;

		let packageJsonContents;
		// --- Start Positron ---
		// Note: The remote/reh-web/package.json is generated/updated in build/npm/postinstall.js
		const packageJsonBase = type === 'reh-web' ? 'remote/reh-web' : 'remote';
		const packageJsonStream = gulp.src([`${packageJsonBase}/package.json`], { base: packageJsonBase })
			.pipe(json({ name, version, dependencies: undefined, optionalDependencies: undefined, ...(isESM(`Setting 'type: module' in top level package.json`) ? { type: 'module' } : {}) })) // TODO@esm this should be configured in the top level package.json
			// --- End Positron ---
			.pipe(es.through(function (file) {
				packageJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		let productJsonContents;
		const productJsonStream = gulp.src(['product.json'], { base: '.' })
			// --- Start Positron ---
			.pipe(json({ commit, date: readISODate('out-build'), version, positronVersion, positronBuildNumber }))
			// --- End Positron ---
			.pipe(es.through(function (file) {
				productJsonContents = file.contents.toString();
				this.emit('data', file);
			}));

		const license = gulp.src(['remote/LICENSE'], { base: 'remote', allowEmpty: true });

		const jsFilter = util.filter(data => !data.isDirectory() && /\.js$/.test(data.path));

		// --- Start Positron ---
		const productionDependencies = getProductionDependencies(type === 'reh-web' ? REMOTE_REH_WEB_FOLDER : REMOTE_FOLDER);
		const dependenciesSrc = productionDependencies.map(d => path.relative(REPO_ROOT, d.path)).map(d => [`${d}/**`, `!${d}/**/{test,tests}/**`, `!${d}/.bin/**`]).flat();

		const deps = gulp.src(dependenciesSrc, { base: packageJsonBase, dot: true })
			// --- End Positron ---
			// filter out unnecessary files, no source maps in server build
			.pipe(filter(['**', '!**/package-lock.json', '!**/yarn.lock', '!**/*.js.map']))
			.pipe(util.cleanNodeModules(path.join(__dirname, '.moduleignore')))
			.pipe(util.cleanNodeModules(path.join(__dirname, `.moduleignore.${process.platform}`)))
			.pipe(jsFilter)
			.pipe(util.stripSourceMappingURL())
			.pipe(jsFilter.restore);

		const nodePath = `.build/node/v${nodeVersion}/${platform}-${arch}`;
		const node = gulp.src(`${nodePath}/**`, { base: nodePath, dot: true });

		let web = [];
		if (type === 'reh-web') {
			web = [
				'resources/server/favicon.ico',
				// --- Start Positron ---
				'resources/server/positron-192.png',
				'resources/server/positron-512.png',
				// --- End Positron ---
				'resources/server/manifest.json'
			].map(resource => gulp.src(resource, { base: '.' }).pipe(rename(resource)));
		}

		const all = es.merge(
			packageJsonStream,
			productJsonStream,
			license,
			sources,
			deps,
			node,
			...web
		);

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
					.pipe(replace('@@COMMIT@@', commit))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(rename(`bin/remote-cli/${product.applicationName}.cmd`)),
				gulp.src('resources/server/bin/helpers/browser.cmd', { base: '.' })
					.pipe(replace('@@VERSION@@', version))
					// --- Start Positron ---
					.pipe(replace('@@POSITRONVERSION@@', positronVersion))
					.pipe(replace('@@BUILDNUMBER@@', positronBuildNumber))
					// --- End Positron ---
					.pipe(replace('@@COMMIT@@', commit))
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
					.pipe(replace('@@COMMIT@@', commit))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(rename(`bin/remote-cli/${product.applicationName}`))
					.pipe(util.setExecutableBit()),
				gulp.src(`resources/server/bin/helpers/${platform === 'darwin' ? 'browser-darwin.sh' : 'browser-linux.sh'}`, { base: '.' })
					.pipe(replace('@@VERSION@@', version))
					// --- Start Positron ---
					.pipe(replace('@@POSITRONVERSION@@', positronVersion))
					.pipe(replace('@@BUILDNUMBER@@', positronBuildNumber))
					// --- End Positron ---
					.pipe(replace('@@COMMIT@@', commit))
					.pipe(replace('@@APPNAME@@', product.applicationName))
					.pipe(rename(`bin/helpers/browser.sh`))
					.pipe(util.setExecutableBit()),
				gulp.src(`resources/server/bin/${platform === 'darwin' ? 'code-server-darwin.sh' : 'code-server-linux.sh'}`, { base: '.' })
					.pipe(rename(`bin/${product.serverApplicationName}`))
					.pipe(util.setExecutableBit())
			);
		}

		if (platform === 'linux' && process.env['VSCODE_NODE_GLIBC'] === '-glibc-2.17') {
			result = es.merge(result,
				gulp.src(`resources/server/bin/helpers/check-requirements-linux-legacy.sh`, { base: '.' })
					.pipe(rename(`bin/helpers/check-requirements.sh`))
					.pipe(util.setExecutableBit())
			);
		} else if (platform === 'linux' || platform === 'alpine') {
			result = es.merge(result,
				gulp.src(`resources/server/bin/helpers/check-requirements-linux.sh`, { base: '.' })
					.pipe(rename(`bin/helpers/check-requirements.sh`))
					.pipe(util.setExecutableBit())
			);
		}

		result = inlineMeta(result, {
			targetPaths: commonJSEntryPoints,
			packageJsonFn: () => packageJsonContents,
			productJsonFn: () => productJsonContents
		});

		return result.pipe(vfs.dest(destination));
	};
}

/**
 * @param {object} product The parsed product.json file contents
 */
function tweakProductForServerWeb(product) {
	const result = { ...product };
	delete result.webEndpointUrlTemplate;
	return result;
}

['reh', 'reh-web'].forEach(type => {
	const optimizeTask = task.define(`optimize-vscode-${type}`, task.series(
		util.rimraf(`out-vscode-${type}`),
		optimize.optimizeTask(
			{
				out: `out-vscode-${type}`,
				amd: {
					src: 'out-build',
					entryPoints: (type === 'reh' ? serverEntryPoints : serverWithWebEntryPoints).flat(),
					otherSources: [],
					resources: type === 'reh' ? serverResources : serverWithWebResources,
					loaderConfig: optimize.loaderConfig(),
					inlineAmdImages: true,
					bundleInfo: undefined,
					// --- Start Positron ---
					fileContentMapper: createVSCodeWebFileContentMapper(type === 'reh-web' ? '.build/web/extensions' : '.build/extensions', type === 'reh-web' ? tweakProductForServerWeb(product) : product)
					// --- End Positron ---
				},
				commonJS: {
					src: 'out-build',
					entryPoints: commonJSEntryPoints,
					platform: 'node',
					external: [
						'minimist',
						// We cannot inline `product.json` from here because
						// it is being changed during build time at a later
						// point in time (such as `checksums`)
						// We have a manual step to inline these later.
						'../product.json',
						'../package.json'
					]
				}
			}
		)
	));

	const minifyTask = task.define(`minify-vscode-${type}`, task.series(
		optimizeTask,
		util.rimraf(`out-vscode-${type}-min`),
		optimize.minifyTask(`out-vscode-${type}`, `https://main.vscode-cdn.net/sourcemaps/${commit}/core`)
	));
	gulp.task(minifyTask);

	BUILD_TARGETS.forEach(buildTarget => {
		const dashed = (str) => (str ? `-${str}` : ``);
		const platform = buildTarget.platform;
		const arch = buildTarget.arch;

		['', 'min'].forEach(minified => {
			const sourceFolderName = `out-vscode-${type}${dashed(minified)}`;
			const destinationFolderName = `vscode-${type}${dashed(platform)}${dashed(arch)}`;

			const serverTaskCI = task.define(`vscode-${type}${dashed(platform)}${dashed(arch)}${dashed(minified)}-ci`, task.series(
				gulp.task(`node-${platform}-${arch}`),
				util.rimraf(path.join(BUILD_ROOT, destinationFolderName)),
				packageTask(type, platform, arch, sourceFolderName, destinationFolderName)
			));
			gulp.task(serverTaskCI);

			const serverTask = task.define(`vscode-${type}${dashed(platform)}${dashed(arch)}${dashed(minified)}`, task.series(
				compileBuildTask,
				compileExtensionsBuildTask,
				compileExtensionMediaBuildTask,
				minified ? minifyTask : optimizeTask,
				serverTaskCI
			));
			gulp.task(serverTask);
		});
	});
});
