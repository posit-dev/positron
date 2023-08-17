/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver';
import * as path from 'path';
import { extractValue, readLines } from './util';

/**
 * Represents a single installation of R on a user's system.
 */
export class RInstallation {
	public readonly binpath: string = '';
	public readonly homepath: string = '';
	// The semVersion field was added because changing the version field from a string that's
	// "major.minor" to an instance of SemVer (conveying major.minor.patch) would have
	// downstream consequence I don't want to take on now. But we can probably rationalize this
	// in the future.
	public readonly semVersion: semver.SemVer = new semver.SemVer('0.0.1');
	public readonly version: string = '';
	public readonly arch: string = '';
	public readonly current: boolean = false;
	public readonly orthogonal: boolean = false;

	/**
	 * Represents an installation of R on the user's system.
	 *
	 * @param pth Filepath for an R "binary" (on macOS and linux, this is actually a
	 *   shell script)
	 * @param current Whether this installation is set as the current version of
	 *   R
	 */
	constructor(pth: string, current: boolean = false) {
		this.binpath = pth;
		this.current = current;

		const binLines = readLines(this.binpath);
		const re = new RegExp('Shell wrapper for R executable');
		if (!binLines.some(x => re.test(x))) {
			return;
		}
		const targetLine = binLines.find(line => line.match('R_HOME_DIR'));
		if (!targetLine) {
			return;
		}
		// macOS: R_HOME_DIR=/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources
		// macOS non-orthogonal: R_HOME_DIR=/Library/Frameworks/R.framework/Resources
		// linux: R_HOME_DIR=/opt/R/4.2.3/lib/R
		const R_HOME_DIR = extractValue(targetLine, 'R_HOME_DIR');
		this.homepath = R_HOME_DIR;
		if (this.homepath === '') {
			return;
		}

		// orthogonality is a concern specific to macOS
		// a non-orthogonal R "binary" is hard-wired to launch the current version of R,
		// so it only works when it actually is the current version of R
		// learn more in https://github.com/r-lib/rig/blob/main/src/macos.rs
		// see is_orthogonal(), make_orthogonal_()
		const re2 = new RegExp('R[.]framework/Resources');
		this.orthogonal = !re2.test(this.homepath);

		// make sure to target a base package that contains compiled code, so the
		// 'Built' field contains the platform info
		const descPath = path.join(this.homepath, 'library', 'utils', 'DESCRIPTION');
		const descLines = readLines(descPath);
		const targetLine2 = descLines.filter(line => line.match('Built'))[0];
		if (!targetLine2) {
			return;
		}
		// macOS arm64: Built: R 4.3.1; aarch64-apple-darwin20; 2023-06-16 21:52:54 UTC; unix
		// macOS intel: Built: R 4.3.1; x86_64-apple-darwin20; 2023-06-16 21:51:34 UTC; unix
		// linux: Built: R 4.2.3; x86_64-pc-linux-gnu; 2023-03-15 09:03:13 UTC; unix
		const builtField = extractValue(targetLine2, 'Built', ':');
		const builtParts = builtField.split(new RegExp(';\\s+'));

		const versionPart = builtParts[0];
		this.semVersion = semver.coerce(versionPart) ?? new semver.SemVer('0.0.1');
		this.version = `${semver.major(this.semVersion)}.${semver.minor(this.semVersion)}`;

		const platformPart = builtParts[1];
		const architecture = platformPart.match('^(aarch64|x86_64)');
		this.arch = architecture ? architecture[1] : '';
	}
}
