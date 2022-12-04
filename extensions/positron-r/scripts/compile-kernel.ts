/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { copyFileSync, mkdirSync } from 'fs';
import { chdir, env, exit } from 'process';

// Check whether cargo is available
const whichCargo = spawnSync('which', ['cargo'], { encoding: 'utf-8' });
if (whichCargo.status !== 0 || whichCargo.error) {
	console.log(`cargo is not available; skipping build of Amalthea kernel.`);
	exit(1);
}

// Enter the kernel directory
chdir(`${__dirname}/../amalthea`);

// Start building the arguments to cargo build
const args = ['build', '--release'];

// If RUST_TARGET is set, use it
const rustTarget = env['RUST_TARGET'];
if (rustTarget) {
	env['PKG_CONFIG_ALLOW_CROSS'] = '1';
	args.push('--target', rustTarget);
}

// Build it!
const buildResult = spawnSync('cargo', args, { encoding: 'utf-8', stdio: 'inherit' });
if (buildResult.status !== 0 || buildResult.error) {
	console.log(`ERROR: cargo build failed [exit status ${buildResult.status}]`);
	exit(1);
}

// If we built a cross-compiled version of the ark kernel, copy it to the right place.
if (rustTarget) {
	const sourceFile = `target/${rustTarget}/release/ark`;
	const targetFile = 'target/release/ark';
	mkdirSync('target/release', { recursive: true });
	copyFileSync(sourceFile, targetFile);
}
