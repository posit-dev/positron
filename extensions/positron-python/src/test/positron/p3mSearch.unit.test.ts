/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { fetchP3MPackageMetadata } from '../../client/positron/packages/p3mSearch';

function makeResponse(body: string, init: { ok?: boolean; status?: number } = {}): Response {
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        text: () => Promise.resolve(body),
    } as Response;
}

function ndjson(...lines: unknown[]): string {
    return lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');
}

suite('fetchP3MPackageMetadata', () => {
    let fetchStub: sinon.SinonStub;

    setup(() => {
        fetchStub = sinon.stub(global, 'fetch');
    });

    teardown(() => {
        sinon.restore();
    });

    test('returns an empty map and skips the API call when no names are provided', async () => {
        const result = await fetchP3MPackageMetadata([]);

        expect(result.size).to.equal(0);
        expect(fetchStub.called).to.be.false;
    });

    test('parses NDJSON and maps P3M fields onto LanguageRuntimePackage', async () => {
        const body = ndjson(
            {
                name: 'Requests',
                version: '2.32.0',
                summary: 'HTTP for Humans',
                license: 'Apache-2.0',
                package_date: '2024-05-20',
                package_size: 123,
                downloads: 42,
            },
            {
                name: 'numpy',
                version: '2.0.0',
                summary: null,
                license: null,
                licenses: ['BSD-3-Clause', 'MIT'],
                package_date: null,
                package_size: null,
                downloads: null,
            },
        );
        fetchStub.resolves(makeResponse(body));

        const result = await fetchP3MPackageMetadata(['requests', 'numpy']);

        expect(result.size).to.equal(2);
        expect(result.get('requests')).to.deep.equal({
            license: 'Apache-2.0',
            latestVersion: '2.32.0',
            publishedDate: '2024-05-20',
        });
        // Falls back to licenses.join(', ') when license is null
        expect(result.get('numpy')).to.deep.equal({
            license: 'BSD-3-Clause, MIT',
            latestVersion: '2.0.0',
            publishedDate: undefined,
        });
    });

    test('POSTs to the P3M filter endpoint with the expected body', async () => {
        fetchStub.resolves(makeResponse(''));

        await fetchP3MPackageMetadata(['requests']);

        expect(fetchStub.calledOnce).to.be.true;
        const [url, init] = fetchStub.firstCall.args;
        expect(url).to.equal('https://p3m.dev/__api__/filter/packages');
        expect(init.method).to.equal('POST');
        const body = JSON.parse(init.body);
        expect(body.names).to.deep.equal(['requests']);
        expect(body.repo).to.equal('pypi');
    });

    test('skips malformed NDJSON lines but keeps the valid ones', async () => {
        const body = ndjson(
            'not-json',
            { name: 'requests', version: '2.32.0', summary: null, license: 'Apache-2.0', package_date: null, package_size: null, downloads: null },
            '{ broken',
        );
        fetchStub.resolves(makeResponse(body));

        const result = await fetchP3MPackageMetadata(['requests']);

        expect(result.size).to.equal(1);
        expect(result.get('requests')?.latestVersion).to.equal('2.32.0');
    });

    test('skips entries without a name', async () => {
        const body = ndjson(
            { version: '1.0.0', summary: null, license: null, package_date: null, package_size: null, downloads: null },
            { name: 'requests', version: '2.32.0', summary: null, license: 'Apache-2.0', package_date: null, package_size: null, downloads: null },
        );
        fetchStub.resolves(makeResponse(body));

        const result = await fetchP3MPackageMetadata(['requests']);

        expect(result.size).to.equal(1);
        expect(result.has('requests')).to.be.true;
    });

    test('swallows non-OK HTTP responses and returns an empty map', async () => {
        fetchStub.resolves(makeResponse('', { ok: false, status: 503 }));

        const result = await fetchP3MPackageMetadata(['requests']);

        expect(result.size).to.equal(0);
    });

    test('swallows fetch rejections and returns an empty map', async () => {
        fetchStub.rejects(new Error('network down'));

        const result = await fetchP3MPackageMetadata(['requests']);

        expect(result.size).to.equal(0);
    });

    test('throws CancellationError when the token is cancelled mid-flight', async () => {
        const cts = new vscode.CancellationTokenSource();
        fetchStub.callsFake((_url: string, init: RequestInit) => {
            return new Promise((_, reject) => {
                (init.signal as AbortSignal).addEventListener('abort', () => {
                    const err = new Error('aborted');
                    err.name = 'AbortError';
                    reject(err);
                });
            });
        });

        const pending = fetchP3MPackageMetadata(['requests'], cts.token);
        cts.cancel();

        let caught: unknown;
        try {
            await pending;
        } catch (e) {
            caught = e;
        }
        expect(caught).to.be.instanceOf(vscode.CancellationError);
    });

    test('disposes the cancellation subscription after a successful fetch', async () => {
        const cts = new vscode.CancellationTokenSource();
        let capturedSignal: AbortSignal | undefined;
        fetchStub.callsFake((_url: string, init: RequestInit) => {
            capturedSignal = init.signal as AbortSignal;
            return Promise.resolve(makeResponse(''));
        });

        await fetchP3MPackageMetadata(['requests'], cts.token);

        // Cancelling after the fetch has resolved should NOT abort the signal —
        // if the subscription wasn't disposed, the listener would still fire abort().
        expect(capturedSignal?.aborted).to.be.false;
        cts.cancel();
        expect(capturedSignal?.aborted).to.be.false;
    });
});
