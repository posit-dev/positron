/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import gulp from 'gulp';
import * as util from './lib/util.ts';
import * as date from './lib/date.ts';
import * as task from './lib/task.ts';
import * as compilation from './lib/compilation.ts';
// --- Start Positron ---
import { getESMPackageDependencies } from './lib/esm-package-dependencies.ts';

// ESM package dependencies copy task for production builds - copies from .build/ to out-build/.
const copyESMPackageDependenciesTask = task.define('copy-esm-package-dependencies-for-build', () => {
	return getESMPackageDependencies('out-build').pipe(gulp.dest('.'));
});
// --- End Positron ---

function makeCompileBuildTask(disableMangle: boolean) {
	return task.series(
		util.rimraf('out-build'),
		// --- Start Positron ---
		copyESMPackageDependenciesTask,
		// --- End Positron ---
		date.writeISODate('out-build'),
		compilation.compileApiProposalNamesTask,
		compilation.compileTask('src', 'out-build', true, { disableMangle })
	);
}

// Local/PR compile, including nls and inline sources in sourcemaps, minification, no mangling
export const compileBuildWithoutManglingTask = task.define('compile-build-without-mangling', makeCompileBuildTask(true));
gulp.task(compileBuildWithoutManglingTask);

// CI compile, including nls and inline sources in sourcemaps, mangling, minification, for build
export const compileBuildWithManglingTask = task.define('compile-build-with-mangling', makeCompileBuildTask(false));
gulp.task(compileBuildWithManglingTask);
