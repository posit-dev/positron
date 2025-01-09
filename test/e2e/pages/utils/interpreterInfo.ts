/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export enum InterpreterType {
	Python = 'Python',
	R = 'R'
}

export interface InterpreterInfo {
	type: InterpreterType;
	version: string; // e.g. Python 3.12.4 64-bit or Python 3.9.19 64-bit ('3.9.19') or R 4.4.0
	path: string; // e.g. /usr/local/bin/python3 or ~/.pyenv/versions/3.9.19/bin/python or /Library/Frameworks/R.framework/Versions/4.4-arm64/Resources/bin/R
	source?: string; // e.g. Pyenv or Global or Conda or System
}

/**
 * Determines the interpreter type based on an interpreter version string.
 * @param version The version string to extract the interpreter type from.
 * @returns The corresponding known interpreter type or undefined if unknown.
 */
export const getInterpreterType = (version: string): InterpreterType | undefined => {
	for (const [key, value] of Object.entries(InterpreterType)) {
		// Check if the versions starts with the interpreter type followed by a space
		// e.g. version = Python 3.10.4 (Pyenv) would result in InterpreterType.Python
		if (version.startsWith(`${key} `)) {
			return value;
		}
	}
	return undefined;
};
