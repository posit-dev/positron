/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

const cp = require('child_process');
const { platform } = require('os');

// Based on platform, install the post-install dependencies.
console.log('Installing Positron post-install dependencies...');
if (platform() === 'darwin') {
	cp.execSync('./scripts/install-python-dependencies.sh', { cwd: 'extensions/positron-python' });
} else if (platform() === 'win32') {
	cp.execSync('yarn --ignore-engines gulp installPythonLibs', { cwd: 'extensions/positron-python' });
} else {
	console.error(`Error: The ${platform()} platform is not currently supported.`);
	process.exit(1);
}
