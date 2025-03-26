/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { traceError, traceInfo, traceVerbose } from '../logging';
import { getConfiguration } from '../common/vscodeApis/workspaceApis';
import { arePathsSame, isDirectorySync, isParentPath } from '../pythonEnvironments/common/externalDependencies';
import {
    INTERPRETERS_EXCLUDE_SETTING_KEY,
    INTERPRETERS_INCLUDE_SETTING_KEY,
    INTERPRETERS_OVERRIDE_SETTING_KEY,
    MINIMUM_PYTHON_VERSION,
} from '../common/constants';
import { untildify } from '../common/helpers';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { PythonVersion } from '../pythonEnvironments/info/pythonVersion';
import { Resource, InspectInterpreterSettingType } from '../common/types';
import { comparePythonVersionDescending } from '../interpreter/configuration/environmentTypeComparer';

/**
 * Gets the list of interpreters included in the settings.
 * Converts aliased paths to absolute paths. Relative paths are not included.
 * @returns List of interpreters included in the settings.
 */
function getIncludedInterpreters(): string[] {
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
 * Gets the list of interpreters excluded in the settings.
 * Converts aliased paths to absolute paths. Relative paths are not included.
 * @returns List of interpreters excluded in the settings.
 */
function getExcludedInterpreters(): string[] {
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
 * Gets the exclusive list of interpreters that should be included in the list of discovered interpreters.
 * Converts aliased paths to absolute paths. Relative paths are not included.
 * @returns List of the only interpreters that should be included in the list of discovered interpreters.
 */
function getOverrideInterpreters(): string[] {
    const interpretersOverride = getConfiguration('python').get<string[]>(INTERPRETERS_OVERRIDE_SETTING_KEY) ?? [];
    if (interpretersOverride.length > 0) {
        return interpretersOverride
            .map((item) => untildify(item))
            .filter((item) => {
                if (path.isAbsolute(item)) {
                    return true;
                }
                traceInfo(`[shouldIncludeInterpreter]: override interpreter path ${item} is not absolute...ignoring`);
                return false;
            });
    }
    traceVerbose(`[shouldIncludeInterpreter]: No interpreters specified via ${INTERPRETERS_OVERRIDE_SETTING_KEY}`);
    return [];
}

/**
 * Gets the list of custom environment directories specified in the settings to look for python installations.
 * @returns List of custom environment directories to look for environments.
 */
export function getCustomEnvDirs(): string[] {
    const overrideDirs = getOverrideInterpreters();
    if (overrideDirs.length > 0) {
        return mapInterpretersToInstallDirs(overrideDirs);
    }

    const includeDirs = getIncludedInterpreters();
    if (includeDirs.length > 0) {
        return mapInterpretersToInstallDirs(includeDirs);
    }

    return [];
}

/**
 * Check whether an interpreter should be included in the list of discovered interpreters.
 * If an interpreter is both included and excluded via settings, it will be excluded.
 * @param interpreterPath The interpreter path to check
 * @returns Whether the interpreter should be included in the list of discovered interpreters.
 */
export function shouldIncludeInterpreter(interpreterPath: string): boolean {
    // If any interpreter overrides are specified, include the interpreter only if it is specified in the overrides.
    const override = isOverrideInterpreter(interpreterPath);
    if (override !== undefined) {
        if (override) {
            traceInfo(
                `[shouldIncludeInterpreter] Interpreter ${interpreterPath} included via ${INTERPRETERS_OVERRIDE_SETTING_KEY} setting`,
            );
            return true;
        }
        traceInfo(
            `[shouldIncludeInterpreter] Interpreter ${interpreterPath} is excluded since it is not specified in ${INTERPRETERS_OVERRIDE_SETTING_KEY} setting`,
        );
        return false;
    }

    // If the settings exclude the interpreter, exclude it. Excluding an interpreter takes
    // precedence over including it, so we return right away if the interpreter is excluded.
    const excluded = isExcludedInterpreter(interpreterPath);
    if (excluded === true) {
        traceInfo(
            `[shouldIncludeInterpreter] Interpreter ${interpreterPath} excluded via ${INTERPRETERS_EXCLUDE_SETTING_KEY} setting`,
        );
        return false;
    }

    // If the settings include the interpreter, include it.
    const included = isIncludedInterpreter(interpreterPath);
    if (included === true) {
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
 * Check if an interpreter path is a custom environment. An interpreter is a custom environment if it is
 * included in the settings or specified to override the discovered interpreters.
 * @param interpreterPath The interpreter path to check
 * @returns Whether the interpreter is a custom environment.
 */
export async function isCustomEnvironment(interpreterPath: string): Promise<boolean> {
    return !!isIncludedInterpreter(interpreterPath) || !!isOverrideInterpreter(interpreterPath);
}

/**
 * Checks if an interpreter path is included in the settings.
 * @param interpreterPath The interpreter path to check
 * @returns True if the interpreter is included in the settings, false if it is not included
 * in the settings, and undefined if included interpreters have not been specified.
 */
function isIncludedInterpreter(interpreterPath: string): boolean | undefined {
    const interpretersInclude = getIncludedInterpreters();
    if (interpretersInclude.length === 0) {
        return undefined;
    }
    return interpretersInclude.some(
        (includePath) => isParentPath(interpreterPath, includePath) || arePathsSame(interpreterPath, includePath),
    );
}

/**
 * Checks if an interpreter path is excluded in the settings.
 * @param interpreterPath The interpreter path to check
 * @returns True if the interpreter is excluded in the settings, false if it is not excluded
 * in the settings, and undefined if excluded interpreters have not been specified.
 */
function isExcludedInterpreter(interpreterPath: string): boolean | undefined {
    const interpretersExclude = getExcludedInterpreters();
    if (interpretersExclude.length === 0) {
        return undefined;
    }
    return interpretersExclude.some(
        (excludePath) => isParentPath(interpreterPath, excludePath) || arePathsSame(interpreterPath, excludePath),
    );
}

/**
 * Checks if an interpreter path is specified to override the discovered interpreters.
 * @param interpreterPath The interpreter path to check
 * @returns True if the interpreter is specified in the settings to override the discovered interpreters,
 * false if it is not specified to override the discovered interpreters, and undefined if no interpreters
 * are specified to override the discovered interpreters.
 */
function isOverrideInterpreter(interpreterPath: string): boolean | undefined {
    const interpretersOverride = getOverrideInterpreters();
    if (interpretersOverride.length === 0) {
        return undefined;
    }
    return interpretersOverride.some(
        (overridePath) => isParentPath(interpreterPath, overridePath) || arePathsSame(interpreterPath, overridePath),
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
        'interpreters.include': getIncludedInterpreters(),
        'interpreters.exclude': getExcludedInterpreters(),
        'interpreters.override': getOverrideInterpreters(),
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
                    includedInSettings: isIncludedInterpreter(interpreter.path),
                    excludedInSettings: isExcludedInterpreter(interpreter.path),
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

/**
 * Maps a list of interpreter paths to their installation directories.
 * @param interpreterPaths List of interpreter paths to map to their installation directories.
 * @returns
 */
function mapInterpretersToInstallDirs(interpreterPaths: string[]): string[] {
    return interpreterPaths.map((interpreterPath) => {
        // If it's already a directory, return it as-is.
        if (isDirectorySync(interpreterPath)) {
            return interpreterPath;
        }

        // If it's a file, we need to return the installation directory so that the Python locators can find it.
        // e.g. ~/scratch/3.10.4/bin/python -> ~/scratch/3.10.4
        // The locators expect a list of environment directories and don't seem to handle individual interpreter files.
        // The installation directory is the grandparent directory, which upholds the JS locator's DEFAULT_SEARCH_DEPTH of 2
        // see extensions/positron-python/src/client/pythonEnvironments/base/locators/lowLevel/userSpecifiedEnvLocator.ts
        // The Native Python Locator seems to use the same search depth of 2, although not explicitly documented in the python extension.
        let parentDir: string | undefined;
        let installDir: string | undefined;
        try {
            // parentDir tends to be the bin directory, which is the parent of the interpreter file.
            parentDir = path.dirname(interpreterPath);
            // installDir tends to be the python version directory, AKA the installation directory, which is the parent of the bin directory.
            installDir = path.dirname(parentDir);
        } catch (error) {
            traceError(
                `[mapInterpretersToInterpreterDirs]: Failed to get install directory for Python interpreter ${interpreterPath}`,
                error,
            );
        }

        if (installDir) {
            traceVerbose(
                `[mapInterpretersToInterpreterDirs]: Mapped ${interpreterPath} to installation directory ${installDir}`,
            );
            return installDir;
        }

        if (parentDir) {
            traceInfo(
                `[mapInterpretersToInterpreterDirs]: Expected ${interpreterPath} to be located in a Python installation directory. It may not be discoverable.`,
            );
            return parentDir;
        }

        traceInfo(
            `[mapInterpretersToInterpreterDirs]: Unable to map ${interpreterPath} to an installation directory. It may not be discoverable.`,
        );
        return interpreterPath;
    });
}

/**
 * Retrieves the user's default Python interpreter path from VS Code settings
 *
 * @returns The configured Python interpreter path if it exists and is not 'python',
 *          otherwise returns an empty string
 */
export function getUserDefaultInterpreter(scope?: Resource): InspectInterpreterSettingType {
    const configuration = getConfiguration('python', scope);
    const defaultInterpreterPath: InspectInterpreterSettingType =
        configuration?.inspect<string>('defaultInterpreterPath') ?? {};

    const processPath = (value: string | undefined): string => {
        // 'python' is the default for this setting. we only want to know if it has changed
        if (value === 'python') {
            return '';
        }
        if (value) {
            if (!path.isAbsolute(value)) {
                traceInfo(`[getUserDefaultInterpreter]: interpreter path ${value} is not absolute...ignoring`);
                return '';
            }
            return value;
        }
        return value ?? '';
    };

    defaultInterpreterPath.globalValue = processPath(defaultInterpreterPath.globalValue);
    defaultInterpreterPath.workspaceValue = processPath(defaultInterpreterPath.workspaceValue);
    defaultInterpreterPath.workspaceFolderValue = processPath(defaultInterpreterPath.workspaceFolderValue);
    return defaultInterpreterPath;
}
