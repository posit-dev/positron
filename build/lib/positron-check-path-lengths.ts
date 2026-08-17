/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import fancyLog from 'fancy-log';
import ansiColors from 'ansi-colors';
import { MAX_RELATIVE_PATH_LENGTH, describeBudget } from './positron-path-budget.ts';

/** How many offenders to name when the check fails. */
const REPORTED_OFFENDERS = 10;

export interface IPathLengthResult {
	/** Number of files walked. */
	fileCount: number;
	/** Every path over budget, longest first, relative to the install directory. */
	offenders: string[];
	/** Longest path found, relative to the install directory. */
	longest: string;
}

/**
 * Collects every file under `root` as a path relative to `root`, with Windows
 * separators. A build on any platform then measures the lengths that Windows
 * gets. The walk itself uses native paths, and the function converts the
 * separators only at the end.
 *
 * The function does not follow a symlink. The tree holds a few symlinks, and a
 * walk through them counts a file twice and can find a cycle.
 */
function collectRelativePaths(root: string): string[] {
	const results: string[] = [];
	const stack: string[] = [''];

	while (stack.length) {
		const relativeDir = stack.pop()!;
		const entries = fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true });

		for (const entry of entries) {
			const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;

			if (entry.isDirectory()) {
				stack.push(relativePath);
			} else if (entry.isFile()) {
				results.push(relativePath.split(path.sep).join('\\'));
			}
		}
	}

	return results;
}

/**
 * Measures the packaged application tree against the Windows MAX_PATH budget.
 *
 * `appRoot` must be the directory that matches the Windows install directory.
 * The paths that this function measures are then the paths that Inno Setup
 * writes. On Windows and Linux, `appRoot` is the packaged output folder. On
 * macOS it is `<product>.app/Contents`, where `Resources/app/...` has the same
 * length as `resources\app\...` on Windows.
 */
export function measurePathLengths(appRoot: string): IPathLengthResult {
	const relativePaths = collectRelativePaths(appRoot);
	relativePaths.sort((a, b) => b.length - a.length);

	return {
		fileCount: relativePaths.length,
		offenders: relativePaths.filter(p => p.length > MAX_RELATIVE_PATH_LENGTH),
		longest: relativePaths[0] ?? ''
	};
}

/**
 * Fails the build when the packaged tree contains a path that a Windows
 * per-user install or auto-update cannot write.
 *
 * The extension trees that own the longest paths are the same on each platform.
 * A check during the packaging of any platform therefore finds a regression
 * before it reaches a Windows build.
 */
export function checkPathLengths(appRoot: string): void {
	if (!fs.existsSync(appRoot)) {
		throw new Error(`Cannot check path lengths. ${appRoot} does not exist.`);
	}

	const { fileCount, offenders, longest } = measurePathLengths(appRoot);

	if (offenders.length === 0) {
		fancyLog(`Path lengths ok: the longest of ${fileCount} shipped paths is `
			+ `${ansiColors.cyan(String(longest.length))} of ${MAX_RELATIVE_PATH_LENGTH} characters `
			+ `(${ansiColors.gray(longest)})`);
		return;
	}

	fancyLog.error(`${offenders.length} shipped path(s) are longer than the Windows MAX_PATH `
		+ `budget of ${MAX_RELATIVE_PATH_LENGTH} characters (${describeBudget()}).`);
	fancyLog.error('A Windows per-user install or auto-update cannot write these files:');

	for (const offender of offenders.slice(0, REPORTED_OFFENDERS)) {
		fancyLog.error(`  ${ansiColors.yellow(String(offender.length))}  ${offender}`);
	}

	if (offenders.length > REPORTED_OFFENDERS) {
		fancyLog.error(`  ...and ${offenders.length - REPORTED_OFFENDERS} more.`);
	}

	fancyLog.error('Make these paths shorter, or do not ship these files.');
	fancyLog.error('Do not raise the budget.');
	fancyLog.error('See build/lib/positron-path-budget.ts and posit-dev/positron#14702.');

	throw new Error(`${offenders.length} shipped path(s) are longer than the Windows MAX_PATH budget`);
}
