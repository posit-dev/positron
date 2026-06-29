/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { resetPyPIIndexCacheForTests, searchPyPI, searchPyPIVersions } from '../../client/positron/packages/pypiSearch';

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

    test('ranks prefix matches ahead of substring-only matches', async () => {
        // Index order puts a substring-only match (django-requests) first.
        fetchStub.resolves(makeIndexResponse(['django-requests', 'requests', 'requests-oauthlib']));

        const result = await searchPyPI('requests');

        expect(result.map((p) => p.name)).to.deep.equal(['requests', 'requests-oauthlib', 'django-requests']);
    });

    test('caps a broad query at 100 results', async () => {
        // 150 names all containing "pkg".
        const names = Array.from({ length: 150 }, (_, i) => `pkg${i}`);
        fetchStub.resolves(makeIndexResponse(names));

        const result = await searchPyPI('pkg');

        expect(result).to.have.lengthOf(100);
    });

    test('keeps an exact match that sorts past the cap', async () => {
        // 150 substring matches, with the exact match "pkg" last (well past the
        // 100-result cap).
        const names = [...Array.from({ length: 150 }, (_, i) => `pkg${i}`), 'pkg'];
        fetchStub.resolves(makeIndexResponse(names));

        const result = await searchPyPI('pkg');

        expect(result).to.have.lengthOf(100);
        expect(result.some((p) => p.name === 'pkg')).to.be.true;
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

interface FileEntry {
    filename: string;
    'requires-python'?: string | null;
    yanked?: boolean | string;
}

function makeVersionsResponse(versions: string[], files: FileEntry[]): Response {
    return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ versions, files }),
    } as Response;
}

suite('searchPyPIVersions', () => {
    let fetchStub: sinon.SinonStub;

    setup(() => {
        fetchStub = sinon.stub(global, 'fetch');
    });

    teardown(() => {
        sinon.restore();
    });

    test('excludes versions whose Requires-Python the interpreter does not satisfy', async () => {
        fetchStub.resolves(
            makeVersionsResponse(
                ['1.0', '2.0'],
                [
                    { filename: 'pkg-1.0.tar.gz', 'requires-python': '>=3.7' },
                    { filename: 'pkg-2.0.tar.gz', 'requires-python': '>=3.12' },
                ],
            ),
        );

        const result = await searchPyPIVersions('pkg', async () => ({ '>=3.7': true, '>=3.12': false }));

        expect(result).to.deep.equal(['1.0']);
    });

    test('keeps a version whose file has no Requires-Python constraint', async () => {
        fetchStub.resolves(makeVersionsResponse(['1.0'], [{ filename: 'pkg-1.0.tar.gz', 'requires-python': null }]));

        const result = await searchPyPIVersions('pkg', async () => ({}));

        expect(result).to.deep.equal(['1.0']);
    });

    test('drops a version whose every file is yanked', async () => {
        fetchStub.resolves(
            makeVersionsResponse(
                ['1.0', '2.0'],
                [
                    { filename: 'pkg-1.0.tar.gz', yanked: true },
                    { filename: 'pkg-2.0.tar.gz', yanked: false },
                ],
            ),
        );

        const result = await searchPyPIVersions('pkg', async () => ({}));

        expect(result).to.deep.equal(['2.0']);
    });

    test('keeps a version when only some of its files are yanked', async () => {
        fetchStub.resolves(
            makeVersionsResponse(
                ['1.0'],
                [
                    { filename: 'pkg-1.0-cp39-none-any.whl', yanked: true, 'requires-python': '>=3.12' },
                    { filename: 'pkg-1.0.tar.gz', yanked: false, 'requires-python': '>=3.7' },
                ],
            ),
        );

        const result = await searchPyPIVersions('pkg', async () => ({ '>=3.12': false, '>=3.7': true }));

        expect(result).to.deep.equal(['1.0']);
    });

    test('maps files to the longest matching version (1.0 vs 1.0.1)', async () => {
        fetchStub.resolves(
            makeVersionsResponse(
                ['1.0', '1.0.1'],
                [
                    { filename: 'pkg-1.0.tar.gz', 'requires-python': '>=3.12' },
                    { filename: 'pkg-1.0.1.tar.gz', 'requires-python': '>=3.7' },
                ],
            ),
        );

        const result = await searchPyPIVersions('pkg', async () => ({ '>=3.12': false, '>=3.7': true }));

        // 1.0 is excluded by >=3.12; 1.0.1 kept. Proves pkg-1.0.tar.gz mapped to
        // 1.0, not 1.0.1.
        expect(result).to.deep.equal(['1.0.1']);
    });

    test('preserves the original PyPI version order', async () => {
        fetchStub.resolves(
            makeVersionsResponse(
                ['2.0', '1.0'],
                [
                    { filename: 'pkg-2.0.tar.gz', 'requires-python': '>=3.7' },
                    { filename: 'pkg-1.0.tar.gz', 'requires-python': '>=3.7' },
                ],
            ),
        );

        const result = await searchPyPIVersions('pkg', async () => ({ '>=3.7': true }));

        expect(result).to.deep.equal(['2.0', '1.0']);
    });

    test('applies only yank filtering when no resolver is provided', async () => {
        fetchStub.resolves(
            makeVersionsResponse(['1.0'], [{ filename: 'pkg-1.0.tar.gz', 'requires-python': '>=3.99' }]),
        );

        const result = await searchPyPIVersions('pkg');

        // No resolver -> Requires-Python is not applied; version stays.
        expect(result).to.deep.equal(['1.0']);
    });

    test('degrades to yank-only filtering when the resolver rejects', async () => {
        fetchStub.resolves(
            makeVersionsResponse(
                ['1.0', '2.0'],
                [
                    { filename: 'pkg-1.0.tar.gz', 'requires-python': '>=3.99' },
                    { filename: 'pkg-2.0.tar.gz', yanked: true },
                ],
            ),
        );

        const result = await searchPyPIVersions('pkg', async () => {
            throw new Error('kernel unavailable');
        });

        // Resolver failed: Requires-Python skipped (1.0 stays), yank still applied (2.0 dropped).
        expect(result).to.deep.equal(['1.0']);
    });

    test('returns versions unfiltered when the response has no files', async () => {
        fetchStub.resolves(makeVersionsResponse(['1.0', '2.0'], []));

        const result = await searchPyPIVersions('pkg', async () => ({}));

        expect(result).to.deep.equal(['1.0', '2.0']);
    });
});
