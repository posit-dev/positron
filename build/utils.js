/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const child_process = require('child_process');
const path = require('path');

const REPO_ROOT = path.dirname(__dirname);

/**
 * Get the build number for Positron.
 */
const positronBuildNumber =
	process.env.POSITRON_BUILD_NUMBER ??
	child_process.execSync(`node ${REPO_ROOT}/versions/show-version.js --build`).toString().trim();
exports.positronBuildNumber = positronBuildNumber;
