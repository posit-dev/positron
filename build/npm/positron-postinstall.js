/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

const cp = require('child_process');
const { platform } = require('os');

// Based on platform, install the post-install dependencies.
console.log('Installing Positron post-install dependencies...');
if (platform() === 'darwin') {
	cp.execSync('./scripts/install-python-dependencies.sh', { cwd: 'extensions/positron-python' });
} else {
	cp.execSync('yarn --ignore-engines gulp installPythonLibs', { cwd: 'extensions/positron-python' });
}
