/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { appEnv, SECRET_ENV_DENYLIST, SECRET_NAME_PATTERN, secretEnvNames, secretValues } from './appEnv';

describe('appEnv', () => {
	it('strips names listed in OP_MANAGED_VARIABLES', () => {
		const env = appEnv({ OP_MANAGED_VARIABLES: 'FOO_HOST,BAR', FOO_HOST: 'h.example.com', BAR: 'x', PATH: '/bin' });
		expect(env).not.toHaveProperty('FOO_HOST');
		expect(env).not.toHaveProperty('BAR');
		expect(env).not.toHaveProperty('OP_MANAGED_VARIABLES');
		expect(env.PATH).toBe('/bin');
	});

	it('strips denylist names that do not match the pattern', () => {
		const name = SECRET_ENV_DENYLIST.find(n => !SECRET_NAME_PATTERN.test(n))!;
		expect(name).toBeDefined();
		const env = appEnv({ [name]: 'fake-value-123456', PATH: '/bin' });
		expect(env).not.toHaveProperty(name);
		expect(env.PATH).toBe('/bin');
	});

	it('strips names matching the pattern', () => {
		const env = appEnv({
			ANTHROPIC_KEY: 'a', E2E_LEAK_CANARY_KEY: 'b', MY_SECRET_THING: 'c', AWS_SESSION_TOKEN: 'd',
			HOME: '/h', PATH: '/bin', POSITRON_FOO: '1', DISPLAY: ':0', NODE_OPTIONS: '--x',
		});
		expect(Object.keys(env).sort()).toEqual(['DISPLAY', 'HOME', 'NODE_OPTIONS', 'PATH', 'POSITRON_FOO']);
	});

	it('allowlist beats the pattern but not 1Password names', () => {
		const allow = ['ALLOWED_KEY'];
		expect(secretEnvNames({ ALLOWED_KEY: 'x' }, 'linux', allow)).toEqual([]);
		expect(secretEnvNames({ ALLOWED_KEY: 'x', OP_MANAGED_VARIABLES: 'ALLOWED_KEY' }, 'linux', allow))
			.toContain('ALLOWED_KEY');
	});

	it('extraEnv applies last', () => {
		const env = appEnv({ PATH: '/bin' }, { A_KEY: 'v', PATH: undefined });
		expect(env.A_KEY).toBe('v');
		expect(env).not.toHaveProperty('PATH');
	});

	it('matches names case-insensitively on win32', () => {
		const source = { OP_MANAGED_VARIABLES: 'FOO', foo: 'x', Path: 'C:\\' };
		const win = appEnv(source, {}, 'win32');
		expect(win).not.toHaveProperty('foo');
		expect(win.Path).toBe('C:\\');
		expect(appEnv(source, {}, 'linux').foo).toBe('x');
	});

	it('replaces a differently-cased key from extraEnv on win32', () => {
		const env = appEnv({ Path: 'a' }, { PATH: 'b' }, 'win32');
		const keys = Object.keys(env).filter(k => /^path$/i.test(k));
		expect(keys).toHaveLength(1);
		expect(env[keys[0]]).toBe('b');
	});

	it('strips host-name denylist vars from the app env', () => {
		const env = appEnv({ E2E_CONNECT_SERVER: 'https://connect.example.test', DATABRICKS_WORKSPACE: 'https://dbc.example.test', PATH: '/bin' });
		expect(Object.keys(env)).toEqual(['PATH']);
	});

	it('treats the fixed test Postgres login as non-secret', () => {
		expect(secretEnvNames({ E2E_POSTGRES_USER: 'e2e', E2E_POSTGRES_PASSWORD: 'e2e-postgres-test' })).toEqual([]);
	});

	it('matches PAT, passphrase, webhook, PEM, and regcode names, but not PATH', () => {
		const names = ['GH_PAT', 'PAT_RO', 'SSH_PASSPHRASE', 'SLACK_WEBHOOK', 'SIGNING_PEM', 'RSPM_REGCODE', 'PATH', 'DATABRICKS_HTTP_PATH', 'PATTERN'];
		expect(names.filter(n => SECRET_NAME_PATTERN.test(n))).toEqual(names.slice(0, 6));
	});
});

describe('secretValues', () => {
	it('skips short values', () => {
		const values = secretValues({ A_KEY: '1234567', B_KEY: '12345678' }).map(s => s.value);
		expect(values).not.toContain('1234567');
		expect(values).toContain('12345678');
	});

	it('skips non-secret 1Password values', () => {
		const values = secretValues({
			OP_MANAGED_VARIABLES: 'MS_FOUNDRY_BASE_URL,MS_FOUNDRY_KEY,DATABRICKS_HTTP_PATH',
			MS_FOUNDRY_BASE_URL: 'https://fake-host.example.com',
			MS_FOUNDRY_KEY: 'fake-value-123456',
			DATABRICKS_HTTP_PATH: '/sql/1.0/warehouses/fake123456',
		}).map(s => s.value);
		expect(values).toEqual(['fake-value-123456']);
	});

	it('splits multi-line values', () => {
		const body1 = 'fakefakefakefakefakefake1';
		const body2 = 'fakefakefakefakefakefake2';
		const result = secretValues({
			MY_PRIVATE_KEY: `-----BEGIN FAKE KEY-----\n${body1}\n${body2}\nshort\n-----END FAKE KEY-----`,
		});
		expect(result.map(s => s.value)).toEqual([
			body1,
			body2,
			`-----BEGIN FAKE KEY-----\n${body1}\n${body2}\nshort\n-----END FAKE KEY-----`,
		]);
	});

	it('scrubs a multi-line value whose lines are all short as a whole', () => {
		expect(secretValues({ MY_CREDENTIAL: 'user=svc\npass=s3cr3tpw99' })).toEqual([
			{ name: 'MY_CREDENTIAL', value: 'user=svc\npass=s3cr3tpw99' },
		]);
	});

	it('trims single-line values', () => {
		for (const raw of ['abcdefghijkl\n', '  abcdefghijkl  ', 'abcdefghijkl\r\n']) {
			expect(secretValues({ A_KEY: raw })).toEqual([{ name: 'A_KEY', value: 'abcdefghijkl' }]);
		}
	});

	it('skips host, account, and user denylist vars', () => {
		expect(secretValues({
			E2E_CONNECT_SERVER: 'https://connect.example.test',
			DATABRICKS_WORKSPACE: 'https://dbc.example.test',
			SNOWFLAKE_ACCOUNT: 'fake-account-123',
			SNOWFLAKE_USER: 'fake-user-12345',
		})).toEqual([]);
	});

	it('scrubs a 1Password URL that carries a password, and the password alone', () => {
		const values = secretValues({
			OP_MANAGED_VARIABLES: 'DATABASE_URL',
			DATABASE_URL: 'postgres://svc:p%40ssw0rd99@db.internal/app',
		}).map(s => s.value);
		expect(values).toEqual(['postgres://svc:p%40ssw0rd99@db.internal/app', 'p@ssw0rd99']);
	});

	it('keeps the raw password when its percent escape is broken', () => {
		const url = 'postgres://svc:ab%zzcdefgh@db/x';
		expect(secretValues({ DATABASE_URL: url, OP_MANAGED_VARIABLES: 'DATABASE_URL' }).map(s => s.value))
			.toEqual([url, 'ab%zzcdefgh']);
	});

	it('scrubs a URL that carries a query string', () => {
		expect(secretValues({ E2E_CONNECT_SERVER: 'https://h.example.test/?token=abc' }).map(s => s.value))
			.toEqual(['https://h.example.test/?token=abc']);
	});

	it('keeps pattern names with a suffix as secrets', () => {
		expect(secretValues({ MY_TOKEN_URL: 'https://fake.example.test' }).map(s => s.value))
			.toEqual(['https://fake.example.test']);
	});
});
