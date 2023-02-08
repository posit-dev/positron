/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { arch, platform } from 'os';
import { argv, env, exit } from 'process';

// Don't do anything on Windows.
if (platform() === 'win32') {
	exit(0);
}

// Make sure that zmq produces x86 / arm64 builds where appropriate.
// Note that the build pipeline sets 'npm_config_arch' to configure
// the build architecture.
if (platform() === 'darwin') {

	let configArch = env['npm_config_arch'] ?? arch();
	if (configArch === 'x64') {
		configArch = 'x86_64';
	}

	env['ARCH'] = configArch;
	env['CMAKE_OSX_ARCHITECTURES'] = configArch;

}

// Ensure that zeromq is built against the right version of node.
const result = spawnSync('electron-rebuild', ['zeromq', ...argv.slice(2)], {
	encoding: 'utf-8',
	stdio: 'inherit',
	shell: true,
});

if (result.error || result.status !== 0) {
	console.error(`Error rebuilding zeromq ${result.error ?? ''} [error code ${result.status}]`);
	exit(1);
}
