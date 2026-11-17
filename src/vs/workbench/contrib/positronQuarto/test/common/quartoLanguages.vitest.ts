/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { leadingConnectLine, runtimeLanguageOf } from '../../common/quartoLanguages.js';

describe('runtimeLanguageOf', () => {
	it('runs {sql} cells in ggsql, except where knitr renders them', () => {
		const jupyter = { jupyterKernel: 'ggsql', primaryLanguage: 'ggsql' };
		const python = { jupyterKernel: undefined, primaryLanguage: 'python' };
		const knitr = { jupyterKernel: undefined, primaryLanguage: 'r' };
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
			leadingConnectLine('--| label: q\n\n-- @connect: duckdb://a.db\n-- @connect:  duckdb://b.db \nSELECT 1'),
			leadingConnectLine('SELECT 1;\n-- @connect: duckdb://a.db'),
			leadingConnectLine('--@connect: duckdb://a.db'),
			leadingConnectLine('SELECT 1'),
		]).toEqual(['-- @connect: duckdb://b.db', undefined, undefined, undefined]);
	});
});
