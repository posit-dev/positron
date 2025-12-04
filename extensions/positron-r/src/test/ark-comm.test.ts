/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup'

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as testKit from './kit';
import { RSession } from '../session';
import { Comm, CommBackendMessage } from '../positron-supervisor';
import { whenTimeout } from '../util';

suite('ArkComm', () => {
	let session: RSession;
	let sesDisposable: vscode.Disposable;
	let comm: Comm;

	suiteSetup(async () => {
		const [ses, disposable] = await testKit.startR('Suite: ArkComm');
		session = ses;
		sesDisposable = disposable;

		await session.startArkComm();
		assert.notStrictEqual(session.arkComm, undefined);
		assert.notStrictEqual(session.arkComm!.comm, undefined);

		comm = session.arkComm!.comm!;
	});

	suiteTeardown(async () => {
		if (sesDisposable) {
			await sesDisposable.dispose();
		}
	});

	test('Can send notification', async () => {
		comm.notify("test_notification", { i: 10 });

		// Backend should echo back
		const notifReply = await assertNextMessage(comm);
		assert.deepStrictEqual(
			notifReply,
			{
				kind: 'notification',
				method: 'test_notification',
				params: {
					i: -10
				}
			}
		)
	});

	test('Can send request', async () => {
		const requestReply = await assertRequest(comm, 'test_request', { i: 11 });
		assert.deepStrictEqual(requestReply, { i: -11 })
	});

	test('Invalid method sends error', async () => {
		await assert.rejects(
			async () => {
				await assertRequest(comm, 'invalid_request', {});
			},
			(error: any) => {
				return error.name === 'CommRpcError';
			}
		);
	});

	test('Request can error', async () => {
		await assert.rejects(
			async () => {
				await assertRequest(comm, 'test_request_error', {});
			},
			(error: any) => {
				return error.name === 'CommRpcError' && /this-is-an-error/.test(error.message);
			}
		);
	});
});

async function assertNextMessage(comm: Comm): Promise<CommBackendMessage> {
	const result = await Promise.race([
		comm.receiver.next(),
		whenTimeout(5000, () => assert.fail(`Timeout while expecting comm message on ${comm.id}`)),
	]) as any;

	assert.strictEqual(result.done, false)
	return result.value;
}

async function assertRequest(comm: Comm, method: string, params?: Record<string, unknown>): Promise<any> {
	return await Promise.race([
		comm.request(method, params),
		whenTimeout(5000, () => assert.fail(`Timeout while expecting comm reply on ${comm.id}`)),
	]);
}
