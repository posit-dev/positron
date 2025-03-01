/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { pathExists, readFile } from '../externalDependencies';
import { splitLines } from '../../../common/stringUtils';
import { getPyvenvConfigPathsFrom } from './simplevirtualenvs';

/**
 * Checks if the given interpreter belongs to a uv-managed environment.
 * If so, the interpreter is expected to have a `pyvenv.cfg` file in the venv folder with a `uv` key.
 * @param interpreterPath Absolute path to the python interpreter.
 * @returns {boolean} Returns true if the interpreter belongs to a uv environment.
 */
export async function isUvEnvironment(interpreterPath: string): Promise<boolean> {
    const configPaths = getPyvenvConfigPathsFrom(interpreterPath);
    for (const configPath of configPaths) {
        if (await pathExists(configPath)) {
            try {
                const lines = splitLines(await readFile(configPath));
                return lines.some((line) => {
                    const parts = line.split('=');
                    if (parts.length === 2) {
                        return parts[0].toLowerCase().trim() === 'uv';
                    }
                    return false;
                });
            } catch (ex) {
                return false;
            }
        }
    }
    return false;
}
