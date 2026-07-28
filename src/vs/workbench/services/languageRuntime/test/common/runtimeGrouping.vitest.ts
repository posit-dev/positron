/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILanguageRuntimeMetadata } from '../../common/languageRuntimeService.js';
import { groupAndOrderRuntimes, orderRuntimes } from '../../common/runtimeGrouping.js';

function rt(overrides: Partial<ILanguageRuntimeMetadata>): ILanguageRuntimeMetadata {
	// eslint-disable-next-line local/code-no-dangerous-type-assertions -- test helper creates mock object
	return {
		runtimeId: overrides.runtimeName ?? Math.random().toString(),
		runtimeName: 'rt',
		runtimeShortName: 'rt',
		runtimeSource: 'Group',
		runtimePath: '/p',
		runtimeVersion: '1.0.0',
		languageId: 'python',
		languageName: 'Python',
		languageVersion: '3.12.0',
		base64EncodedIconSvg: '',
		// eslint-disable-next-line local/code-no-dangerous-type-assertions -- test helper creates mock object
		extensionId: { value: 'ext', _lower: 'ext' } as unknown as ILanguageRuntimeMetadata['extensionId'],
		extraRuntimeData: { supported: true },
		startupBehavior: 0,
		sessionLocation: 0,
		...overrides,
	} as ILanguageRuntimeMetadata;
}

describe('runtimeGrouping', () => {
	it('orders groups by smallest sort key, items by key then version desc then name', () => {
		const runtimes = [
			rt({ runtimeName: 'sys', runtimeSource: 'Externally Managed', runtimeSortKey: 4020, languageVersion: '3.9.6' }),
			rt({ runtimeName: 'venvB', runtimeSource: 'Global Environments', runtimeSortKey: 2010, languageVersion: '3.12.8' }),
			rt({ runtimeName: 'venvA', runtimeSource: 'Global Environments', runtimeSortKey: 2010, languageVersion: '3.13.2' }),
			rt({ runtimeName: 'conda', runtimeSource: 'Global Environments', runtimeSortKey: 2030, languageVersion: '3.11.9' }),
		];
		const groups = groupAndOrderRuntimes(runtimes);
		expect(groups.map(g => [g.label, g.runtimes.map(r => r.runtimeName)])).toMatchInlineSnapshot(`
			[
			  [
			    "Global Environments",
			    [
			      "venvA",
			      "venvB",
			      "conda",
			    ],
			  ],
			  [
			    "Externally Managed",
			    [
			      "sys",
			    ],
			  ],
			]
		`);
	});

	it('sorts keyless runtimes (e.g. R) after keyed ones, by version descending', () => {
		const runtimes = [
			rt({ runtimeName: 'py', runtimeSource: 'Base Interpreters', runtimeSortKey: 3000 }),
			rt({ runtimeName: 'rA', languageId: 'r', runtimeSource: 'System', languageVersion: '4.3.3' }),
			rt({ runtimeName: 'rB', languageId: 'r', runtimeSource: 'System', languageVersion: '4.4.1' }),
		];
		expect(orderRuntimes(runtimes).map(r => r.runtimeName)).toEqual(['py', 'rB', 'rA']);
	});

	it('sorts unsupported runtimes last within equal sort keys', () => {
		const runtimes = [
			rt({ runtimeName: 'old', runtimeSortKey: 3000, languageVersion: '3.8.0', extraRuntimeData: { supported: false } }),
			rt({ runtimeName: 'new', runtimeSortKey: 3000, languageVersion: '3.12.0', extraRuntimeData: { supported: true } }),
		];
		expect(orderRuntimes(runtimes).map(r => r.runtimeName)).toEqual(['new', 'old']);
	});

	it('orders prerelease versions without NaN poisoning the comparator', () => {
		const runtimes = [
			rt({ runtimeName: 'stable', runtimeSortKey: 3000, languageVersion: '3.13.1' }),
			rt({ runtimeName: 'prerelease', runtimeSortKey: 3000, languageVersion: '3.14.0a5' }),
		];
		expect(orderRuntimes(runtimes).map(r => r.runtimeName)).toEqual(['prerelease', 'stable']);
	});
});
