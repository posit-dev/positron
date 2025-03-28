/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This file is a custom locator for Python environments that are specified by the user via Python
 * setting `python.interpreters.include`.
 *
 * The implementation follows similar patterns to other locators in the same directory.
 *
 * See extensions/positron-python/src/client/pythonEnvironments/base/locators/common/nativePythonFinder.ts
 * `getAdditionalEnvDirs()` for the equivalent handling using the native locator.
 */

import { toLower, uniq, uniqBy } from 'lodash';
import { chain, iterable } from '../../../../common/utils/async';
import { getOSType, OSType } from '../../../../common/utils/platform';
import { PythonEnvKind, PythonEnvSource } from '../../info';
import { BasicEnvInfo, IPythonEnvsIterator } from '../../locator';
import { FSWatchingLocator } from './fsWatchingLocator';
import { findInterpretersInDir } from '../../../common/commonUtils';
import '../../../../common/extensions';
import { traceInfo, traceVerbose, traceWarn } from '../../../../logging';
import { StopWatch } from '../../../../common/utils/stopWatch';
import { getCustomEnvDirs } from '../../../../positron/interpreterSettings';
import { getShortestString } from '../../../../common/stringUtils';

/**
 * Default number of levels of sub-directories to recurse when looking for interpreters.
 */
const DEFAULT_SEARCH_DEPTH = 2;

/**
 * Gets all user-specified directories to look for environments.
 */
async function getUserSpecifiedEnvDirs(): Promise<string[]> {
    const envDirs = getCustomEnvDirs();
    return [OSType.Windows, OSType.OSX].includes(getOSType()) ? uniqBy(envDirs, toLower) : uniq(envDirs);
}

/**
 * Return PythonEnvKind.Custom for all environments found by this locator.
 * @param _interpreterPath: Absolute path to the interpreter paths. This is not used.
 */
async function getVirtualEnvKind(_interpreterPath: string): Promise<PythonEnvKind> {
    return PythonEnvKind.Custom;
}

/**
 * Finds and resolves virtual environments created in user-specified locations.
 */
export class UserSpecifiedEnvironmentLocator extends FSWatchingLocator {
    public readonly providerId: string = 'user-specified-env';

    constructor(private readonly searchDepth?: number) {
        super(getUserSpecifiedEnvDirs, getVirtualEnvKind, {
            // Note detecting kind of virtual env depends on the file structure around the
            // executable, so we need to wait before attempting to detect it. However even
            // if the type detected is incorrect, it doesn't do any practical harm as kinds
            // in this locator are used in the same way (same activation commands etc.)
            delayOnCreated: 1000,
        });
    }

    protected doIterEnvs(): IPythonEnvsIterator<BasicEnvInfo> {
        // Number of levels of sub-directories to recurse when looking for
        // interpreters
        const searchDepth = this.searchDepth ?? DEFAULT_SEARCH_DEPTH;

        async function* iterator() {
            const stopWatch = new StopWatch();
            traceInfo('[UserSpecifiedEnvironmentLocator] Searching for user-specified environments');
            const envRootDirs = await getUserSpecifiedEnvDirs();
            const envGenerators = envRootDirs.map((envRootDir) => {
                async function* generator() {
                    traceVerbose(
                        `[UserSpecifiedEnvironmentLocator] Searching for user-specified envs in: ${envRootDir}`,
                    );

                    // Find Python executables in the directory.
                    const executables = findInterpretersInDir(envRootDir, searchDepth, undefined, false);
                    const filenames: string[] = [];
                    for await (const entry of executables) {
                        filenames.push(entry.filename);
                    }
                    traceVerbose(
                        `[UserSpecifiedEnvironmentLocator] Found ${filenames.length} user-specified envs in: ${envRootDir}`,
                    );

                    // No environments found in the directory, log a warning.
                    if (filenames.length === 0) {
                        traceWarn(
                            `[UserSpecifiedEnvironmentLocator] No environments found in: ${envRootDir}. The directory may not contain Python installations or is an invalid path.`,
                        );
                        return;
                    }

                    // We try to get the basic python (python.exe on windows; python on linux/mac), as other versions
                    // like python3.exe or python3.8 are often symlinks to python.exe or python.
                    // However, it's possible that the basic python does not exist in the directory, so we opt for the
                    // shortest path to generalize the logic.
                    const filename = getShortestString(filenames);
                    const kind = await getVirtualEnvKind(filename);
                    yield {
                        kind,
                        executablePath: filename,
                        source: [PythonEnvSource.UserSettings],
                        searchLocation: undefined,
                    };
                    traceVerbose(`[UserSpecifiedEnvironmentLocator] User-specified Environment: [added] ${filename}`);
                    const skippedEnvs = filenames.filter((f) => f !== filename);
                    skippedEnvs.forEach((f) => {
                        traceVerbose(`[UserSpecifiedEnvironmentLocator] User-specified Environment: [skipped] ${f}`);
                    });
                }
                return generator();
            });

            yield* iterable(chain(envGenerators));
            traceInfo(
                `[UserSpecifiedEnvironmentLocator] Finished searching for user-specified envs: ${stopWatch.elapsedTime} milliseconds`,
            );
        }

        return iterator();
    }
}
