/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { compareLanguages, getLanguageOrder, ILanguageOrderEntry, LANGUAGE_ORDER_KEY } from '../../common/languageOrder.js';

const python = { languageId: 'python', languageName: 'Python' };
const r = { languageId: 'r', languageName: 'R' };
const julia = { languageId: 'julia', languageName: 'Julia' };

function sortIds(entries: ILanguageOrderEntry[], order: readonly string[]): string[] {
	return [...entries].sort((a, b) => compareLanguages(a, b, order)).map(e => e.languageId);
}

describe('compareLanguages', () => {
	it('sorts alphabetically by name when the order is empty', () => {
		expect(sortIds([r, python, julia], [])).toEqual(['julia', 'python', 'r']);
	});

	it('puts listed languages first, in list order', () => {
		expect(sortIds([python, julia, r], ['r', 'python'])).toEqual(['r', 'python', 'julia']);
	});

	it('puts unlisted languages after listed ones, alphabetically', () => {
		expect(sortIds([python, julia, r], ['r'])).toEqual(['r', 'julia', 'python']);
	});

	it('ignores IDs that are not installed', () => {
		expect(sortIds([python, r], ['julia', 'r'])).toEqual(['r', 'python']);
	});

	it('breaks a name tie by languageId', () => {
		const a = { languageId: 'b-lang', languageName: 'Same' };
		const b = { languageId: 'a-lang', languageName: 'Same' };
		expect(sortIds([a, b], [])).toEqual(['a-lang', 'b-lang']);
	});
});

describe('getLanguageOrder', () => {
	it('returns the configured list', () => {
		const config = new TestConfigurationService({ [LANGUAGE_ORDER_KEY]: ['r', 'python'] });
		expect(getLanguageOrder(config)).toEqual(['r', 'python']);
	});

	it.each([
		['a string', 'r'],
		['null', null],
		['an object', { r: 1 }],
	])('returns [] when the value is %s', (_label, value) => {
		const config = new TestConfigurationService({ [LANGUAGE_ORDER_KEY]: value });
		expect(getLanguageOrder(config)).toEqual([]);
	});

	it('drops non-string entries and duplicates', () => {
		const config = new TestConfigurationService({ [LANGUAGE_ORDER_KEY]: ['r', 3, 'r', 'python'] });
		expect(getLanguageOrder(config)).toEqual(['r', 'python']);
	});
});
