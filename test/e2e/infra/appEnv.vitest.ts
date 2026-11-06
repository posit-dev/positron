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
});

describe('secretValues', () => {
	it('skips short values', () => {
		const values = secretValues({ A_KEY: '1234567', B_KEY: '12345678' }).map(s => s.value);
		expect(values).not.toContain('1234567');
		expect(values).toContain('12345678');
	});

	it('skips non-secret 1Password values', () => {
		const values = secretValues({
			OP_MANAGED_VARIABLES: 'MS_FOUNDRY_BASE_URL,MS_FOUNDRY_KEY',
			MS_FOUNDRY_BASE_URL: 'https://fake-host.example.com',
			MS_FOUNDRY_KEY: 'fake-value-123456',
		}).map(s => s.value);
		expect(values).toContain('fake-value-123456');
		expect(values).not.toContain('https://fake-host.example.com');
	});

	it('splits multi-line values', () => {
		const body1 = 'fakefakefakefakefakefake1';
		const body2 = 'fakefakefakefakefakefake2';
		const result = secretValues({
			MY_PRIVATE_KEY: `-----BEGIN FAKE KEY-----\n${body1}\n${body2}\nshort\n-----END FAKE KEY-----`,
		});
		expect(result).toEqual([
			{ name: 'MY_PRIVATE_KEY', value: body1 },
			{ name: 'MY_PRIVATE_KEY', value: body2 },
		]);
	});

	it('trims single-line values', () => {
		for (const raw of ['abcdefghijkl\n', '  abcdefghijkl  ', 'abcdefghijkl\r\n']) {
			expect(secretValues({ A_KEY: raw })).toEqual([{ name: 'A_KEY', value: 'abcdefghijkl' }]);
		}
	});

	it('skips host-name denylist vars', () => {
		expect(secretValues({ E2E_CONNECT_SERVER: 'https://connect.example.test', DATABRICKS_WORKSPACE: 'https://dbc.example.test' })).toEqual([]);
	});
});
