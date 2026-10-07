/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { createInterpreterVariant, getMatchingDefinitions, IInterpreterDefinition, recreateInterpreterVariant } from '../../common/interpreterDefinitions.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionLocation, LanguageRuntimeStartupBehavior } from '../../common/languageRuntimeService.js';

const base: ILanguageRuntimeMetadata = {
	runtimeId: 'base-id',
	runtimeName: 'R 4.4.3',
	runtimeShortName: '4.4.3',
	runtimePath: '/opt/R/4.4.3/bin/R',
	runtimeVersion: '1.0.0',
	runtimeSource: 'System',
	languageId: 'r',
	languageName: 'R',
	languageVersion: '4.4.3',
	base64EncodedIconSvg: undefined,
	startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
	sessionLocation: LanguageRuntimeSessionLocation.Workspace,
	extensionId: new ExtensionIdentifier('positron.positron-r'),
	extraRuntimeData: { binpath: '/opt/R/4.4.3/bin/R' },
	cacheable: true,
};

const xx: IInterpreterDefinition = { language: 'r', path: '/opt/R/4.4.3/bin/R', label: 'R 4.4.3 (XX libs)', env: { R_LIBS_SITE: '/xx' } };

describe('getMatchingDefinitions', () => {
	it('matches on language and exact path, and drops incomplete and duplicate-label entries', () => {
		// Includes malformed entries, as a hand-edited setting can.
		const definitions: unknown[] = [
			xx,
			{ ...xx, label: 'Other path', path: '/opt/R/4.3.0/bin/R' },
			{ ...xx, label: 'Other language', language: 'python' },
			{ ...xx, label: '' },
			{ ...xx, label: 'Bad env', env: ['R_LIBS_SITE=/bad'] },
			{ ...xx, label: 'Bad startup script', startupScript: 42 },
			{ ...xx, env: { R_LIBS_SITE: '/dup' } },
		];
		expect(getMatchingDefinitions(definitions as IInterpreterDefinition[], base)).toEqual([xx]);
	});

	it('returns nothing when the setting is unset', () => {
		expect(getMatchingDefinitions(undefined, base)).toEqual([]);
	});

	it('ignores malformed setting values instead of throwing', () => {
		// Setting values are not type-checked when read, so model what a user can actually write.
		const malformed = (value: unknown) => value as IInterpreterDefinition[];
		expect([
			getMatchingDefinitions(malformed(xx), base),
			getMatchingDefinitions(malformed([null, 'r', { ...xx, path: 42 }, xx]), base),
		]).toEqual([[], [xx]]);
	});
});

describe('createInterpreterVariant', () => {
	it('copies the base runtime with a derived ID, the label as name, and caching off', () => {
		const variant = createInterpreterVariant({ ...base, definitionOnly: true }, xx);
		expect({ ...variant, runtimeId: undefined }).toEqual({
			...base,
			runtimeId: undefined,
			runtimeName: 'R 4.4.3 (XX libs)',
			interpreterDefinition: 'R 4.4.3 (XX libs)',
			definitionOnly: false,
			cacheable: false,
		});
		expect(variant.runtimeId).toMatch(/^[0-9a-f]{32}$/);
	});

	it('derives a stable ID that differs per label and per base', () => {
		const id = createInterpreterVariant(base, xx).runtimeId;
		expect(createInterpreterVariant(base, xx).runtimeId).toBe(id);
		expect(createInterpreterVariant(base, { ...xx, label: 'YY' }).runtimeId).not.toBe(id);
		expect(createInterpreterVariant({ ...base, runtimeId: 'other-base' }, xx).runtimeId).not.toBe(id);
	});
});

describe('recreateInterpreterVariant', () => {
	it('rebuilds the variant from validated base metadata', () => {
		expect(recreateInterpreterVariant([xx], base, xx.label)).toEqual(createInterpreterVariant(base, xx));
	});

	it('returns undefined when the definition was removed or no longer matches the base', () => {
		expect(recreateInterpreterVariant([], base, xx.label)).toBeUndefined();
		expect(recreateInterpreterVariant([{ ...xx, path: '/elsewhere/R' }], base, xx.label)).toBeUndefined();
	});
});
