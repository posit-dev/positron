/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs-extra';

// The extension root directory.
export const EXTENSION_ROOT_DIR = path.join(__dirname, '..');

// Read the package.json file.
const packageJson = fs.readJSONSync(path.join(EXTENSION_ROOT_DIR, 'package.json'));

// The minimum supported version of R.
export const MINIMUM_R_VERSION = packageJson.positron.minimumRVersion as string;
