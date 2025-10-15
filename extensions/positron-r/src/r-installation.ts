/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver';
import * as path from 'path';
import * as fs from 'fs';
import { extractValue, readLines, removeSurroundingQuotes } from './util';
import { LOGGER } from './extension';
import { MINIMUM_R_VERSION } from './constants';
import { arePathsSame } from './path-utils';
import { getDefaultInterpreterPath, isExcludedInstallation } from './interpreter-settings.js';
import { sniffWindowsBinaryArchitecture } from './kernel.js';

/**
 * Extra metadata included in the LanguageRuntimeMetadata for R installations.
 */
export interface RMetadataExtra {
	/** R's home path (R_HOME) */
	readonly homepath: string;

	/** R's binary path */
	readonly binpath: string;

	/** R's Rscript path */
	readonly scriptpath: string;

	/** Architecture reported by this installation (normalized, e.g. arm64, x86_64) */
	readonly arch?: string;

	/**
	 * Is this known to be the current version of R?
	 * https://github.com/posit-dev/positron/issues/2659
	 */
	readonly current: boolean;

	/**
	 * Is this specified as the default R interpreter in user settings?
	 */
	readonly default: boolean;

	/**
	 * How did we discover this R binary?
	 */
	readonly reasonDiscovered: ReasonDiscovered[] | null;
}

/**
 * Enum represents how we discovered an R binary.
 */
export enum ReasonDiscovered {
	affiliated = "affiliated",
	registry = "registry",
	/* eslint-disable @typescript-eslint/naming-convention */
	PATH = "PATH",
	HQ = "HQ",
	CONDA = "CONDA",
	/* eslint-enable @typescript-eslint/naming-convention */
	adHoc = "adHoc",
	userSetting = "userSetting",
	server = "server"
}

/**
 * Enum represents why we rejected an R binary.
 */
export enum ReasonRejected {
	invalid = "invalid",
	unsupported = "unsupported",
	nonOrthogonal = "nonOrthogonal",
	excluded = "excluded",
}

export function friendlyReason(reason: ReasonDiscovered | ReasonRejected | null): string {
	if (Object.values(ReasonDiscovered).includes(reason as ReasonDiscovered)) {
		switch (reason) {
			case ReasonDiscovered.affiliated:
				return 'Runtime previously affiliated with this workspace';
			case ReasonDiscovered.registry:
				return 'Found in Windows registry';
			case ReasonDiscovered.PATH:
				return 'Found in PATH, via the `which` command';
			case ReasonDiscovered.HQ:
				return 'Found in the primary location for R versions on this operating system';
			case ReasonDiscovered.CONDA:
				return 'Found in a Conda environment';
			case ReasonDiscovered.adHoc:
				return 'Found in a conventional location for symlinked R binaries';
			case ReasonDiscovered.userSetting:
				return 'Found in a location specified via user settings';
			case ReasonDiscovered.server:
				return 'Found in a conventional location for R binaries installed on a server';
		}
	} else if (Object.values(ReasonRejected).includes(reason as ReasonRejected)) {
		switch (reason) {
			case ReasonRejected.invalid:
				return 'Invalid installation';
			case ReasonRejected.unsupported:
				return `Unsupported version, i.e. version is less than ${MINIMUM_R_VERSION}`;
			case ReasonRejected.nonOrthogonal:
				return 'Non-orthogonal installation that is also not the current version';
			case ReasonRejected.excluded:
				return 'Installation path was excluded via user settings';
		}
	}

	return 'Unknown reason';
}

/**
 * Represents a single installation of R on a user's system.
 */
export class RInstallation {
	// there are many reasons that we might deem a putative R installation to be unusable
	// downstream users of RInstallation should filter for `usable` is `true`
	public readonly usable: boolean = false;

	// is the version >= positron's minimum version?
	public readonly supported: boolean = false;

	// we are gradually increasing user visibility into how the list of available R installations
	// is determined; these fields are part of that plan
	public readonly reasonDiscovered: ReasonDiscovered[] | null = null;
	public readonly reasonRejected: ReasonRejected | null = null;

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
	public readonly default: boolean = false;

	/**
	 * Represents an installation of R on the user's system.
	 *
	 * @param pth Filepath for an R "binary" (on macOS and linux, this is actually a shell script)
	 * @param current Whether this installation is known to be the current version of R
	 * @param reasonDiscovered How we discovered this R binary (and there could be more than one
	 *   reason)
	 */
	constructor(
		pth: string,
		current: boolean = false,
		reasonDiscovered: ReasonDiscovered[] | null = null
	) {
		pth = path.normalize(pth);

		LOGGER.info(`Candidate R binary at ${pth}`);

		this.binpath = pth;
		this.current = current;
		this.reasonDiscovered = reasonDiscovered;

		// Check if the installation is the default R interpreter for Positron
		const defaultInterpreterPath = getDefaultInterpreterPath();
		this.default = defaultInterpreterPath
			? arePathsSame(pth, defaultInterpreterPath)
			: false;

		const rHomePath = getRHomePath(pth);
		if (!rHomePath) {
			this.reasonRejected = ReasonRejected.invalid;
			this.usable = false;
			return;
		}
		this.homepath = rHomePath;

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
		// We have actually seen an R "installation" that doesn't have the base packages!
		// https://github.com/posit-dev/positron/issues/1314
		if (!fs.existsSync(descPath)) {
			LOGGER.info(`Can\'t find DESCRIPTION for the utils package at ${descPath}`);
			this.reasonRejected = ReasonRejected.invalid;
			this.usable = false;
			return;
		}
		const descLines = readLines(descPath);
		const targetLine2 = descLines.filter(line => line.match('Built'))[0];
		if (!targetLine2) {
			LOGGER.info(`Can't find 'Built' field for the utils package in its DESCRIPTION: ${descPath}`);
			this.reasonRejected = ReasonRejected.invalid;
			this.usable = false;
			return;
		}
		// macOS arm64: Built: R 4.3.1; aarch64-apple-darwin20; 2023-06-16 21:52:54 UTC; unix
		// macOS intel: Built: R 4.3.1; x86_64-apple-darwin20; 2023-06-16 21:51:34 UTC; unix
		// linux: Built: R 4.2.3; x86_64-pc-linux-gnu; 2023-03-15 09:03:13 UTC; unix
		// windows: Built: R 4.3.2; x86_64-w64-mingw32; 2023-10-31 13:57:45 UTC; windows
		const builtField = extractValue(targetLine2, 'Built', ':');
		const builtParts = builtField.split(new RegExp(';\\s+'));

		const versionPart = builtParts[0];
		this.semVersion = semver.coerce(versionPart) ?? new semver.SemVer('0.0.1');
		this.version = this.semVersion.format();

		const minimumSupportedVersion = semver.coerce(MINIMUM_R_VERSION)!;
		this.supported = semver.gte(this.semVersion, minimumSupportedVersion);

		if (this.supported) {
			this.usable = this.current || this.orthogonal;
			if (!this.usable) {
				this.reasonRejected = ReasonRejected.nonOrthogonal;
			} else {
				// Check if this installation has been excluded via settings
				const excluded = isExcludedInstallation(this.binpath);
				if (excluded) {
					LOGGER.info(`R installation excluded via settings: ${this.binpath}`);
					this.reasonRejected = ReasonRejected.excluded;
					this.usable = false;
				}
			}
		} else {
			this.reasonRejected = ReasonRejected.unsupported;
			this.usable = false;
		}

		const platformPart = builtParts[1];
		const architecture = platformPart.match('^(aarch64|x86_64)');
		let derivedArch = '';

		if (architecture) {
			const arch = architecture[1];

			// Remap known architectures to equivalent values used by Rig,
			// just for overall consistency and familiarity
			if (arch === 'aarch64') {
				derivedArch = 'arm64';
			} else if (arch === 'x86_64') {
				derivedArch = 'x86_64';
			} else {
				// Should never happen because of how our `match()` works
				console.warn(`Matched an unknown architecture '${arch}' for R '${this.version}'.`);
				derivedArch = arch;
			}
		}

		if (process.platform === 'win32') {
			// Windows arm builds currently misreport in the Built field; prefer the path signature (e.g. ...-aarch64).
			const normalizedBin = this.binpath.toLowerCase();
			const pathSegments = normalizedBin.split(path.sep).filter(segment => segment.length > 0);
			if (pathSegments.some(segment => segment === 'arm64' || segment === 'aarch64' || segment.endsWith('-arm64') || segment.endsWith('-aarch64'))) {
				derivedArch = 'arm64';
			} else if (!derivedArch && pathSegments.some(segment => segment === 'x64' || segment.endsWith('-x64'))) {
				derivedArch = 'x86_64';
			}

			// Double check against the binary itself and log a warning if there's a mismatch.
			const detectedArch = sniffWindowsBinaryArchitecture(this.binpath);
			if (detectedArch && detectedArch !== derivedArch) {
				LOGGER.warn(`Sniffed Windows architecture from R binary: ${detectedArch}, which differs from the derived architecture ${derivedArch} for R ${this.version} at ${this.binpath}`);
			}
		}

		this.arch = derivedArch;

		LOGGER.info(`R installation discovered: ${JSON.stringify(this, null, 2)}`);
	}

	toJSON() {
		return {
			...this,
			reasonDiscovered: this.reasonDiscovered?.map(friendlyReason) ?? null,
			reasonRejected: this.reasonRejected ? friendlyReason(this.reasonRejected) : null
		};
	}
}

export function getRHomePath(binpath: string): string | undefined {
	switch (process.platform) {
		case 'darwin':
		case 'linux':
			return getRHomePathNotWindows(binpath);
		case 'win32':
			return getRHomePathWindows(binpath);
		default:
			throw new Error('Unsupported platform');
	}
}

function getRHomePathNotWindows(binpath: string): string | undefined {
	const binLines = readLines(binpath);
	const re = new RegExp('Shell wrapper for R executable');
	if (!binLines.some(x => re.test(x))) {
		LOGGER.info(`Binary is not a shell script wrapping the executable: ${binpath}`);
		return undefined;
	}
	const targetLine = binLines.find(line => line.match('R_HOME_DIR'));
	if (!targetLine) {
		LOGGER.info(`Can\'t determine R_HOME_DIR from the binary: ${binpath}`);
		return undefined;
	}
	// macOS: R_HOME_DIR=/Library/Frameworks/R.framework/Versions/4.3-arm64/Resources
	// macOS non-orthogonal: R_HOME_DIR=/Library/Frameworks/R.framework/Resources
	// linux: R_HOME_DIR=/opt/R/4.2.3/lib/R
	// On linux we have seen the path surrounded with double quotes, which must be removed (#3696).
	const R_HOME_DIR = removeSurroundingQuotes(extractValue(targetLine, 'R_HOME_DIR'));
	const homepath = R_HOME_DIR;
	if (homepath === '') {
		LOGGER.info(`Can\'t determine R_HOME_DIR from the binary: ${binpath}`);
		return undefined;
	}
	return homepath;
}

function getRHomePathWindows(binpath: string): string | undefined {
	// find right-most 'bin' in the path and take everything to the left of it
	// Examples of binpaths:
	// "C:\Program Files\R\R-4.3.2\bin\x64\R.exe" <-- we prefer this, if both are present
	// "C:\Program Files\R\R-4.3.2\bin\R.exe"     <-- usually a shim for the path above
	const binIndex = binpath.lastIndexOf(path.sep + 'bin' + path.sep);
	if (binIndex === -1) {
		LOGGER.info(`Can\'t determine R_HOME_DIR from the path to the R binary: ${binpath}`);
		return undefined;
	} else {
		const pathUpToBin = binpath.substring(0, binIndex);
		return pathUpToBin;
	}

}
