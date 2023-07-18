/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'child_process';
import { copyFileSync, mkdirSync } from 'fs';
import { chdir, env, exit } from 'process';

// Check whether cargo is available
const whichCargoResult = spawnSync('which', ['cargo'], { encoding: 'utf-8' });
if (whichCargoResult.status !== 0 || whichCargoResult.error) {
	console.log(`cargo is not available; skipping build of Amalthea kernel.`);
	exit(0);
}

// Enter the kernel directory
chdir(`${__dirname}/../amalthea`);

// `cargo clean` if on CI, because old builds are likely persistent due to using a self-hosted runner.
// Locally we `cargo clean` manually as needed, to save time.
const ci = env['CI'];
if (ci) {
	const cargoCleanResult = spawnSync('cargo', ['clean'], { encoding: 'utf-8', stdio: 'inherit' });
	if (cargoCleanResult.status !== 0 || cargoCleanResult.error) {
		console.log(`ERROR: cargo clean failed [exit status ${cargoCleanResult.status}]`);
		exit(1);
	}
}

// Start building the arguments to cargo build.
const cargoBuildArgs = ['build'];

// Perform a release build if requested.
const buildType = env['ARK_BUILD_TYPE'] ?? 'debug';
if (buildType === 'release') {
	cargoBuildArgs.push('--release');
}

// If RUST_TARGET is set, use it
const rustTarget = env['RUST_TARGET'];
if (rustTarget) {
	env['PKG_CONFIG_ALLOW_CROSS'] = '1';
	cargoBuildArgs.push('--target', rustTarget);
}

// Build it!
const cargoBuildResult = spawnSync('cargo', cargoBuildArgs, { encoding: 'utf-8', stdio: 'inherit' });
if (cargoBuildResult.status !== 0 || cargoBuildResult.error) {
	console.log(`ERROR: cargo build failed [exit status ${cargoBuildResult.status}]`);
	exit(1);
}

// If we built a cross-compiled version of the ark kernel, copy it to the right place.
if (rustTarget) {
	const sourceFile = `target/${rustTarget}/release/ark`;
	const targetFile = 'target/release/ark';
	mkdirSync('target/release', { recursive: true });
	copyFileSync(sourceFile, targetFile);
}
