/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { resetPyPIIndexCacheForTests, searchPyPI } from '../../client/positron/packages/pypiSearch';

function makeIndexResponse(names: string[]): Response {
    return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ projects: names.map((name) => ({ name })) }),
    } as Response;
}

suite('searchPyPI', () => {
    let fetchStub: sinon.SinonStub;

    setup(() => {
        resetPyPIIndexCacheForTests();
        fetchStub = sinon.stub(global, 'fetch');
    });

    teardown(() => {
        sinon.restore();
        resetPyPIIndexCacheForTests();
    });

    test('filters the index by case-insensitive substring and maps to LanguageRuntimePackage', async () => {
        fetchStub.resolves(makeIndexResponse(['NumPy', 'pandas', 'numba', 'requests']));

        const result = await searchPyPI('num');

        expect(result).to.deep.equal([
            { id: 'NumPy', name: 'NumPy', displayName: 'NumPy', version: '0' },
            { id: 'numba', name: 'numba', displayName: 'numba', version: '0' },
        ]);
    });

    test('downloads the index once and serves later searches from cache', async () => {
        fetchStub.resolves(makeIndexResponse(['numpy', 'pandas']));

        await searchPyPI('num');
        await searchPyPI('pan');

        expect(fetchStub.calledOnce).to.be.true;
    });

    test('refetches the index once its TTL has elapsed', async () => {
        const clock = sinon.useFakeTimers();
        try {
            fetchStub.resolves(makeIndexResponse(['numpy']));

            await searchPyPI('num');
            // Advance just past the one-hour TTL.
            clock.tick(60 * 60 * 1000 + 1);
            await searchPyPI('num');

            expect(fetchStub.calledTwice).to.be.true;
        } finally {
            clock.restore();
        }
    });

    test('dedupes concurrent searches into a single index download', async () => {
        fetchStub.resolves(makeIndexResponse(['numpy', 'pandas']));

        await Promise.all([searchPyPI('num'), searchPyPI('pan')]);

        expect(fetchStub.calledOnce).to.be.true;
    });

    test('throws CancellationError when the token is cancelled before filtering', async () => {
        const cts = new vscode.CancellationTokenSource();
        fetchStub.callsFake(() => {
            cts.cancel();
            return Promise.resolve(makeIndexResponse(['numpy']));
        });

        let caught: unknown;
        try {
            await searchPyPI('num', cts.token);
        } catch (e) {
            caught = e;
        }
        expect(caught).to.be.instanceOf(vscode.CancellationError);
    });
});
