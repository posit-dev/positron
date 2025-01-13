/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUpdate } from '../common/update.js';


const POSITRON_VERSION_REGEX = /^\d{4}\.\d{2}\.\d+(-\d+)?$/;

/**
 * A Positron version in the format of YYYY.MM.patch-build
 *
 * The month is zero-padded and the build number is optional.
 */
export interface IPositronVersion {
	year: number;
	month: number;
	patch: number;
	build?: number;
}

/**
 * Parses a calendar version from YYYY.MM.patch-build into IPositronVersion
 *
 * @param version - The version string to parse.
 */
export function parse(version: string): IPositronVersion {
	if (!POSITRON_VERSION_REGEX.test(version)) {
		throw new Error('Version format must be YYYY.MM.patch-build');
	}
	const [year, month, patchBuild] = version.split('.');
	const [patch, build] = patchBuild.split('-').map(Number);

	return { year: Number(year), month: Number(month), patch, build };
}

/**
 * Checks if a version is valid. Each part of the version must be a number.
 *
 * @param version - The version string to check.
 */
export function valid(version: string): boolean {
	return POSITRON_VERSION_REGEX.test(version);
}

/**
 * Compares two versions of Positron. If either version does not have a build number, it is equal
 * given the other parts are equal.
 *
 * @param v1 - The first version to compare.
 * @param v2 - The second version to compare.
 * @returns negative if v1 is less than v2, 0 if they are equal, and positive if v1 is greater than v2.
 */
export function compare(v1: string, v2: string): number {
	const p1 = parse(v1);
	const p2 = parse(v2);

	if (p1.year !== p2.year) {
		return p1.year - p2.year;
	}

	if (p1.month !== p2.month) {
		return p1.month - p2.month;
	}

	if (p1.patch !== p2.patch) {
		return p1.patch - p2.patch;
	}

	if (p1.build === undefined || p2.build === undefined) {
		return 0;
	}

	return (p1.build || 0) - (p2.build || 0);
}

/**
 * Checks if an update is newer than the current version.
 *
 * @param update - The update to check.
 * @param currentVersion - The current version to compare against.
 * @returns true if the update is newer, false otherwise.
 */
export function hasUpdate(update: IUpdate, currentVersion: string): boolean {
	const latestVersion = update.version;

	if (!valid(latestVersion)) {
		throw new Error(`Invalid version format ${latestVersion}`);
	}

	if (!valid(currentVersion)) {
		throw new Error(`Invalid version format ${currentVersion}`);
	}

	return compare(latestVersion, currentVersion) >= 1;
}
