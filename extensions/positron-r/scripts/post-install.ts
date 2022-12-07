/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { execSync } from 'child_process';
import { existsSync } from 'fs';

// On macOS, we use install_name_tool to fix up the link to libR.dylib.
// This is done instead of '-undefined dynamic_lookup' since it avoids
// the need to thread that through all of the Rust dependencies using R.
if (process.platform === 'darwin') {

	// Get the path to the ark executable.
	// Note that the intention is that we only run this for
	// package (release) builds, so this file might not exist
	// in development configurations. That's okay.
	const arkPath = 'amalthea/target/release/ark';
	if (!existsSync(arkPath)) {
		process.exit(0);
	}

	// Figure out what version of R that we linked to.
	const otoolCommand = `otool -L "${arkPath}" | grep libR.dylib | awk "{ print $1 }"`;
	const oldLibraryPath = execSync(otoolCommand, { encoding: 'utf-8' }).trim();

	// Change that to use @rpath instead. We don't actually set an @rpath in the compiled
	// executable (we inject R via DYLD_INSERT_LIBRARIES) so this is mainly just hygiene.
	const newLibraryPath = '@rpath/libR.dylib';
	execSync(`install_name_tool -change "${oldLibraryPath}" "${newLibraryPath}" "${arkPath}"`);

}
