/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';

import { traceInfo, traceLog, traceVerbose } from '../logging';
import { getConfiguration } from '../common/vscodeApis/workspaceApis';
import { arePathsSame, isParentPath } from '../pythonEnvironments/common/externalDependencies';
import { INTERPRETERS_EXCLUDE_SETTING_KEY, INTERPRETERS_INCLUDE_SETTING_KEY } from '../common/constants';

/**
 * Gets the list of interpreters that the user has explicitly included in the settings. Converts
 * relative and aliased paths to absolute paths.
 * @returns List of interpreters that the user has explicitly included in the settings.
 */
export function getUserIncludedInterpreters(): string[] {
    const interpretersInclude = getConfiguration('python').get<string[]>(INTERPRETERS_INCLUDE_SETTING_KEY) ?? [];
    if (interpretersInclude.length > 0) {
        return interpretersInclude.filter((item) => {
            if (path.isAbsolute(item)) {
                return true;
            }
            traceLog(`[getUserIncludedInterpreters]: interpreter path ${item} is not absolute...ignoring`);
            return false;
        });
    }
    traceLog(`[getUserIncludedInterpreters]: No interpreters specified via ${INTERPRETERS_INCLUDE_SETTING_KEY}`);
    return [];
}

/**
 * Gets the list of interpreters that the user has explicitly excluded in the settings. Converts
 * relative and aliased paths to absolute paths.
 * @returns List of interpreters that the user has explicitly excluded in the settings.
 */
export function getUserExcludedInterpreters(): string[] {
    const interpretersExclude = getConfiguration('python').get<string[]>(INTERPRETERS_EXCLUDE_SETTING_KEY) ?? [];
    if (interpretersExclude.length > 0) {
        return interpretersExclude.filter((item) => {
            if (path.isAbsolute(item)) {
                return true;
            }
            traceLog(`[getUserExcludedInterpreters]: interpreter path ${item} is not absolute...ignoring`);
            return false;
        });
    }
    traceLog(`[getUserExcludedInterpreters]: No interpreters specified via ${INTERPRETERS_EXCLUDE_SETTING_KEY}`);
    return [];
}

/**
 * Check whether an interpreter should be included in the list of discovered interpreters.
 * If an interpreter is both explicitly included and excluded, it will be included.
 * @param interpreterPath The interpreter path to check
 * @returns Whether the interpreter should be included in the list of discovered interpreters.
 */
export function shouldIncludeInterpreter(interpreterPath: string): boolean {
    // If a user has explicitly included the interpreter, include it. In other words, including an
    // interpreter takes precedence over excluding it.
    const interpretersInclude = getUserIncludedInterpreters();
    if (interpretersInclude.length > 0) {
        const userIncluded = interpretersInclude.some(
            (includePath) => isParentPath(interpreterPath, includePath) || arePathsSame(interpreterPath, includePath),
        );
        if (userIncluded) {
            traceInfo(`[shouldIncludeInterpreter] Interpreter ${interpreterPath} was included via settings`);
            return true;
        }
    }

    // If the user has not explicitly included the interpreter, check if it is explicitly excluded.
    const interpretersExclude = getUserExcludedInterpreters();
    const userExcluded = interpretersExclude.some(
        (excludePath) => isParentPath(interpreterPath, excludePath) || arePathsSame(interpreterPath, excludePath),
    );
    if (userExcluded) {
        traceInfo(`[shouldIncludeInterpreter] Interpreter ${interpreterPath} was excluded via settings`);
        return false;
    }

    // If the interpreter is not explicitly included or excluded, include it.
    traceVerbose(`[shouldIncludeInterpreter] Interpreter ${interpreterPath} not explicitly included or excluded`);
    return true;
}
