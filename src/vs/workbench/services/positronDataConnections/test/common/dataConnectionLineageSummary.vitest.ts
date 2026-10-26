/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { renderLineageLines } from '../../common/dataConnectionLineageSummary.js';
import { IDataConnectionLineageEdge, IDataConnectionLineageObject } from '../../common/interfaces/dataConnectionDriver.js';

function table(name: string, overrides: Partial<IDataConnectionLineageObject> = {}): IDataConnectionLineageObject {
	return { database: 'SALES', schema: 'PUBLIC', name, domain: 'table', ...overrides };
}

function edge(source: IDataConnectionLineageObject, target: IDataConnectionLineageObject, distance: number = 1): IDataConnectionLineageEdge {
	return { source, target, distance };
}

describe('renderLineageLines', () => {
	it('renders an empty lineage as no lines', () => {
		expect(renderLineageLines([])).toEqual([]);
	});

	// The driver's order (nearest first) is the payload's order; the renderer does not re-sort.
	it('renders one line per edge, in order, as qualified paths', () => {
		expect(renderLineageLines([
			edge(table('ORDERS'), table('ORDERS_DAILY')),
			edge(table('ORDERS_DAILY'), table('ORDERS_MONTHLY'), 2),
		])).toEqual([
			'1 SALES.PUBLIC.ORDERS -> SALES.PUBLIC.ORDERS_DAILY',
			'2 SALES.PUBLIC.ORDERS_DAILY -> SALES.PUBLIC.ORDERS_MONTHLY',
		]);
	});

	it('ends a column edge\'s paths in the column, without a domain tag', () => {
		expect(renderLineageLines([
			edge(table('ORDERS', { column: 'TOTAL', domain: 'column' }), table('ORDERS_DAILY', { column: 'REVENUE', domain: 'COLUMN' })),
		])).toEqual(['1 SALES.PUBLIC.ORDERS.TOTAL -> SALES.PUBLIC.ORDERS_DAILY.REVENUE']);
	});

	// A stage's path reads like a table's, so its kind is spelled out; an object outside the data
	// source has no database or schema, so its path is just its name.
	it('tags an end that is not a table or column with its domain', () => {
		expect(renderLineageLines([
			edge(table('ORDERS_LOAD', { domain: 'stage' }), table('ORDERS')),
			edge({ name: 'daily.parquet', domain: 'external' }, table('ORDERS'), 2),
		])).toEqual([
			'1 SALES.PUBLIC.ORDERS_LOAD [stage] -> SALES.PUBLIC.ORDERS',
			'2 "daily.parquet" [external] -> SALES.PUBLIC.ORDERS',
		]);
	});

	// Nothing of a masked object is shown -- not its name, nor the placeholders Snowflake puts in its
	// other fields (`***`), nor its kind -- even if a driver passed them along.
	it('renders a masked object as a placeholder alone', () => {
		expect(renderLineageLines([
			edge(table('SECRET', { masked: true }), table('ORDERS')),
			edge({ database: '***', schema: '***', name: '***', column: '***', domain: 'view', masked: true }, table('ORDERS_V', { column: 'ID', domain: 'view' })),
		])).toEqual([
			'1 <masked> -> SALES.PUBLIC.ORDERS',
			'1 <masked> -> SALES.PUBLIC.ORDERS_V.ID [view]',
		]);
	});

	// The same rule the schema summary follows: a name containing a delimiter is quoted as a JSON
	// string, so the line still splits unambiguously. `<masked>` as a real name is quoted too, so it
	// can't be mistaken for the placeholder.
	it('quotes a name that contains a delimiter', () => {
		expect(renderLineageLines([
			edge(table('Order Details'), table('a.b')),
			edge(table('<masked>'), table('x->y')),
		])).toEqual([
			'1 SALES.PUBLIC."Order Details" -> SALES.PUBLIC."a.b"',
			'1 SALES.PUBLIC."<masked>" -> SALES.PUBLIC."x->y"',
		]);
	});
});
