/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { BooleanConfiguration, isQuartoInlineOutputEnabled } from '../../client/positron/quarto';
import { mock } from './utils';

const CANONICAL_KEY = 'quarto.inlineOutput.enabled';
const DEPRECATED_KEY = 'positron.quarto.inlineOutput.enabled';

/**
 * A configuration where the given keys are set by the user and every other key
 * falls back to its registered default of `false`.
 */
function configuration(userValues: { [key: string]: boolean }): BooleanConfiguration {
    return mock<BooleanConfiguration>({
        get: (section: string, defaultValue: boolean) => userValues[section] ?? defaultValue,
        inspect: (section: string) => ({ globalValue: userValues[section] }),
    });
}

suite('isQuartoInlineOutputEnabled', () => {
    test('Follows the canonical key when only the canonical key is set', () => {
        assert.strictEqual(isQuartoInlineOutputEnabled(configuration({ [CANONICAL_KEY]: true })), true);
    });

    test('Falls back to the deprecated key when the canonical key is unset', () => {
        assert.strictEqual(isQuartoInlineOutputEnabled(configuration({ [DEPRECATED_KEY]: true })), true);
    });

    test('An explicit false on the canonical key wins over the deprecated key', () => {
        const config = configuration({ [CANONICAL_KEY]: false, [DEPRECATED_KEY]: true });

        assert.strictEqual(isQuartoInlineOutputEnabled(config), false);
    });
});
