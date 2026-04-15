/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { searchP3M, searchP3MVersions } from '../../client/positron/packages/p3mSearch';

suite('P3M Search Tests', () => {
    let fetchStub: sinon.SinonStub;

    setup(() => {
        fetchStub = sinon.stub(global, 'fetch');
    });

    teardown(() => {
        sinon.restore();
    });

    suite('searchP3M', () => {
        test('Should return packages from P3M API', async () => {
            const mockResponse = [
                { name: 'requests', version: '2.31.0', summary: 'HTTP library' },
                { name: 'requests-mock', version: '1.11.0', summary: 'Mock requests' },
            ];

            fetchStub.resolves({
                ok: true,
                json: sinon.stub().resolves(mockResponse),
            });

            const results = await searchP3M('requests');

            expect(results).to.have.length(2);
            expect(results[0].name).to.equal('requests');
            expect(results[0].version).to.equal('2.31.0');
            expect(results[1].name).to.equal('requests-mock');
        });

        test('Should call P3M API with correct URL parameters', async () => {
            fetchStub.resolves({
                ok: true,
                json: sinon.stub().resolves([]),
            });

            await searchP3M('numpy');

            expect(fetchStub.calledOnce).to.be.true;
            const url = fetchStub.firstCall.args[0] as string;
            expect(url).to.include('/__api__/repos/pypi/packages?');
            expect(url).to.include('name_like=numpy');
            expect(url).to.include('_limit=100');
        });

        test('Should fall back to PyPI when P3M returns non-OK', async () => {
            // First call (P3M) fails
            fetchStub.onFirstCall().resolves({
                ok: false,
                status: 503,
            });
            // Second call (PyPI fallback) succeeds
            fetchStub.onSecondCall().resolves({
                ok: true,
                json: sinon.stub().resolves({
                    projects: [
                        { name: 'flask' },
                        { name: 'flask-cors' },
                    ],
                }),
            });

            const results = await searchP3M('flask');

            expect(fetchStub.calledTwice).to.be.true;
            expect(results).to.have.length(2);
            expect(results[0].name).to.equal('flask');
            // Fallback returns version '0'
            expect(results[0].version).to.equal('0');
        });

        test('Should fall back to PyPI when P3M fetch throws', async () => {
            // First call (P3M) throws network error
            fetchStub.onFirstCall().rejects(new Error('Network error'));
            // Second call (PyPI fallback) succeeds
            fetchStub.onSecondCall().resolves({
                ok: true,
                json: sinon.stub().resolves({
                    projects: [{ name: 'pandas' }],
                }),
            });

            const results = await searchP3M('pandas');

            expect(fetchStub.calledTwice).to.be.true;
            expect(results).to.have.length(1);
            expect(results[0].name).to.equal('pandas');
        });

        test('Should rethrow CancellationError without fallback', async () => {
            fetchStub.rejects(new vscode.CancellationError());

            try {
                await searchP3M('test');
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e).to.be.instanceOf(vscode.CancellationError);
                // Should not have attempted fallback
                expect(fetchStub.calledOnce).to.be.true;
            }
        });

        test('Should handle empty P3M response', async () => {
            fetchStub.resolves({
                ok: true,
                json: sinon.stub().resolves([]),
            });

            const results = await searchP3M('nonexistentpackage');
            expect(results).to.have.length(0);
        });

        test('Should use version 0 when version field is missing', async () => {
            fetchStub.resolves({
                ok: true,
                json: sinon.stub().resolves([
                    { name: 'test-pkg' },
                ]),
            });

            const results = await searchP3M('test');
            expect(results[0].version).to.equal('0');
        });
    });

    suite('searchP3MVersions', () => {
        test('Should return versions from P3M releases', async () => {
            const mockResponse = {
                name: 'requests',
                releases: {
                    '2.28.0': [{}],
                    '2.29.0': [{}],
                    '2.31.0': [{}],
                },
            };

            fetchStub.resolves({
                ok: true,
                json: sinon.stub().resolves(mockResponse),
            });

            const versions = await searchP3MVersions('requests');

            expect(versions).to.deep.equal(['2.28.0', '2.29.0', '2.31.0']);
        });

        test('Should call P3M API with correct URL', async () => {
            fetchStub.resolves({
                ok: true,
                json: sinon.stub().resolves({ name: 'numpy', releases: {} }),
            });

            await searchP3MVersions('numpy');

            expect(fetchStub.calledOnce).to.be.true;
            const url = fetchStub.firstCall.args[0] as string;
            expect(url).to.include('/__api__/repos/pypi/packages/numpy');
        });

        test('Should fall back to info.version when releases missing', async () => {
            fetchStub.resolves({
                ok: true,
                json: sinon.stub().resolves({
                    name: 'test-pkg',
                    info: { version: '1.0.0' },
                }),
            });

            const versions = await searchP3MVersions('test-pkg');
            expect(versions).to.deep.equal(['1.0.0']);
        });

        test('Should return empty when no releases and no info', async () => {
            fetchStub.resolves({
                ok: true,
                json: sinon.stub().resolves({ name: 'test-pkg' }),
            });

            const versions = await searchP3MVersions('test-pkg');
            expect(versions).to.have.length(0);
        });

        test('Should fall back to PyPI when P3M fails', async () => {
            // P3M fails
            fetchStub.onFirstCall().resolves({
                ok: false,
                status: 404,
            });
            // PyPI fallback succeeds
            fetchStub.onSecondCall().resolves({
                ok: true,
                json: sinon.stub().resolves({
                    versions: ['1.0.0', '2.0.0'],
                }),
            });

            const versions = await searchP3MVersions('flask');

            expect(fetchStub.calledTwice).to.be.true;
            expect(versions).to.deep.equal(['1.0.0', '2.0.0']);
        });

        test('Should rethrow CancellationError without fallback', async () => {
            fetchStub.rejects(new vscode.CancellationError());

            try {
                await searchP3MVersions('test');
                expect.fail('Should have thrown');
            } catch (e) {
                expect(e).to.be.instanceOf(vscode.CancellationError);
                expect(fetchStub.calledOnce).to.be.true;
            }
        });
    });
});
