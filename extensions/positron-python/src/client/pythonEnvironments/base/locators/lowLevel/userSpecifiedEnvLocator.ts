/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This file is a custom locator for Python environments that are specified by the user via Python
 * setting `python.interpreters.include`.
 *
 * The implementation follows similar patterns to other locators in the same directory.
 */

import { toLower, uniq, uniqBy } from 'lodash';
import { chain, iterable } from '../../../../common/utils/async';
import { getOSType, OSType } from '../../../../common/utils/platform';
import { PythonEnvKind } from '../../info';
import { BasicEnvInfo, IPythonEnvsIterator } from '../../locator';
import { FSWatchingLocator } from './fsWatchingLocator';
import { findInterpretersInDir, looksLikeBasicVirtualPython } from '../../../common/commonUtils';
import '../../../../common/extensions';
import { traceError, traceInfo, traceVerbose } from '../../../../logging';
import { StopWatch } from '../../../../common/utils/stopWatch';
import { getUserIncludedInterpreters } from '../../../../positron/interpreterSettings';

/**
 * Default number of levels of sub-directories to recurse when looking for interpreters.
 */
const DEFAULT_SEARCH_DEPTH = 2;

/**
 * Gets all user-specified directories to look for environments.
 */
async function getUserSpecifiedEnvDirs(): Promise<string[]> {
    const envDirs = getUserIncludedInterpreters();
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
            traceInfo('Searching for user-specified environments');
            const envRootDirs = await getUserSpecifiedEnvDirs();
            const envGenerators = envRootDirs.map((envRootDir) => {
                async function* generator() {
                    traceVerbose(`Searching for user-specified envs in: ${envRootDir}`);

                    const executables = findInterpretersInDir(envRootDir, searchDepth);

                    for await (const entry of executables) {
                        const { filename } = entry;
                        // We only care about python.exe (on windows) and python (on linux/mac)
                        // Other version like python3.exe or python3.8 are often symlinks to
                        // python.exe or python in the same directory in the case of virtual
                        // environments.
                        if (await looksLikeBasicVirtualPython(entry)) {
                            // We should extract the kind here to avoid doing is*Environment()
                            // check multiple times. Those checks are file system heavy and
                            // we can use the kind to determine this anyway.
                            const kind = await getVirtualEnvKind(filename);
                            try {
                                yield { kind, executablePath: filename, searchLocation: undefined };
                                traceVerbose(`User-specified Environment: [added] ${filename}`);
                            } catch (ex) {
                                traceError(`Failed to process environment: ${filename}`, ex);
                            }
                        } else {
                            traceVerbose(`User-specified Environment: [skipped] ${filename}`);
                        }
                    }
                }
                return generator();
            });

            yield* iterable(chain(envGenerators));
            traceInfo(`Finished searching for user-specified envs: ${stopWatch.elapsedTime} milliseconds`);
        }

        return iterator();
    }
}
