/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const gulp = require('gulp');
const util = require('./lib/util');
const date = require('./lib/date');
const task = require('./lib/task');
const compilation = require('./lib/compilation');

/**
 * @param {boolean} disableMangle
 */
function makeCompileBuildTask(disableMangle) {
	return task.series(
		util.rimraf('out-build'),
		date.writeISODate('out-build'),
		compilation.compileApiProposalNamesTask,
		compilation.compileTask('src', 'out-build', true, { disableMangle })
	);
}

// Full compile, including nls and inline sources in sourcemaps, mangling, minification, for build
// --- Start PWB: fast build ---
const compileBuildTask = task.define('compile-build', makeCompileBuildTask(process.env.DISABLE_MANGLE === 'true'));
// --- End PWB ---
gulp.task(compileBuildTask);
exports.compileBuildTask = compileBuildTask;

// Full compile for PR ci, e.g no mangling
const compileBuildTaskPullRequest = task.define('compile-build-pr', makeCompileBuildTask(true));
gulp.task(compileBuildTaskPullRequest);
exports.compileBuildTaskPullRequest = compileBuildTaskPullRequest;
