/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import gulp from 'gulp';
import rename from 'gulp-rename';
import * as path from 'path';

/**
 * Gets ESM package dependencies from .build/ directory for copying to build outputs.
 * Similar to getQuartoBinaries() pattern.
 *
 * ESM package dependencies are built once during postinstall to .build/esm-package-dependencies/
 * and then copied to the appropriate output directories (out/ or out-build/) as needed.
 *
 * @param targetDir - Target directory within output (e.g., 'out', 'out-build')
 * @returns Gulp stream of ESM package dependency files
 */
export function getESMPackageDependencies(targetDir: string = 'out') {
	return gulp.src('.build/esm-package-dependencies/**')
		.pipe(rename(function (p) {
			p.dirname = path.join(targetDir, 'esm-package-dependencies', p.dirname ?? '');
		}));
}
