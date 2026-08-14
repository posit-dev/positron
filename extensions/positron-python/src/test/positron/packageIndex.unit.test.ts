/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import { resolvePythonIndexUrl } from '../../client/positron/packages/packageIndex';

const INTERNAL_INDEX = 'https://ppm.example.com/pypi/latest/simple';

suite('packageIndex - resolvePythonIndexUrl', () => {
    test('prefers PIP_INDEX_URL, matching pip precedence', async () => {
        const env = { PIP_INDEX_URL: INTERNAL_INDEX, UV_DEFAULT_INDEX: 'https://other.example.com/simple' };

        expect(await resolvePythonIndexUrl(undefined, env)).to.equal(INTERNAL_INDEX);
    });

    test("falls back to uv's index variables", async () => {
        expect(await resolvePythonIndexUrl(undefined, { UV_DEFAULT_INDEX: INTERNAL_INDEX })).to.equal(INTERNAL_INDEX);
        expect(await resolvePythonIndexUrl(undefined, { UV_INDEX_URL: INTERNAL_INDEX })).to.equal(INTERNAL_INDEX);
    });

    test('strips a trailing slash', async () => {
        expect(await resolvePythonIndexUrl(undefined, { PIP_INDEX_URL: `${INTERNAL_INDEX}/` })).to.equal(INTERNAL_INDEX);
    });

    test('reads pip config when the environment says nothing', async () => {
        expect(await resolvePythonIndexUrl(async () => INTERNAL_INDEX, {})).to.equal(INTERNAL_INDEX);
    });

    test('does not consult pip config when the environment already answered', async () => {
        const pipConfig = async () => {
            throw new Error('pip config should not be consulted');
        };

        expect(await resolvePythonIndexUrl(pipConfig, { PIP_INDEX_URL: INTERNAL_INDEX })).to.equal(INTERNAL_INDEX);
    });

    test('treats a failing pip config lookup as no configured index', async () => {
        // `pip config get` exits non-zero when the key is unset.
        const pipConfig = async () => {
            throw new Error('ERROR: No such key');
        };

        expect(await resolvePythonIndexUrl(pipConfig, {})).to.be.undefined;
    });

    test('resolves undefined when nothing is configured', async () => {
        expect(await resolvePythonIndexUrl(undefined, {})).to.be.undefined;
        // An empty or whitespace-only value is not a configured index.
        expect(await resolvePythonIndexUrl(async () => '   ', { PIP_INDEX_URL: '' })).to.be.undefined;
    });
});
