/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { hasExplicitValue, matchesSensitiveKey, PAYLOAD_SENSITIVE_KEYS, redactSensitiveProperties, REPORT_SENSITIVE_KEYS } from '../../common/settingsInspection.js';

describe('matchesSensitiveKey', () => {
	it('separates the report list from the payload list on credentials', () => {
		// The report is an editor the user reads and chooses to share, and the
		// authentication.*.credentials settings hold non-secret config vars. The
		// payload enters a transcript the user never reviews, so it takes the
		// stricter list. This is the case that proves the two lists stayed apart.
		const key = 'positron.assistant.authentication.aws.credentials';

		expect({
			report: matchesSensitiveKey(key, REPORT_SENSITIVE_KEYS),
			payload: matchesSensitiveKey(key, PAYLOAD_SENSITIVE_KEYS),
		}).toEqual({ report: false, payload: true });
	});

	it('matches the payload list short tokens as whole segments, not substrings', () => {
		// 'pat', 'key' and 'auth' as substrings would redact an interpreter path,
		// a keybinding setting and anything ending in 'authority'. An interpreter
		// path is exactly what a settings-diagnosis flow needs to see.
		const matches = (key: string) => matchesSensitiveKey(key, PAYLOAD_SENSITIVE_KEYS);

		expect({
			interpreterPath: matches('python.defaultInterpreterPath'),
			keybindings: matches('terminal.integrated.sendKeybindingsToShell'),
			bareKey: matches('some.extension.key'),
			barePat: matches('some.extension.pat'),
			apiKey: matches('some.extension.apiKey'),
		}).toEqual({
			interpreterPath: false,
			keybindings: false,
			bareKey: true,
			barePat: true,
			apiKey: true,
		});
	});

	it('redacts a proxy authorization credential without touching authority keys', () => {
		// http.proxyAuthorization is documented as the literal value sent as the
		// Proxy-Authorization header, a Basic credential. Its final segment,
		// "proxyauthorization", matched none of the payload list's tokens before
		// "authorization" was added. remote.SSH.authority proves the fix does not
		// also catch keys that merely end in "authority".
		const matches = (key: string) => matchesSensitiveKey(key, PAYLOAD_SENSITIVE_KEYS);

		expect({
			proxyAuthorization: matches('http.proxyAuthorization'),
			sshAuthority: matches('remote.SSH.authority'),
		}).toEqual({
			proxyAuthorization: true,
			sshAuthority: false,
		});
	});
	it('redacts known credential-bearing keys whole, without touching their neighbors', () => {
		// http.proxy is a URL that may embed user:password@host inline, and the
		// terminal env maps hold environment variables that are frequently
		// tokens; no segment of either key is credential-shaped, so they need
		// whole-key entries. http.proxySupport and http.proxyStrictSSL prove the
		// match is the whole key, not a 'proxy' or 'env' token that would drag
		// in every configuration toggle nearby.
		const matches = (key: string) => matchesSensitiveKey(key, PAYLOAD_SENSITIVE_KEYS);

		expect({
			proxy: matches('http.proxy'),
			envWindows: matches('terminal.integrated.env.windows'),
			envLinux: matches('terminal.integrated.env.linux'),
			envOsx: matches('terminal.integrated.env.osx'),
			proxySupport: matches('http.proxySupport'),
			proxyStrictSSL: matches('http.proxyStrictSSL'),
		}).toEqual({
			proxy: true,
			envWindows: true,
			envLinux: true,
			envOsx: true,
			proxySupport: false,
			proxyStrictSSL: false,
		});
	});
});

describe('redactSensitiveProperties', () => {
	it('redacts credential-shaped property names inside an object value, keeping the rest', () => {
		// The setting's own key can be innocuous while a property inside holds
		// the credential. Env-var names have no dots, so the whole name is the
		// matched segment: GITHUB_TOKEN hits 'token', AWS_SECRET_ACCESS_KEY hits
		// 'secret', and PATH survives.
		const result = redactSensitiveProperties({
			PATH: '/usr/local/bin',
			GITHUB_TOKEN: 'ghp-secret',
			nested: { options: [{ apiKey: 'sk-secret' }] },
		}, PAYLOAD_SENSITIVE_KEYS);

		expect(result).toEqual({
			redacted: true,
			value: {
				PATH: '/usr/local/bin',
				GITHUB_TOKEN: '<redacted>',
				nested: { options: [{ apiKey: '<redacted>' }] },
			},
		});
	});

	it('returns a clean value as-is and says nothing was redacted', () => {
		const value = { PATH: '/usr/local/bin', flags: [1, 2, 3] };

		const result = redactSensitiveProperties(value, PAYLOAD_SENSITIVE_KEYS);

		expect(result.redacted).toBe(false);
		// Same reference, not a rebuilt copy: nothing changed, so nothing was
		// reallocated.
		expect(result.value).toBe(value);
	});

	it('passes primitives and null through untouched', () => {
		expect({
			string: redactSensitiveProperties('plain', PAYLOAD_SENSITIVE_KEYS),
			nullValue: redactSensitiveProperties(null, PAYLOAD_SENSITIVE_KEYS),
		}).toEqual({
			string: { value: 'plain', redacted: false },
			nullValue: { value: null, redacted: false },
		});
	});
});

describe('hasExplicitValue', () => {
	it('counts an application-target value and a null value as explicitly set', () => {
		// applicationValue was missing from the original predicate. null is a legal
		// value in settings.json, and the original's ?? chain skipped past it and
		// reported the setting as untouched.
		expect({
			application: hasExplicitValue({ applicationValue: 'set' }),
			nullUser: hasExplicitValue({ userValue: null }),
			untouched: hasExplicitValue({}),
		}).toEqual({ application: true, nullUser: true, untouched: false });
	});
});
