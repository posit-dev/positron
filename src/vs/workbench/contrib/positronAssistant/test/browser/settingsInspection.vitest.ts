/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { hasExplicitValue, matchesSensitiveKey, PAYLOAD_SENSITIVE_KEYS, REPORT_SENSITIVE_KEYS } from '../../common/settingsInspection.js';

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
