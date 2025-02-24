/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';

import { traceInfo, traceVerbose } from '../logging';
import { getConfiguration } from '../common/vscodeApis/workspaceApis';
import { arePathsSame, isParentPath } from '../pythonEnvironments/common/externalDependencies';
import {
    INTERPRETERS_EXCLUDE_SETTING_KEY,
    INTERPRETERS_INCLUDE_SETTING_KEY,
    MINIMUM_PYTHON_VERSION,
} from '../common/constants';
import { untildify } from '../common/helpers';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonVersion } from '../pythonEnvironments/info/pythonVersion';
import { comparePythonVersionDescending } from '../interpreter/configuration/environmentTypeComparer';

/**
 * Gets the list of interpreters that the user has explicitly included in the settings.
 * Converts aliased paths to absolute paths. Relative paths are not included.
 * @returns List of interpreters that the user has explicitly included in the settings.
 */
export function getUserIncludedInterpreters(): string[] {
    const interpretersInclude = getConfiguration('python').get<string[]>(INTERPRETERS_INCLUDE_SETTING_KEY) ?? [];
    if (interpretersInclude.length > 0) {
        return interpretersInclude
            .map((item) => untildify(item))
            .filter((item) => {
                if (path.isAbsolute(item)) {
                    return true;
                }
                traceInfo(`[shouldIncludeInterpreter]: included interpreter path ${item} is not absolute...ignoring`);
                return false;
            });
    }
    traceVerbose(`[shouldIncludeInterpreter]: No interpreters specified via ${INTERPRETERS_INCLUDE_SETTING_KEY}`);
    return [];
}

/**
 * Gets the list of interpreters that the user has explicitly excluded in the settings.
 * Converts aliased paths to absolute paths. Relative paths are not included.
 * @returns List of interpreters that the user has explicitly excluded in the settings.
 */
export function getUserExcludedInterpreters(): string[] {
    const interpretersExclude = getConfiguration('python').get<string[]>(INTERPRETERS_EXCLUDE_SETTING_KEY) ?? [];
    if (interpretersExclude.length > 0) {
        return interpretersExclude
            .map((item) => untildify(item))
            .filter((item) => {
                if (path.isAbsolute(item)) {
                    return true;
                }
                traceInfo(`[shouldIncludeInterpreter]: excluded interpreter path ${item} is not absolute...ignoring`);
                return false;
            });
    }
    traceVerbose(`[shouldIncludeInterpreter]: No interpreters specified via ${INTERPRETERS_EXCLUDE_SETTING_KEY}`);
    return [];
}

/**
 * Check whether an interpreter should be included in the list of discovered interpreters.
 * If an interpreter is both included and excluded via settings, it will be excluded.
 * @param interpreterPath The interpreter path to check
 * @returns Whether the interpreter should be included in the list of discovered interpreters.
 */
export function shouldIncludeInterpreter(interpreterPath: string): boolean {
    // If the settings exclude the interpreter, exclude it. Excluding an interpreter takes
    // precedence over including it, so we return right away if the interpreter is excluded.
    const userExcluded = userExcludedInterpreter(interpreterPath);
    if (userExcluded === true) {
        traceInfo(
            `[shouldIncludeInterpreter] Interpreter ${interpreterPath} excluded via ${INTERPRETERS_EXCLUDE_SETTING_KEY} setting`,
        );
        return false;
    }

    // If the settings include the interpreter, include it.
    const userIncluded = userIncludedInterpreter(interpreterPath);
    if (userIncluded === true) {
        traceInfo(
            `[shouldIncludeInterpreter] Interpreter ${interpreterPath} included via ${INTERPRETERS_INCLUDE_SETTING_KEY} setting`,
        );
        return true;
    }

    // If the interpreter is not included or excluded in the settings, include it.
    traceVerbose(`[shouldIncludeInterpreter] Interpreter ${interpreterPath} not explicitly included or excluded`);
    return true;
}

/**
 * Checks if an interpreter path is included in the user's settings.
 * @param interpreterPath The interpreter path to check
 * @returns True if the interpreter is included in the user's settings, false if it is not included
 * in the user's settings, and undefined if the user has not specified any included interpreters.
 */
function userIncludedInterpreter(interpreterPath: string): boolean | undefined {
    const interpretersInclude = getUserIncludedInterpreters();
    if (interpretersInclude.length === 0) {
        return undefined;
    }
    return interpretersInclude.some(
        (includePath) => isParentPath(interpreterPath, includePath) || arePathsSame(interpreterPath, includePath),
    );
}

/**
 * Checks if an interpreter path is excluded in the user's settings.
 * @param interpreterPath The interpreter path to check
 * @returns True if the interpreter is excluded in the user's settings, false if it is not excluded
 * in the user's settings, and undefined if the user has not specified any excluded interpreters.
 */
function userExcludedInterpreter(interpreterPath: string): boolean | undefined {
    const interpretersExclude = getUserExcludedInterpreters();
    if (interpretersExclude.length === 0) {
        return undefined;
    }
    return interpretersExclude.some(
        (excludePath) => isParentPath(interpreterPath, excludePath) || arePathsSame(interpreterPath, excludePath),
    );
}

/**
 * Check if a version is supported (i.e. >= the minimum supported version).
 * Also returns true if the version could not be determined.
 */
export function isVersionSupported(
    version: PythonVersion | undefined,
    minimumSupportedVersion: PythonVersion,
): boolean {
    return !version || comparePythonVersionDescending(minimumSupportedVersion, version) >= 0;
}

/**
 * Interface for debug information about a Python interpreter.
 */
interface InterpreterDebugInfo {
    name: string; // e.g. 'Python 3.13.1 64-bit'
    path: string;
    versionInfo: {
        version: string;
        supportedVersion: boolean;
    };
    envInfo: {
        envName: string;
        envType: string;
    };
    enablementInfo: {
        visibleInUI: boolean;
        includedInSettings: boolean | undefined;
        excludedInSettings: boolean | undefined;
    };
}

/**
 * Print debug information about the Python interpreters discovered by the extension.
 * @param interpreters The list of Python interpreters discovered by the extension.
 */
export function printInterpreterDebugInfo(interpreters: PythonEnvironment[]): void {
    // Construct interpreter setting information
    const interpreterSettingInfo = {
        defaultInterpreterPath: getConfiguration('python').get<string>('defaultInterpreterPath'),
        'interpreters.include': getUserIncludedInterpreters(),
        'interpreters.exclude': getUserExcludedInterpreters(),
    };

    // Construct debug information about each interpreter
    const debugInfo = interpreters
        .sort((a, b) => {
            // Sort by path and then version descending
            const pathCompare = a.path.localeCompare(b.path);
            if (pathCompare !== 0) {
                return pathCompare;
            }
            return comparePythonVersionDescending(a.version, b.version);
        })
        .map(
            (interpreter): InterpreterDebugInfo => ({
                name: interpreter.detailedDisplayName ?? interpreter.displayName ?? 'Python',
                path: interpreter.path,
                versionInfo: {
                    version: interpreter.version?.raw ?? 'Unknown',
                    supportedVersion: isVersionSupported(interpreter.version, MINIMUM_PYTHON_VERSION),
                },
                envInfo: {
                    envType: interpreter.envType,
                    envName: interpreter.envName ?? '',
                },
                enablementInfo: {
                    visibleInUI: shouldIncludeInterpreter(interpreter.path),
                    includedInSettings: userIncludedInterpreter(interpreter.path),
                    excludedInSettings: userExcludedInterpreter(interpreter.path),
                },
            }),
        );

    // Print debug information
    traceInfo('=====================================================================');
    traceInfo('=============== [START] PYTHON INTERPRETER DEBUG INFO ===============');
    traceInfo('=====================================================================');
    traceInfo('Python interpreter settings:', interpreterSettingInfo);
    traceInfo('Python interpreters discovered:', debugInfo);
    traceInfo('=====================================================================');
    traceInfo('================ [END] PYTHON INTERPRETER DEBUG INFO ================');
    traceInfo('=====================================================================');
}
