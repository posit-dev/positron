/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AuthProvider } from '../authProvider';
import { AWS_AUTH_PROVIDER_ID } from '../constants';
import { createAwsCredentialChain, resolveAwsChainInit } from '../credentials/aws';

// clientConfig is only set for web-identity auth, so tests that assert it
// pass this env; SSO/other paths pass {} and must not get a clientConfig.
const WEB_IDENTITY_ENV = { AWS_WEB_IDENTITY_TOKEN_FILE: '/var/run/token' };

suite('resolveAwsChainInit', () => {
	test('passes the configured region to the STS client config', () => {
		const result = resolveAwsChainInit(
			{ region: 'eu-west-1' }, WEB_IDENTITY_ENV
		);

		assert.deepStrictEqual(result, { clientConfig: { region: 'eu-west-1' } });
	});

	test('prefers the setting region over the AWS_REGION env var', () => {
		const result = resolveAwsChainInit(
			{ region: 'eu-west-1' }, { ...WEB_IDENTITY_ENV, AWS_REGION: 'us-west-2' }
		);

		assert.deepStrictEqual(result, { clientConfig: { region: 'eu-west-1' } });
	});

	test('includes the profile when set, still passing the region', () => {
		const result = resolveAwsChainInit(
			{ profile: 'dev', region: 'ap-southeast-2' }, WEB_IDENTITY_ENV
		);

		assert.deepStrictEqual(result, {
			profile: 'dev',
			clientConfig: { region: 'ap-southeast-2' },
		});
	});

	test('omits clientConfig without web-identity so SSO keeps sso_region', () => {
		const result = resolveAwsChainInit(
			{ profile: 'sso-dev', region: 'eu-west-1' }, {}
		);

		assert.deepStrictEqual(result, { profile: 'sso-dev' });
	});
});

suite('AWS credential chain (web identity)', () => {
	let tokenDir: string;
	let tokenFile: string;
	let provider: AuthProvider;
	let addedEvents: number;

	setup(() => {
		tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aws-web-identity-'));
		tokenFile = path.join(tokenDir, 'id_token');
		const env = {
			AWS_WEB_IDENTITY_TOKEN_FILE: tokenFile,
			AWS_ROLE_ARN: 'arn:aws:iam::123456789012:role/bedrock',
		};
		const globalState = new Map<string, unknown>();
		const context = {
			secrets: { get: () => Promise.resolve(undefined) },
			globalState: {
				get: <T>(key: string) => globalState.get(key) as T | undefined,
				update: (key: string, value: unknown) => {
					globalState.set(key, value);
					return Promise.resolve();
				},
			},
		} as unknown as vscode.ExtensionContext;

		// Stands in for fromNodeProviderChain's web-identity leg: it reads the
		// token file, so it fails with ENOENT until the file exists, and the
		// STS exchange it would then make is replaced by fixed credentials.
		const fakeChain = () => async () => {
			const idToken = await fs.promises.readFile(env.AWS_WEB_IDENTITY_TOKEN_FILE, 'utf8');
			return {
				accessKeyId: 'ASIA',
				secretAccessKey: `secret-for-${idToken}`,
				sessionToken: 'session',
				expiration: new Date(Date.now() + 60 * 60 * 1000),
			};
		};

		provider = new AuthProvider(
			AWS_AUTH_PROVIDER_ID, 'AWS', context, undefined,
			createAwsCredentialChain(() => ({ region: 'eu-west-1' }), env, fakeChain),
		);
		addedEvents = 0;
		provider.onDidChangeSessions(e => {
			addedEvents += e.added?.length ?? 0;
		});
	});

	teardown(() => {
		provider.dispose();
		fs.rmSync(tokenDir, { recursive: true, force: true });
	});

	// #15292: on Workbench the token file is written asynchronously by the
	// session agent, so activation can resolve before it exists.
	test('signs in once the identity token file appears after a failed startup resolve', async () => {
		const atStartup = await provider.resolveChainCredentials();

		fs.writeFileSync(tokenFile, 'jwt');
		const sessions = await provider.getSessions();

		assert.deepStrictEqual(
			{ atStartup, sessions: sessions.length, addedEvents },
			{ atStartup: undefined, sessions: 1, addedEvents: 1 },
		);
	});
});
