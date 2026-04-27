/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getCondaPythonPath } from '../../client/positron/util';

suite('Conda utility functions', () => {
    test('getCondaPythonPath returns undefined for undefined envPath', () => {
        const result = getCondaPythonPath(undefined);
        assert.strictEqual(result, undefined);
    });

    test('getCondaPythonPath returns undefined for nonexistent envPath', () => {
        const result = getCondaPythonPath('/nonexistent/path/that/does/not/exist');
        assert.strictEqual(result, undefined);
    });
});
