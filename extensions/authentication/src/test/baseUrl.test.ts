/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { getEffectiveBaseUrl } from '../providerSources';

suite('getEffectiveBaseUrl', () => {
	// `anthropic` is backed by ANTHROPIC_BASE_URL; `foundry` has no env var.
	const ENV_VAR = 'ANTHROPIC_BASE_URL';

	let mockInspect: sinon.SinonStub;
	let originalEnvValue: string | undefined;

	setup(() => {
		originalEnvValue = process.env[ENV_VAR];
		delete process.env[ENV_VAR];

		mockInspect = sinon.stub();
		const mockConfig = {
			get: sinon.stub(),
			has: sinon.stub(),
			inspect: mockInspect,
			update: sinon.stub(),
		} as unknown as vscode.WorkspaceConfiguration;
		sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);
	});

	teardown(() => {
		sinon.restore();
		if (originalEnvValue === undefined) {
			delete process.env[ENV_VAR];
		} else {
			process.env[ENV_VAR] = originalEnvValue;
		}
	});

	function stubInspect(values: {
		globalValue?: string;
		workspaceValue?: string;
		workspaceFolderValue?: string;
	}): void {
		mockInspect.returns({ key: 'baseUrl', ...values });
	}

	test('user setting wins over the env var', () => {
		stubInspect({ globalValue: 'https://user.example.com' });
		process.env[ENV_VAR] = 'https://env.example.com';

		assert.strictEqual(
			getEffectiveBaseUrl('anthropic', 'https://fallback.example.com'),
			'https://user.example.com'
		);
	});

	test('env var is used when the user has no setting', () => {
		stubInspect({});
		process.env[ENV_VAR] = 'https://env.example.com';

		assert.strictEqual(
			getEffectiveBaseUrl('anthropic', 'https://fallback.example.com'),
			'https://env.example.com'
		);
	});

	test('workspace value takes precedence over the global value', () => {
		stubInspect({
			globalValue: 'https://global.example.com',
			workspaceValue: 'https://workspace.example.com',
		});

		assert.strictEqual(
			getEffectiveBaseUrl('anthropic'),
			'https://workspace.example.com'
		);
	});

	test('falls back when neither user setting nor env var is set', () => {
		stubInspect({});

		assert.strictEqual(
			getEffectiveBaseUrl('anthropic', 'https://fallback.example.com'),
			'https://fallback.example.com'
		);
	});

	test('returns undefined when nothing is set and no fallback is given', () => {
		stubInspect({});

		assert.strictEqual(getEffectiveBaseUrl('anthropic'), undefined);
	});

	test('ignores env vars for a section that has no mapping', () => {
		stubInspect({});
		// Even if an unrelated base-URL env var is present, foundry has no
		// mapping, so it must not leak in.
		process.env[ENV_VAR] = 'https://env.example.com';

		assert.strictEqual(
			getEffectiveBaseUrl('foundry', 'https://fallback.example.com'),
			'https://fallback.example.com'
		);
	});
});
