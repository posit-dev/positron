/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Increase max listeners for event emitters
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

import es from 'event-stream';
import fancyLog from 'fancy-log';
import glob from 'glob';
import gulp from 'gulp';
import filter from 'gulp-filter';
import plumber from 'gulp-plumber';
import sourcemaps from 'gulp-sourcemaps';
import * as path from 'path';
import * as nodeUtil from 'util';
import * as ext from './lib/extensions.ts';
import { getVersion } from './lib/getVersion.ts';
import { createReporter } from './lib/reporter.ts';
import * as task from './lib/task.ts';
import * as tsb from './lib/tsb/index.ts';
import { createTsgoStream, spawnTsgo } from './lib/tsgo.ts';
import * as util from './lib/util.ts';
import watcher from './lib/watch/index.ts';

const root = path.dirname(import.meta.dirname);
const commit = getVersion(root);

// Tracks active extension compilations to emit aggregate
// "Starting compilation" / "Finished compilation" messages
// that the problem matcher in tasks.json relies on.
let activeExtensionCompilations = 0;

function onExtensionCompilationStart(): void {
	if (activeExtensionCompilations === 0) {
		fancyLog('Starting compilation');
	}
	activeExtensionCompilations++;
}

function onExtensionCompilationEnd(): void {
	activeExtensionCompilations--;
	if (activeExtensionCompilations === 0) {
		fancyLog('Finished compilation');
	}
}

// To save 250ms for each gulp startup, we are caching the result here
// const compilations = glob.sync('**/tsconfig.json', {
// 	cwd: extensionsPath,
// 	ignore: ['**/out/**', '**/node_modules/**']
// });
const compilations = [
	// --- Start Positron ---
	'extensions/authentication/tsconfig.json',
	'extensions/open-remote-ssh/tsconfig.json',
	'extensions/positron-assistant/tsconfig.json',
	'extensions/positron-catalog-explorer/tsconfig.json',
	'extensions/positron-code-cells/tsconfig.json',
	'extensions/positron-connections/tsconfig.json',
	'extensions/positron-dev-containers/tsconfig.json',
	'extensions/positron-duckdb/tsconfig.json',
	'extensions/positron-environment/tsconfig.json',
	'extensions/positron-environment-modules/tsconfig.json',
	'extensions/positron-ipywidgets/renderer/tsconfig.json',
	'extensions/positron-javascript/tsconfig.json',
	'extensions/positron-notebooks/tsconfig.json',
	'extensions/positron-pdf-server/tsconfig.json',
	'extensions/positron-proxy/tsconfig.json',
	'extensions/positron-python/tsconfig.json',
	'extensions/positron-r/tsconfig.json',
	'extensions/positron-reticulate/tsconfig.json',
	'extensions/positron-run-app/tsconfig.json',
	'extensions/positron-runtime-debugger/tsconfig.json',
	'extensions/positron-supervisor/tsconfig.json',
	'extensions/positron-viewer/tsconfig.json',
	'extensions/positron-zed/tsconfig.json',
	// --- End Positron ---
	'extensions/configuration-editing/tsconfig.json',
	'extensions/css-language-features/client/tsconfig.json',
	'extensions/css-language-features/server/tsconfig.json',
	'extensions/debug-auto-launch/tsconfig.json',
	'extensions/debug-server-ready/tsconfig.json',
	'extensions/emmet/tsconfig.json',
	'extensions/extension-editing/tsconfig.json',
	'extensions/git/tsconfig.json',
	'extensions/git-base/tsconfig.json',
	'extensions/github/tsconfig.json',
	'extensions/github-authentication/tsconfig.json',
	'extensions/grunt/tsconfig.json',
	'extensions/gulp/tsconfig.json',
	'extensions/html-language-features/client/tsconfig.json',
	'extensions/html-language-features/server/tsconfig.json',
	'extensions/ipynb/tsconfig.json',
	'extensions/jake/tsconfig.json',
	'extensions/json-language-features/client/tsconfig.json',
	'extensions/json-language-features/server/tsconfig.json',
	'extensions/markdown-language-features/tsconfig.json',
	'extensions/markdown-math/tsconfig.json',
	'extensions/media-preview/tsconfig.json',
	'extensions/merge-conflict/tsconfig.json',
	'extensions/mermaid-chat-features/tsconfig.json',
	'extensions/terminal-suggest/tsconfig.json',
	'extensions/microsoft-authentication/tsconfig.json',
	'extensions/notebook-renderers/tsconfig.json',
	'extensions/npm/tsconfig.json',
	'extensions/php-language-features/tsconfig.json',
	'extensions/references-view/tsconfig.json',
	'extensions/search-result/tsconfig.json',
	'extensions/simple-browser/tsconfig.json',
	'extensions/tunnel-forwarding/tsconfig.json',
	'extensions/typescript-language-features/web/tsconfig.json',
	'extensions/typescript-language-features/tsconfig.json',
	'extensions/vscode-api-tests/tsconfig.json',
	'extensions/vscode-colorize-tests/tsconfig.json',
	'extensions/vscode-colorize-perf-tests/tsconfig.json',
	'extensions/vscode-test-resolver/tsconfig.json',

	'.vscode/extensions/vscode-selfhost-test-provider/tsconfig.json',
	'.vscode/extensions/vscode-selfhost-import-aid/tsconfig.json',
	'.vscode/extensions/vscode-extras/tsconfig.json',
];

// --- Start Positron ---
// Add the open-remote-wsl extension on Windows
if (process.platform === 'win32') {
	compilations.push('extensions/open-remote-wsl/tsconfig.json');
}
// --- End Positron ---

// --- Start Positron ---
// Add the open-remote-wsl extension on Windows
if (process.platform === 'win32') {
	compilations.push('extensions/open-remote-wsl/tsconfig.json');
}
// --- End Positron ---

const getBaseUrl = (out: string) => `https://main.vscode-cdn.net/sourcemaps/${commit}/${out}`;

function rewriteTsgoSourceMappingUrlsIfNeeded(build: boolean, out: string, baseUrl: string): Promise<void> {
	if (!build) {
		return Promise.resolve();
	}

	return util.streamToPromise(
		gulp.src(path.join(out, '**', '*.js'), { base: out })
			.pipe(util.rewriteSourceMappingURL(baseUrl))
			.pipe(gulp.dest(out))
	);
}

const tasks = compilations.map(function (tsconfigFile) {
	const absolutePath = path.join(root, tsconfigFile);
	const relativeDirname = path.dirname(tsconfigFile.replace(/^(.*\/)?extensions\//i, ''));

	const overrideOptions: { sourceMap?: boolean; inlineSources?: boolean; base?: string } = {};
	overrideOptions.sourceMap = true;

	const name = relativeDirname.replace(/\//g, '-');

	const srcRoot = path.dirname(tsconfigFile);
	const srcBase = path.join(srcRoot, 'src');
	const src = path.join(srcBase, '**');
	const srcOpts = { cwd: root, base: srcBase, dot: true };

	const out = path.join(srcRoot, 'out');
	const baseUrl = getBaseUrl(out);

	function createPipeline(build: boolean, emitError?: boolean, transpileOnly?: boolean) {
		const reporter = createReporter('extensions');

		overrideOptions.inlineSources = Boolean(build);
		overrideOptions.base = path.dirname(absolutePath);

		const compilation = tsb.create(absolutePath, overrideOptions, { verbose: false, transpileOnly, transpileOnlyIncludesDts: transpileOnly, transpileWithEsbuild: true }, err => reporter(err.toString()));

		const pipeline = function () {
			const input = es.through();
			// --- Start Positron ---
			// Add '**/*.tsx'.
			const tsFilter = filter(['**/*.ts', '**/*.tsx', '!**/lib/lib*.d.ts', '!**/node_modules/**'], { restore: true, dot: true });
			// --- End Positron ---
			const output = input
				.pipe(plumber({
					errorHandler: function (err) {
						if (err && !err.__reporter__) {
							reporter(err);
						}
					}
				}))
				.pipe(tsFilter)
				.pipe(util.loadSourcemaps())
				.pipe(compilation())
				.pipe(build ? util.stripSourceMappingURL() : es.through())
				.pipe(sourcemaps.write('.', {
					sourceMappingURL: !build ? undefined : f => `${baseUrl}/${f.relative}.map`,
					addComment: !!build,
					includeContent: !!build,
					// note: trailing slash is important, else the source URLs in V8's file coverage are incorrect
					sourceRoot: '../src/',
				}))
				.pipe(tsFilter.restore)
				.pipe(reporter.end(!!emitError));

			return es.duplex(input, output);
		};

		// add src-stream for project files
		pipeline.tsProjectSrc = () => {
			return compilation.src(srcOpts);
		};
		return pipeline;
	}

	const cleanTask = task.define(`clean-extension-${name}`, util.rimraf(out));

	const transpileTask = task.define(`transpile-extension:${name}`, task.series(cleanTask, () => {
		const pipeline = createPipeline(false, true, true);
		// --- Start Positron ---
		// Add '!**/*.tsx'.
		const nonts = gulp.src(src, srcOpts).pipe(filter(['**', '!**/*.ts', '!**/*.tsx']));
		// --- End Positron ---
		const input = es.merge(nonts, pipeline.tsProjectSrc());

		return input
			.pipe(pipeline())
			.pipe(gulp.dest(out));
	}));

	const compileTask = task.define(`compile-extension:${name}`, task.series(cleanTask, async () => {
		// --- Start Positron ---
		// Add '!**/*.tsx'.
		const nonts = gulp.src(src, srcOpts).pipe(filter(['**', '!**/*.ts', '!**/*.tsx'], { dot: true }));
		// --- End Positron ---
		const copyNonTs = util.streamToPromise(nonts.pipe(gulp.dest(out)));
		const tsgo = spawnTsgo(absolutePath, { taskName: 'extensions' }, () => rewriteTsgoSourceMappingUrlsIfNeeded(false, out, baseUrl));

		await Promise.all([copyNonTs, tsgo]);
	}));

	const watchTask = task.define(`watch-extension:${name}`, task.series(cleanTask, () => {
		// --- Start Positron ---
		const nonts = gulp.src(src, srcOpts).pipe(filter(['**', '!**/*.ts', '!**/*.tsx'], { dot: true }));

		// The Python extension's integration tests create and delete directories in a way that
		// crashes the watcher. For the positron-python task, ignore these known directories.
		// (Note that these need to be ignored at `watcher` -- `gulp.src` is not enough.)
		let ignored: string[];
		if (relativeDirname === 'positron-python') {
			ignored = [
				path.join(srcBase, 'test/1/**'),
				path.join(srcBase, 'test/should-not-exist/**'),
				path.join(srcBase, 'testMultiRootWkspc/**'),
				path.join(srcBase, 'testTestingRootWkspc/**'),
			];
		} else {
			ignored = [];
		}

		const watchInput = watcher(src, { ...srcOpts, ...{ ignored, readDelay: 200 } });
		const watchNonTs = watchInput.pipe(filter(['**', '!**/*.ts', '!**/*.tsx'], { dot: true })).pipe(gulp.dest(out));
		// --- End Positron ---
		const tsgoStream = watchInput.pipe(util.debounce(() => {
			onExtensionCompilationStart();
			const stream = createTsgoStream(absolutePath, { taskName: 'extensions' }, () => rewriteTsgoSourceMappingUrlsIfNeeded(false, out, baseUrl));
			// Wrap in a result stream that always emits 'end' (even on
			// error) so the debounce resets to idle and can process future
			// file changes. Errors from tsgo (e.g. type errors causing a
			// non-zero exit code) are already reported by spawnTsgo's
			// runReporter, so swallowing the stream error is safe.
			const result = es.through();
			stream.on('end', () => {
				onExtensionCompilationEnd();
				result.emit('end');
			});
			stream.on('error', () => {
				onExtensionCompilationEnd();
				result.emit('end');
			});
			return result;
		}, 200));
		const watchStream = es.merge(nonts.pipe(gulp.dest(out)), watchNonTs, tsgoStream);

		return watchStream;
	}));

	// Tasks
	gulp.task(transpileTask);
	gulp.task(compileTask);
	gulp.task(watchTask);

	return { transpileTask, compileTask, watchTask };
});

const transpileExtensionsTask = task.define('transpile-extensions', task.parallel(...tasks.map(t => t.transpileTask)));
gulp.task(transpileExtensionsTask);

export const compileExtensionsTask = task.define('compile-extensions', task.parallel(...tasks.map(t => t.compileTask)));
gulp.task(compileExtensionsTask);

export const watchExtensionsTask = task.define('watch-extensions', task.parallel(...tasks.map(t => t.watchTask)));
gulp.task(watchExtensionsTask);

//#region Extension media

export const compileExtensionMediaTask = task.define('compile-extension-media', () => ext.buildExtensionMedia(false));
gulp.task(compileExtensionMediaTask);

export const watchExtensionMedia = task.define('watch-extension-media', () => ext.buildExtensionMedia(true));
gulp.task(watchExtensionMedia);

export const compileExtensionMediaBuildTask = task.define('compile-extension-media-build', () => ext.buildExtensionMedia(false, '.build/extensions'));
gulp.task(compileExtensionMediaBuildTask);

//#endregion

// --- Start Positron ---

export const copyExtensionBinariesTask = task.define('copy-extension-binaries', () => { ext.copyExtensionBinaries('.build/extensions'); });
gulp.task(copyExtensionBinariesTask);

// --- End Positron ---

//#region Azure Pipelines

/**
 * Cleans the build directory for extensions
 */
export const cleanExtensionsBuildTask = task.define('clean-extensions-build', util.rimraf('.build/extensions'));

/**
 * brings in the marketplace extensions for the build
 */
const bundleMarketplaceExtensionsBuildTask = task.define('bundle-marketplace-extensions-build', () => ext.packageMarketplaceExtensionsStream(false).pipe(gulp.dest('.build')));

// --- Start Positron ---
const bundleBootstrapExtensionsBuildTask = task.define('bundle-bootstrap-extensions-build', () => ext.packageBootstrapExtensionsStream().pipe(gulp.dest('.build')));
// --- End Positron ---

/**
 * Compiles the non-native extensions for the build
 * @note this does not clean the directory ahead of it. See {@link cleanExtensionsBuildTask} for that.
 */
export const compileNonNativeExtensionsBuildTask = task.define('compile-non-native-extensions-build', task.series(
	bundleMarketplaceExtensionsBuildTask,
	// --- Start Positron ---
	bundleBootstrapExtensionsBuildTask,
	// --- End Positron ---
	task.define('bundle-non-native-extensions-build', () => ext.packageNonNativeLocalExtensionsStream(false, false).pipe(gulp.dest('.build')))
));
gulp.task(compileNonNativeExtensionsBuildTask);

/**
 * Compiles the native extensions for the build
 * @note this does not clean the directory ahead of it. See {@link cleanExtensionsBuildTask} for that.
 */
export const compileNativeExtensionsBuildTask = task.define('compile-native-extensions-build', () => ext.packageNativeLocalExtensionsStream(false, false).pipe(gulp.dest('.build')));
gulp.task(compileNativeExtensionsBuildTask);

/**
 * Compiles the extensions for the build.
 * This is essentially a helper task that combines {@link cleanExtensionsBuildTask}, {@link compileNonNativeExtensionsBuildTask} and {@link compileNativeExtensionsBuildTask}
 */
export const compileAllExtensionsBuildTask = task.define('compile-extensions-build', task.series(
	cleanExtensionsBuildTask,
	bundleMarketplaceExtensionsBuildTask,
	// --- Start Positron ---
	bundleBootstrapExtensionsBuildTask,
	// --- End Positron ---
	task.define('bundle-extensions-build', () => ext.packageAllLocalExtensionsStream(false, false).pipe(gulp.dest('.build'))),
	// --- Start Positron ---
	copyExtensionBinariesTask
	// --- End Positron ---
));
gulp.task(compileAllExtensionsBuildTask);



//#endregion

export const compileWebExtensionsTask = task.define('compile-web', () => buildWebExtensions(false));
gulp.task(compileWebExtensionsTask);

export const watchWebExtensionsTask = task.define('watch-web', () => buildWebExtensions(true));
gulp.task(watchWebExtensionsTask);

async function buildWebExtensions(isWatch: boolean): Promise<void> {
	const extensionsPath = path.join(root, 'extensions');

	// Find all esbuild.browser.mts files
	const esbuildConfigLocations = await nodeUtil.promisify(glob)(
		path.join(extensionsPath, '**', 'esbuild.browser.mts'),
		{ ignore: ['**/node_modules'] }
	);

	// Find all webpack configs, excluding those that will be esbuilt
	const esbuildExtensionDirs = new Set(esbuildConfigLocations.map(p => path.dirname(p)));
	const webpackConfigLocations = (await nodeUtil.promisify(glob)(
		path.join(extensionsPath, '**', 'extension-browser.webpack.config.js'),
		{ ignore: ['**/node_modules'] }
	)).filter(configPath => !esbuildExtensionDirs.has(path.dirname(configPath)));

	const promises: Promise<unknown>[] = [];

	// Esbuild for extensions
	if (esbuildConfigLocations.length > 0) {
		promises.push(
			ext.esbuildExtensions('packaging web extension (esbuild)', isWatch, esbuildConfigLocations.map(script => ({ script }))),
			// Also run type check on extensions
			...esbuildConfigLocations.flatMap(script => {
				const roots = ext.getBuildRootsForExtension(path.dirname(script));
				return roots.map(root => ext.typeCheckExtension(root, true));
			})
		);
	}

	// Run webpack for remaining extensions
	if (webpackConfigLocations.length > 0) {
		promises.push(ext.webpackExtensions('packaging web extension', isWatch, webpackConfigLocations.map(configPath => ({ configPath }))));
	}

	await Promise.all(promises);
}
