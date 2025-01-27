/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const { execSync } = require('child_process');

// Install or update the PET server binary
execSync('npm run install-pet', {
    stdio: 'inherit',
});
