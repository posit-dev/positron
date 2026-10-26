/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import { isVersionSupported } from '../../client/interpreter/configuration/environmentTypeComparer';
import { PythonVersion } from '../../client/pythonEnvironments/info/pythonVersion';

suite('isVersionSupported', () => {
    // Only the fields isVersionSupported reads; build and raw are left out on purpose.
    const version = (major: number, minor: number, patch: number) => ({ major, minor, patch } as PythonVersion);

    const cases: [PythonVersion | undefined, boolean][] = [
        [undefined, true],
        [version(2, 7, 18), false],
        [version(3, 9, 21), false],
        [version(3, 10, 0), true],
        [version(3, 15, 1), true],
        [version(3, 16, 0), false],
        [version(4, 0, 0), false],
    ];
    for (const [input, expected] of cases) {
        const label = input ? `${input.major}.${input.minor}.${input.patch}` : 'undefined';
        test(`${label} -> ${expected}`, () => {
            assert.strictEqual(isVersionSupported(input), expected);
        });
    }

    test('ignores raw and build when the minor version is at the minimum', () => {
        const finalRelease = { major: 3, minor: 10, patch: 0, raw: '3.10.0.final.0', build: [], prerelease: [] };
        assert.isTrue(isVersionSupported(finalRelease));
    });
});
