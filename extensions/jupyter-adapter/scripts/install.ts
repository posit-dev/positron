/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { arch, platform } from 'os';
import { env, exit } from 'process';

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

// Use our own fork of zeromq on macOS, to avoid issues with linking to
// libsodium. There are patches available on GitHub:
//
// https://github.com/kevinushey/zeromq.js
//
// but it seems like npm isn't smart enough to cache node dependencies
// installed from GitHub, so one ends up paying the installation cost
// on every invocation in that case, which is no fun.
let zeromqVersion: string;
if (platform() === 'darwin') {
	zeromqVersion = 'jmcphers/zeromq.js#e260089d6ede978aeba635a5e552f46410609b83';
} else {
	zeromqVersion = 'zeromq@6.0.0-beta.16';
}

// Check and see if we need to install.
const versionPath = `${__dirname}/../node_modules/zeromq-VERSION`;
const zeromqPath = `${__dirname}/../node_modules/zeromq`;
if (existsSync(versionPath) && existsSync(zeromqPath)) {
	const lastInstalledVersion = readFileSync(versionPath, { encoding: 'utf-8' });
	if (lastInstalledVersion === zeromqVersion) {
		console.info('zeromq is already up-to-date; nothing to do.');
		exit(0);
	}
}

// Perform the installation.
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

// Write out a file noting what version was installed.
writeFileSync(versionPath, zeromqVersion, {
	encoding: 'utf-8'
});
