/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { platform } from 'os';

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

