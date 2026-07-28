/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { traceInfo } from '../logging';
import { getConfiguration } from '../common/vscodeApis/workspaceApis';
import { PythonEnvironment } from '../pythonEnvironments/info';
import {
    comparePythonVersionDescending,
    isVersionSupported,
} from '../interpreter/configuration/environmentTypeComparer';
import {
    getExcludedInterpreters,
    getIncludedInterpreters,
    getOverrideInterpreters,
    isExcludedInterpreter,
    isIncludedInterpreter,
    shouldIncludeInterpreter,
} from './interpreterSettings';

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
 *
 * Lives outside interpreterSettings so that the settings readers stay free of imports from the
 * interpreter comparer, which reads the custom interpreter dirs to rank environments.
 *
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
                    supportedVersion: isVersionSupported(interpreter.version),
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
