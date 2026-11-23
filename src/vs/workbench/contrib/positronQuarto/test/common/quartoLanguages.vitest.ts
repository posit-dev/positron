/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICellRuntimeContext, leadingConnectLine, rendersWithKnitr, runtimeLanguageOf } from '../../common/quartoLanguages.js';

function context(knitrEngine: boolean | undefined, ...languages: string[]): ICellRuntimeContext {
	return { primaryLanguage: languages[0], knitrEngine, cells: languages.map(language => ({ language })) };
}

describe('rendersWithKnitr', () => {
	it('follows the declared engine, else whether there is an {r} cell, as Quarto and the Quarto extension do', () => {
		expect([
			// `engine: knitr` (or a `knitr` key) with python first
			rendersWithKnitr(context(true, 'python', 'sql')),
			// `engine: jupyter` (or a `jupyter` key) with R first
			rendersWithKnitr(context(false, 'r', 'sql')),
			// nothing declared: any {r} cell, not only a first one
			rendersWithKnitr(context(undefined, 'python', 'r')),
			rendersWithKnitr(context(undefined, 'R')),
			rendersWithKnitr(context(undefined, 'python', 'sql')),
		]).toEqual([true, false, true, true, false]);
	});
});

describe('runtimeLanguageOf', () => {
	it('runs {sql} cells in ggsql, except where knitr renders them', () => {
		const jupyter = context(false, 'ggsql');
		const python = context(undefined, 'python');
		const knitr = context(undefined, 'r');
		expect([
			runtimeLanguageOf('sql', jupyter),
			runtimeLanguageOf('SQL', python),
			runtimeLanguageOf('sql', knitr),
			runtimeLanguageOf('ggsql', knitr),
			runtimeLanguageOf('python', python),
		]).toEqual(['ggsql', 'ggsql', 'sql', 'ggsql', 'python']);
	});
});

describe('leadingConnectLine', () => {
	it('reads the last leading @connect line, past options and blank lines, as ggsql does', () => {
		expect([
			leadingConnectLine('\n-- @connect: duckdb://a.db\n-- @connect:  duckdb://b.db \nSELECT 1'),
			leadingConnectLine('SELECT 1;\n-- @connect: duckdb://a.db'),
			leadingConnectLine('--@connect: duckdb://a.db'),
			leadingConnectLine('SELECT 1'),
			leadingConnectLine('-- @uncache\n-- @connect: duckdb://a.db\nSELECT 1'),
		]).toEqual(['-- @connect: duckdb://b.db', undefined, undefined, undefined, '-- @connect: duckdb://a.db']);
	});

	it('stops where ggsql stops reading directives', () => {
		expect([
			// ggsql knows no directive besides @connect and @uncache
			leadingConnectLine('-- @typo\n-- @connect: duckdb://a.db\nSELECT 1'),
			// ggsql reads an option line left in the code as code
			leadingConnectLine('--| label: q\n-- @connect: duckdb://a.db\nSELECT 1'),
		]).toEqual([undefined, undefined]);
	});
});
