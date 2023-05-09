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

// Use an older version of zeromq on macOS, to avoid issues with
// linking to libsodium. There are patches available on GitHub:
//
// https://github.com/kevinushey/zeromq.js
//
// but it seems like npm isn't smart enough to cache node dependencies
// installed from GitHub, so one ends up paying the installation cost
// on every invocation in that case, which is no fun.
const zeromqVersion = platform() === 'darwin'
	?
	[
		'kevinushey/zeromq.js',
		'fa6b52f85293d9fe14958d18f031d65520afd272'
	].join('#')
	: 'zeromq@6.0.0-beta.16';

const args = [
	'install',
	'--no-audit',
	'--no-fund',
	'--no-save',
	'--no-package-lock',
	zeromqVersion,
];

spawnSync('npm', args, {
	'stdio': 'inherit',
	'shell': true,
});

