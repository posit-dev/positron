/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as Sinon from 'sinon';
import * as vscode from 'vscode';
import { makeMetadata } from '../provider';
import { ReasonDiscovered, RInstallation } from '../r-installation';

function makeRInst(binpath: string): RInstallation {
	return {
		binpath,
		homepath: '',
		version: '4.4.0',
		semVersion: { major: 4, minor: 4, patch: 0 } as any,
		arch: '',
		usable: true,
		supported: true,
		current: false,
		orthogonal: false,
		default: false,
		packagerMetadata: undefined,
		reasonDiscovered: [ReasonDiscovered.PATH],
		reasonRejected: null,
	} as unknown as RInstallation;
}

suite('makeMetadata path fields', () => {
	let sandbox: Sinon.SinonSandbox;

	setup(() => {
		sandbox = Sinon.createSandbox();
		sandbox.stub(vscode.workspace, 'getConfiguration').returns({
			get: (_key: string, def?: unknown) => def,
		} as unknown as vscode.WorkspaceConfiguration);
	});

	teardown(() => sandbox.restore());

	test('runtimePath is always the full absolute binary path', async () => {
		const binpath = '/usr/bin/R';
		const metadata = await makeMetadata(makeRInst(binpath));
		assert.strictEqual(metadata.runtimePath, binpath);
	});

	test('runtimeDisplayPath is undefined for a system (non-home-dir) install', async () => {
		const binpath = '/usr/bin/R';
		const metadata = await makeMetadata(makeRInst(binpath));
		assert.strictEqual(metadata.runtimeDisplayPath, undefined);
	});
});
