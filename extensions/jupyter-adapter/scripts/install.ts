/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { arch, platform } from 'os';
import { env } from 'process';

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

let zeromqVersion = 'zeromq@6.0.0-beta.16';

if (platform() === 'darwin') {
	zeromqVersion = [
		'kevinushey/zeromq.js',
		'fa6b52f85293d9fe14958d18f031d65520afd272'
	].join('#');
}

const args = [
	'install',
	'--no-save',
	'--no-package-lock',
	zeromqVersion,
];

spawnSync('npm', args, {
	'stdio': 'inherit',
	'shell': true,
});

