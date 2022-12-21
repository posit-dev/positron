/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { normalize } from 'path';
import { env, exit } from 'process';

// Compile the R kernel
execSync('yarn run compile-kernel', {
	stdio: 'inherit'
});

// On macOS, we use install_name_tool to fix up the link to libR.dylib.
//
// Note that we still try to link with '-undefined dynamic_lookup', just to
// ensure that linking succeeds when we compile against a version of R compiled
// for a different architecture. This is mostly relevant when producing x86_64
// builds of ark on an arm64 machine.
//
// However, because using libR-sys still implies that the path to the R library
// ends up in the library load list, we have to modify that after the fact anyhow.
if (process.platform === 'darwin') {

	// Get the path to the ark executable.
	const buildType = env['ARK_BUILD_TYPE'] ?? 'release';
	const arkPath = normalize(`${__dirname}/../amalthea/target/${buildType}/ark`);
	if (!existsSync(arkPath)) {
		exit(0);
	}

	// Figure out what version of R that we linked to.
	const otoolCommand = `otool -L '${arkPath}' | grep libR.dylib | cut -c2- | cut -d' ' -f1`;
	const oldLibraryPath = execSync(otoolCommand, { encoding: 'utf-8' }).trim();

	// Change that to use @rpath instead. We don't actually set an @rpath in the compiled
	// executable (we inject R via DYLD_INSERT_LIBRARIES) so this is mainly just hygiene.
	const newLibraryPath = '@rpath/libR.dylib';
	execSync(`install_name_tool -change "${oldLibraryPath}" "${newLibraryPath}" "${arkPath}"`);

}
