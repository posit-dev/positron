/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';

import { traceLog } from '../logging';
import { getConfiguration } from '../common/vscodeApis/workspaceApis';

// Settings keys for various interpreter settings
export const INTERPRETERS_INCLUDE_SETTING_KEY = 'interpreters.include';
export const INTERPRETERS_EXCLUDE_SETTING_KEY = 'interpreters.exclude';

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
