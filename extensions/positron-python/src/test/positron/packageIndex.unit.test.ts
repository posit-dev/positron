/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import {
    PIP_INDEX_ENV_VARS,
    resolvePythonIndexUrl,
    UV_INDEX_ENV_VARS,
} from '../../client/positron/packages/packageIndex';

const INTERNAL_INDEX = 'https://ppm.example.com/pypi/latest/simple';

suite('packageIndex - resolvePythonIndexUrl', () => {
    test("reads pip's index variable for pip", async () => {
        const env = { PIP_INDEX_URL: INTERNAL_INDEX };

        expect(await resolvePythonIndexUrl(PIP_INDEX_ENV_VARS, undefined, env)).to.equal(INTERNAL_INDEX);
    });

    test("reads uv's index variables for uv, preferring UV_DEFAULT_INDEX", async () => {
        expect(await resolvePythonIndexUrl(UV_INDEX_ENV_VARS, undefined, { UV_DEFAULT_INDEX: INTERNAL_INDEX })).to.equal(
            INTERNAL_INDEX,
        );
        expect(await resolvePythonIndexUrl(UV_INDEX_ENV_VARS, undefined, { UV_INDEX_URL: INTERNAL_INDEX })).to.equal(
            INTERNAL_INDEX,
        );
        expect(
            await resolvePythonIndexUrl(UV_INDEX_ENV_VARS, undefined, {
                UV_DEFAULT_INDEX: INTERNAL_INDEX,
                UV_INDEX_URL: 'https://other.example.com/simple',
            }),
        ).to.equal(INTERNAL_INDEX);
    });

    test("ignores the other manager's variables: a uv resolve never reads PIP_INDEX_URL, and vice versa", async () => {
        // A stale PIP_INDEX_URL in the shell must not decide where a uv
        // environment's package inventory goes: uv doesn't read it.
        expect(
            await resolvePythonIndexUrl(UV_INDEX_ENV_VARS, undefined, {
                PIP_INDEX_URL: 'https://stale.example.com/simple',
            }),
        ).to.be.undefined;
        expect(
            await resolvePythonIndexUrl(PIP_INDEX_ENV_VARS, undefined, {
                UV_DEFAULT_INDEX: 'https://uv-only.example.com/simple',
            }),
        ).to.be.undefined;
    });

    test('strips a trailing slash', async () => {
        expect(await resolvePythonIndexUrl(PIP_INDEX_ENV_VARS, undefined, { PIP_INDEX_URL: `${INTERNAL_INDEX}/` })).to.equal(
            INTERNAL_INDEX,
        );
    });

    test('reads pip config when the environment says nothing', async () => {
        expect(await resolvePythonIndexUrl(PIP_INDEX_ENV_VARS, async () => INTERNAL_INDEX, {})).to.equal(INTERNAL_INDEX);
    });

    test('does not consult pip config when the environment already answered', async () => {
        const pipConfig = async () => {
            throw new Error('pip config should not be consulted');
        };

        expect(await resolvePythonIndexUrl(PIP_INDEX_ENV_VARS, pipConfig, { PIP_INDEX_URL: INTERNAL_INDEX })).to.equal(
            INTERNAL_INDEX,
        );
    });

    test('treats a failing pip config lookup as no configured index', async () => {
        // `pip config get` exits non-zero when the key is unset.
        const pipConfig = async () => {
            throw new Error('ERROR: No such key');
        };

        expect(await resolvePythonIndexUrl(PIP_INDEX_ENV_VARS, pipConfig, {})).to.be.undefined;
    });

    test('resolves undefined when nothing is configured', async () => {
        expect(await resolvePythonIndexUrl(PIP_INDEX_ENV_VARS, undefined, {})).to.be.undefined;
        // An empty or whitespace-only value is not a configured index.
        expect(await resolvePythonIndexUrl(PIP_INDEX_ENV_VARS, async () => '   ', { PIP_INDEX_URL: '' })).to.be
            .undefined;
    });
});
