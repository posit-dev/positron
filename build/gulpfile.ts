/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { EventEmitter } from 'events';
EventEmitter.defaultMaxListeners = 100;

import glob from 'glob';
import { createRequire } from 'node:module';
import { monacoTypecheckTask /* , monacoTypecheckWatchTask */ } from './gulpfile.editor.ts';
import { compileExtensionMediaTask, compileExtensionsTask, watchExtensionsTask } from './gulpfile.extensions.ts';
import * as compilation from './lib/compilation.ts';
import * as task from './lib/gulp/task.ts';
import * as util from './lib/util.ts';
import { runEsbuildTranspile } from './lib/esbuild.ts';

// --- Start Positron ---
import { getESMPackageDependencies } from './lib/esm-package-dependencies.ts';
import { gulp } from './lib/gulp/facade.ts';
// --- End Positron ---

// Extension point names
task.task(compilation.compileExtensionPointNamesTask);

const require = createRequire(import.meta.url);

// API proposal names
task.task(compilation.compileApiProposalNamesTask);
task.task(compilation.watchApiProposalNamesTask);

// --- Start Positron ---
// ESM package dependencies copy task for development builds - copies from .build/ to out/.
const copyESMPackageDependenciesTask = task.define('copy-esm-package-dependencies', () => {
	return getESMPackageDependencies('out').pipe(gulp.dest('.'));
});

// Client Transpile
// Positron removes the copy codicons to use the one in the repository instead of the one in the node_modules.
task.task(task.define('transpile-client-esbuild', task.series(
	copyESMPackageDependenciesTask,
	task.define('esbuild-out-build', () => runEsbuildTranspile('out', false)),
)));

// Transpile only
const transpileClientTask = task.define('transpile-client', task.series(util.rimraf('out'), copyESMPackageDependenciesTask, compilation.transpileTask('src', 'out')));
task.task(transpileClientTask);

// Fast compile for development time
// Remove copy codicons since we maintain a custom codicon.ttf in the repo that includes Positron-specific icons. Copying from the npm package would overwrite these with the standard font that lacks Positron icons.
const compileClientTask = task.define('compile-client', task.series(util.rimraf('out'), copyESMPackageDependenciesTask, compilation.compileApiProposalNamesTask, compilation.compileExtensionPointNamesTask, compilation.compileTask('src', 'out', false)));
task.task(compileClientTask);

// Remove watch codicons since we maintain a custom codicon.ttf in the repo that includes Positron-specific icons. Copying from the npm package would overwrite these with the standard font that lacks Positron icons.
const watchClientTask = task.define('watch-client', task.parallel(compilation.watchTypeCheckTask('src'), compilation.watchApiProposalNamesTask, compilation.watchExtensionPointNamesTask /*, compilation.watchCodiconsTask */));
task.task(watchClientTask);

// --- End Positron ---

// All
const _compileTask = task.define('compile', task.parallel(monacoTypecheckTask, compileClientTask, compileExtensionsTask, compileExtensionMediaTask));
task.task(_compileTask);

task.task(task.define('watch', task.parallel(/* monacoTypecheckWatchTask, */ watchClientTask, watchExtensionsTask)));

// Default
task.task('default', _compileTask);

process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
	process.exit(1);
});

// Load all the gulpfiles only if running tasks other than the editor tasks
glob.sync('gulpfile.*.ts', { cwd: import.meta.dirname })
	.forEach(f => {
		return require(`./${f}`);
	});
