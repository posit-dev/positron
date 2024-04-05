/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

// The extension root directory.
export const EXTENSION_ROOT_DIR = path.join(__dirname, '..');

// The minimum supported version of R
const packageJson = require(path.join(EXTENSION_ROOT_DIR, 'package.json'));
export const MINIMUM_R_VERSION = packageJson.positron.minimumRVersion;
