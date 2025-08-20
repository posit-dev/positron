/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { ArkComm } from '../ark-comm';
import * as testKit from './kit';
import { RSession } from '../session';
import { RawComm, CommBackendMessage } from '../positron-supervisor';
import { whenTimeout } from '../util';

suite('ArkComm', () => {
	let session: RSession;
	let sesDisposable: vscode.Disposable;
	let comm: RawComm;

	suiteSetup(async () => {
		const [ses, disposable] = await testKit.startR();
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
		assert(comm.notify("test_notification", { i: 10 }));

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
});

async function assertNextMessage(comm: RawComm): Promise<CommBackendMessage> {
	const result = await Promise.race([
		comm.receiver.next(),
		whenTimeout(5000, () => assert.fail(`Timeout while expecting comm message on ${comm.id}`)),
	]) as any;

	assert.strictEqual(result.done, false)
	return result.value;
}

async function assertRequest(comm: RawComm, method: string, params?: Record<string, unknown>): Promise<any> {
	const [delivered, reply] = await Promise.race([
		comm.request(method, params),
		whenTimeout(5000, () => assert.fail(`Timeout while expecting comm reply on ${comm.id}`)),
	]);

	assert.strictEqual(delivered, true);
	return reply;
}
