/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { getEffectiveBaseUrl } from '../providerSources';

/**
 * The section -> env var contract each provider relies on. Hardcoded here
 * independently of the implementation's map so a typo in either the section key
 * or the env var name is caught.
 */
const PROVIDER_ENV_VARS: ReadonlyArray<{ section: string; envVar: string }> = [
	{ section: 'anthropic', envVar: 'ANTHROPIC_BASE_URL' },
	{ section: 'openai-api', envVar: 'OPENAI_BASE_URL' },
	{ section: 'google', envVar: 'GEMINI_BASE_URL' },
	{ section: 'googleVertex', envVar: 'GOOGLE_VERTEX_BASE_URL' },
	{ section: 'deepseek-api', envVar: 'DEEPSEEK_BASE_URL' },
];

suite('getEffectiveBaseUrl', () => {
	let mockInspect: sinon.SinonStub;
	const savedEnv = new Map<string, string | undefined>();

	setup(() => {
		// Snapshot and clear every mapped env var so the host environment can't
		// leak into a test.
		for (const { envVar } of PROVIDER_ENV_VARS) {
			savedEnv.set(envVar, process.env[envVar]);
			delete process.env[envVar];
		}

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
		for (const [envVar, value] of savedEnv) {
			if (value === undefined) {
				delete process.env[envVar];
			} else {
				process.env[envVar] = value;
			}
		}
		savedEnv.clear();
	});

	function stubInspect(values: {
		globalValue?: string;
		workspaceValue?: string;
		workspaceFolderValue?: string;
	}): void {
		mockInspect.returns({ key: 'baseUrl', ...values });
	}

	suite('precedence', () => {
		test('user setting wins over the env var', () => {
			stubInspect({ globalValue: 'https://user.example.com' });
			process.env.ANTHROPIC_BASE_URL = 'https://env.example.com';

			assert.strictEqual(
				getEffectiveBaseUrl('anthropic', 'https://fallback.example.com'),
				'https://user.example.com'
			);
		});

		test('env var is used when the user has no setting', () => {
			stubInspect({});
			process.env.ANTHROPIC_BASE_URL = 'https://env.example.com';

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
	});

	suite('per-provider env var mapping', () => {
		for (const { section, envVar } of PROVIDER_ENV_VARS) {
			test(`${section} reads ${envVar}`, () => {
				stubInspect({});
				const expected = `https://${section}.example.com`;
				process.env[envVar] = expected;

				assert.strictEqual(getEffectiveBaseUrl(section), expected);
			});
		}

		test('ignores env vars for a section that has no mapping', () => {
			stubInspect({});
			// Even with a base-URL env var present, foundry has no mapping, so
			// nothing from the environment must leak in.
			process.env.ANTHROPIC_BASE_URL = 'https://env.example.com';

			assert.strictEqual(
				getEffectiveBaseUrl('foundry', 'https://fallback.example.com'),
				'https://fallback.example.com'
			);
		});
	});
});
