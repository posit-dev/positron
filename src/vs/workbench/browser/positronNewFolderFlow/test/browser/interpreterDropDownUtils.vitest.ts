/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { groupAndOrderRuntimes } from '../../../../services/languageRuntime/common/runtimeGrouping.js';
import { interpretersToDropdownItems, isValidVenvSeed } from '../../utilities/interpreterDropDownUtils.js';
import { DropDownListBoxSeparator } from '../../../positronComponents/dropDownListBox/dropDownListBoxSeparator.js';

// Mirrors how NewFolderFlowStateManager._getFilteredInterpreters feeds the dropdown:
// grouped-then-flattened so each runtimeSource stays contiguous.
function orderForDropdown(runtimes: ILanguageRuntimeMetadata[]): ILanguageRuntimeMetadata[] {
	return groupAndOrderRuntimes(runtimes).flatMap(group => group.runtimes);
}

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

describe('interpretersToDropdownItems', () => {
	it('orders dropdown items by sort key with a separator at each source boundary', () => {
		// Registration order (base before glob) differs from the target sort-key order,
		// so this assertion fails if the ordering stops reordering.
		const ordered = orderForDropdown([
			rt({ runtimeName: 'base', runtimeSource: 'Base Interpreters', runtimeSortKey: 3000 }),
			rt({ runtimeName: 'glob', runtimeSource: 'Global Environments', runtimeSortKey: 2010 }),
		]);
		const entries = interpretersToDropdownItems(ordered, undefined);
		// Global (key 2010) precedes Base (key 3000), with one separator between them.
		const shape = entries.map(entry =>
			entry instanceof DropDownListBoxSeparator ? '---' : entry.options.value.runtimeSource
		);
		expect(shape).toEqual(['Global Environments', '---', 'Base Interpreters']);
	});

	it('keeps each source contiguous when keyless runtimes would otherwise interleave', () => {
		// Keyless runtimes (no runtimeSortKey, e.g. R) sort by version descending. A bare
		// sort would order these System 4.3, Homebrew 4.2, System 4.1 -- splitting System
		// into two dropdown sections. Grouping keeps each source in one block.
		const ordered = orderForDropdown([
			rt({ runtimeName: 'sys-hi', runtimeSource: 'System', languageVersion: '4.3.0' }),
			rt({ runtimeName: 'brew', runtimeSource: 'Homebrew', languageVersion: '4.2.0' }),
			rt({ runtimeName: 'sys-lo', runtimeSource: 'System', languageVersion: '4.1.0' }),
		]);
		const entries = interpretersToDropdownItems(ordered, undefined);
		const shape = entries.map(entry =>
			entry instanceof DropDownListBoxSeparator ? '---' : entry.options.value.runtimeSource
		);
		// System appears once (both its runtimes together), then a single separator, then Homebrew.
		expect(shape).toEqual(['System', 'System', '---', 'Homebrew']);
	});
});

describe('isValidVenvSeed', () => {
	it('trusts an explicit isValidVenvSeed: false over an eligible category', () => {
		// e.g. an environment-module Python: Base Interpreter (category 3), but the raw
		// path is unsafe to spawn, so the extension stamps the flag false.
		expect(
			isValidVenvSeed(rt({ extraRuntimeData: { environmentCategory: 3, isValidVenvSeed: false } }))
		).toBe(false);
	});

	it('trusts an explicit isValidVenvSeed: true', () => {
		expect(
			isValidVenvSeed(rt({ extraRuntimeData: { environmentCategory: 3, isValidVenvSeed: true } }))
		).toBe(true);
	});

	// The flag is the sole signal: the category is not consulted as a fallback, so an
	// eligible category without the flag is not a seed.
	it('returns false for an eligible category when the flag is absent', () => {
		expect(isValidVenvSeed(rt({ extraRuntimeData: { environmentCategory: 3 } }))).toBe(false);
	});

	it('returns false when the flag is absent', () => {
		expect(isValidVenvSeed(rt({ extraRuntimeData: {} }))).toBe(false);
	});

	it('returns false for a non-Python runtime with no extraRuntimeData', () => {
		expect(isValidVenvSeed(rt({ languageId: 'r', extraRuntimeData: undefined }))).toBe(false);
	});
});
