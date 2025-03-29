// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as os from 'os';
import { gte } from 'semver';
import { PythonEnvKind, PythonEnvSource } from '../../info';
import { BasicEnvInfo, IPythonEnvsIterator, Locator } from '../../locator';
// eslint-disable-next-line import/no-duplicates
import { commonPosixBinPaths, getPythonBinFromPosixPaths } from '../../../common/posixUtils';
import { isPyenvShimDir } from '../../../common/environmentManagers/pyenv';
import { getOSType, OSType } from '../../../../common/utils/platform';
import { isMacDefaultPythonPath } from '../../../common/environmentManagers/macDefault';
import { traceError, traceInfo, traceVerbose } from '../../../../logging';
import { StopWatch } from '../../../../common/utils/stopWatch';

// --- Start Positron ---
// eslint-disable-next-line import/order
import path from 'path';
// eslint-disable-next-line import/no-duplicates
import { ADDITIONAL_POSIX_BIN_PATHS } from '../../../common/posixUtils';
import { findInterpretersInDir } from '../../../common/commonUtils';
// --- End Positron ---

export class PosixKnownPathsLocator extends Locator<BasicEnvInfo> {
    public readonly providerId = 'posixKnownPaths';

    private kind: PythonEnvKind = PythonEnvKind.OtherGlobal;

    public iterEnvs(): IPythonEnvsIterator<BasicEnvInfo> {
        // Flag to remove system installs of Python 2 from the list of discovered interpreters
        // If on macOS Monterey or later.
        // See https://github.com/microsoft/vscode-python/issues/17870.
        let isMacPython2Deprecated = false;
        if (getOSType() === OSType.OSX && gte(os.release(), '21.0.0')) {
            isMacPython2Deprecated = true;
        }

        const iterator = async function* (kind: PythonEnvKind) {
            const stopWatch = new StopWatch();
            traceInfo('Searching for interpreters in posix paths locator');
            try {
                // Filter out pyenv shims. They are not actual python binaries, they are used to launch
                // the binaries specified in .python-version file in the cwd. We should not be reporting
                // those binaries as environments.
                const knownDirs = (await commonPosixBinPaths()).filter((dirname) => !isPyenvShimDir(dirname));

                // --- Start Positron ---
                const additionalDirs = await getAdditionalPosixBinDirs();
                knownDirs.push(...additionalDirs);
                // --- End Positron ---

                let pythonBinaries = await getPythonBinFromPosixPaths(knownDirs);
                traceVerbose(`Found ${pythonBinaries.length} python binaries in posix paths`);

                // --- Start Positron ---
                traceVerbose(
                    `[PosixKnownPathsLocator] Python binaries found in posix paths: ${pythonBinaries.join(', ')}`,
                );
                // --- End Positron ---

                // Filter out MacOS system installs of Python 2 if necessary.
                if (isMacPython2Deprecated) {
                    pythonBinaries = pythonBinaries.filter((binary) => !isMacDefaultPythonPath(binary));
                }

                for (const bin of pythonBinaries) {
                    try {
                        yield { executablePath: bin, kind, source: [PythonEnvSource.PathEnvVar] };
                    } catch (ex) {
                        traceError(`Failed to process environment: ${bin}`, ex);
                    }
                }
            } catch (ex) {
                traceError('Failed to process posix paths', ex);
            }
            traceInfo(
                `Finished searching for interpreters in posix paths locator: ${stopWatch.elapsedTime} milliseconds`,
            );
        };
        return iterator(this.kind);
    }
}

// --- Start Positron ---
/**
 * Gets additional Python bin dirs on Posix systems.
 *
 * For example, `/opt/python/3.10.4/bin` will be returned if the machine has Python 3.10.4 installed
 * in `/opt/python/3.10.4/bin/python`.
 *
 * See extensions/positron-python/src/client/pythonEnvironments/base/locators/common/nativePythonFinder.ts
 * `getAdditionalEnvDirs()` for the equivalent handling using the native locator.
 *
 * @param searchDepth Number of levels of sub-directories to recurse when looking for interpreters.
 *                    Default is 2 levels.
 * @returns Paths to Python binaries found in additional locations for Posix systems.
 */
async function getAdditionalPosixBinDirs(searchDepth = 2): Promise<string[]> {
    const additionalDirs = [];
    for (const location of ADDITIONAL_POSIX_BIN_PATHS) {
        const executables = findInterpretersInDir(location, searchDepth);
        for await (const entry of executables) {
            const { filename } = entry;
            additionalDirs.push(path.dirname(filename));
        }
    }
    return Array.from(new Set(additionalDirs));
}
// --- End Positron ---
