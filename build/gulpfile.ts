/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

import glob from 'glob';
import gulp from 'gulp';
import { createRequire } from 'node:module';
import { monacoTypecheckTask /* , monacoTypecheckWatchTask */ } from './gulpfile.editor.ts';
import { compileExtensionMediaTask, compileExtensionsTask, watchExtensionsTask } from './gulpfile.extensions.ts';
import * as compilation from './lib/compilation.ts';
import * as task from './lib/task.ts';
import * as util from './lib/util.ts';
import { useEsbuildTranspile } from './buildConfig.ts';
// --- Start Positron ---
import { getESMPackageDependencies } from './lib/esm-package-dependencies.ts';
// --- End Positron ---

// Extension point names
gulp.task(compilation.compileExtensionPointNamesTask);

const require = createRequire(import.meta.url);

// API proposal names
gulp.task(compilation.compileApiProposalNamesTask);
gulp.task(compilation.watchApiProposalNamesTask);

// --- Start Positron ---
// ESM package dependencies copy task for development builds - copies from .build/ to out/.
const copyESMPackageDependenciesTask = task.define('copy-esm-package-dependencies', () => {
	return getESMPackageDependencies('out').pipe(gulp.dest('.'));
});

// SWC Client Transpile
const transpileClientSWCTask = task.define('transpile-client-esbuild', task.series(util.rimraf('out'), copyESMPackageDependenciesTask, compilation.transpileTask('src', 'out', true)));
gulp.task(transpileClientSWCTask);

// Transpile only
const transpileClientTask = task.define('transpile-client', task.series(util.rimraf('out'), copyESMPackageDependenciesTask, compilation.transpileTask('src', 'out')));
gulp.task(transpileClientTask);

// Fast compile for development time
// Remove copy codicons since we maintain a custom codicon.ttf in the repo that includes Positron-specific icons. Copying from the npm package would overwrite these with the standard font that lacks Positron icons.
const compileClientTask = task.define('compile-client', task.series(util.rimraf('out'), copyESMPackageDependenciesTask, compilation.compileApiProposalNamesTask, compilation.compileExtensionPointNamesTask, compilation.compileTask('src', 'out', false)));
gulp.task(compileClientTask);

// Remove watch codicons since we maintain a custom codicon.ttf in the repo that includes Positron-specific icons. Copying from the npm package would overwrite these with the standard font that lacks Positron icons.
const watchClientTask = useEsbuildTranspile
	? task.define('watch-client', task.parallel(compilation.watchTask('out', false, 'src', { noEmit: true }), copyESMPackageDependenciesTask, compilation.watchApiProposalNamesTask, compilation.watchExtensionPointNamesTask))
	: task.define('watch-client', task.series(util.rimraf('out'), copyESMPackageDependenciesTask, task.parallel(compilation.watchTask('out', false), compilation.watchApiProposalNamesTask, compilation.watchExtensionPointNamesTask)));
gulp.task(watchClientTask);

// --- End Positron ---

// All
const _compileTask = task.define('compile', task.parallel(monacoTypecheckTask, compileClientTask, compileExtensionsTask, compileExtensionMediaTask));
gulp.task(_compileTask);

gulp.task(task.define('watch', task.parallel(/* monacoTypecheckWatchTask, */ watchClientTask, watchExtensionsTask)));

// Default
gulp.task('default', _compileTask);

process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
	process.exit(1);
});

// Load all the gulpfiles only if running tasks other than the editor tasks
glob.sync('gulpfile.*.ts', { cwd: import.meta.dirname })
	.forEach(f => {
		return require(`./${f}`);
	});
