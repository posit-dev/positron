/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { parseCompactPath, quoteCompactToken } from '../../common/dataConnectionCompactFormat.js';

describe('parseCompactPath', () => {
	it.each([
		['SALES.PUBLIC.ORDERS', ['SALES', 'PUBLIC', 'ORDERS']],
		['Sales.public.orders', ['Sales', 'public', 'orders']],
		['ORDERS', ['ORDERS']],
		['SALES.PUBLIC."Order Details"', ['SALES', 'PUBLIC', 'Order Details']],
		['"a.b"."c\\"d".e', ['a.b', 'c"d', 'e']],
		['"".x', ['', 'x']],
	])('splits %s into its names', (text, expected) => {
		expect(parseCompactPath(text)).toEqual(expected);
	});

	it.each([
		[''],
		['A..B'],
		['A.B.'],
		['.A'],
		['A."B'],
		['A."B"C'],
		['A.B"C'],
		['"\\x"'],
		['SALES.RAW.ORDERS_LOAD [stage]'],
		['SALES.PUBLIC.Order Details'],
		['A.<masked>'],
		['A.B,C'],
	])('rejects %j', text => {
		expect(parseCompactPath(text)).toBeUndefined();
	});

	// The property callers rely on: a path rendered with the schema and lineage summaries' quoting
	// splits back into exactly the names it was rendered from, whatever those names contain.
	it('reads back any path the summaries render', () => {
		const names = ['ORDERS', 'orders', 'Order Details', 'a.b', 'x->y', '<masked>', 'say "hi"', 'line\nbreak', ''];
		const rendered = names.map(name => quoteCompactToken(name, '.,:()[]<> ')).join('.');

		expect(parseCompactPath(rendered)).toEqual(names);
	});
});
