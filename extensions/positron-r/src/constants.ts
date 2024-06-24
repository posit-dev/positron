/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs-extra';

// The extension root directory.
export const EXTENSION_ROOT_DIR = path.join(__dirname, '..');

// Read the package.json file.
const packageJson = fs.readJSONSync(path.join(EXTENSION_ROOT_DIR, 'package.json'));

// The minimum supported version of R.
export const MINIMUM_R_VERSION = packageJson.positron.minimumRVersion as string;

// The minimum supported version of renv.
export const MINIMUM_RENV_VERSION = packageJson.positron.minimumRenvVersion as string;
