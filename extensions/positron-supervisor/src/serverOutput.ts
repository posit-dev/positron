/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';

/**
 * A PATH value that a `terminal.integrated.env.<platform>` setting applies
 * to terminals, including the terminal that runs the supervisor.
 */
export interface TerminalPathOverride {
	/** The full name of the setting, e.g. `terminal.integrated.env.osx`. */
	setting: string;
	/** The PATH value from the setting; null removes PATH from the environment. */
	value: string | null;
}

/**
 * Returns the name of the `terminal.integrated.env.<platform>` setting for a
 * platform.
 *
 * @param platform The platform, as returned by `os.platform()`.
 */
export function terminalEnvSetting(platform: NodeJS.Platform): string {
	switch (platform) {
		case 'darwin':
			return 'terminal.integrated.env.osx';
		case 'win32':
			return 'terminal.integrated.env.windows';
		default:
			return 'terminal.integrated.env.linux';
	}
}

/**
 * Finds the PATH entry in the value of a `terminal.integrated.env.<platform>`
 * setting.
 *
 * @param platform The platform, as returned by `os.platform()`. Environment
 *   variable names are case-insensitive on Windows, so `Path` matches there.
 * @param env The value of the setting for the platform.
 * @returns The PATH override, or undefined if the setting does not set PATH.
 */
export function findTerminalPathOverride(
	platform: NodeJS.Platform,
	env: Record<string, string | null> | undefined,
): TerminalPathOverride | undefined {
	if (!env) {
		return undefined;
	}
	const key = Object.keys(env).find(name =>
		platform === 'win32' ? name.toUpperCase() === 'PATH' : name === 'PATH');
	if (key === undefined) {
		return undefined;
	}
	return { setting: terminalEnvSetting(platform), value: env[key] };
}

/**
 * Describes the captured stdout/stderr of the supervisor process, formatted
 * for appending to a startup error or log message.
 *
 * The supervisor wrapper script creates the output file as soon as it
 * starts. If the file does not exist, the wrapper script did not start. The
 * usual cause is a terminal environment whose PATH cannot find the
 * interpreter named in the script's shebang line, for example a
 * `terminal.integrated.env.<platform>` setting that replaces PATH.
 *
 * @param outFile The path of the wrapper script's output file.
 * @param pathOverride The PATH that a terminal setting applies, if any. When
 *   the output file does not exist, the description names this setting.
 * @returns A suffix that starts with "; ", or an empty string when the
 *   output file exists but is empty.
 */
export async function describeServerOutput(
	outFile: string,
	pathOverride?: TerminalPathOverride,
): Promise<string> {
	let contents: string;
	try {
		contents = await fs.promises.readFile(outFile, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return describeMissingOutput(pathOverride);
		}
		return `; could not read the output file ${outFile}: ${err}`;
	}
	return contents ? `; output:\n\n${contents}` : '';
}

/**
 * Describes why the wrapper script captured no output, and names the
 * terminal setting that changes PATH, if there is one.
 */
function describeMissingOutput(pathOverride: TerminalPathOverride | undefined): string {
	const notStarted = '; the supervisor wrapper script did not start, so it captured no output.';
	if (!pathOverride) {
		return `${notStarted} Make sure that the PATH for terminals is correct.`;
	}
	const effect = pathOverride.value === null
		? 'removes PATH from'
		: `sets PATH to ${JSON.stringify(pathOverride.value)} in`;
	return `${notStarted} The setting ${pathOverride.setting} ${effect} ` +
		`the terminal environment. Make sure that this PATH is correct.`;
}
