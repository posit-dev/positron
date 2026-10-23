/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { quoteCompactToken } from './dataConnectionCompactFormat.js';
import { IDataConnectionLineageEdge, IDataConnectionLineageObject } from './interfaces/dataConnectionDriver.js';

// The characters a rendered lineage line uses as delimiters: `.` between path segments, the
// brackets around a domain, the angle brackets of the `<masked>` placeholder and the `->` between
// an edge's ends, and the space that separates a line's parts. The rest of the schema summary's
// set (`,`, `:`, parentheses) is included so a name renders the same way in both payloads. A name
// containing one of these is quoted; see quoteCompactToken.
const LINEAGE_UNSAFE_CHARACTERS = '.,:()[]<> ';

// Stands in for the name of an object the caller may not see. Not a valid unquoted token, so it
// can't be confused with a real object called "masked".
const MASKED_NAME = '<masked>';

// The domains an edge's path already says enough about: a table-like object's path is its
// qualified name, and a column's path ends in the column. Every other domain (a stage, a model, an
// object outside the data source) is tagged on the line, since its path alone reads like a table.
const UNTAGGED_DOMAINS = new Set(['table', 'column']);

/**
 * Renders one end of an edge: the dot-joined path from the database down (to the column, for a
 * column edge), followed by ` [<domain>]` for a domain the path doesn't speak for.
 * @param object The end of the edge to render.
 */
function renderLineageObject(object: IDataConnectionLineageObject): string {
	const quote = (text: string) => quoteCompactToken(text, LINEAGE_UNSAFE_CHARACTERS);

	// Nothing about a masked object is shown, path or kind: a data source may fill its other fields
	// with placeholders (Snowflake uses `***`), which would read as names.
	if (object.masked) {
		return MASKED_NAME;
	}

	const segments: string[] = [];
	if (object.database !== undefined) {
		segments.push(quote(object.database));
	}
	if (object.schema !== undefined) {
		segments.push(quote(object.schema));
	}
	segments.push(object.name === undefined ? MASKED_NAME : quote(object.name));
	if (object.column !== undefined) {
		segments.push(quote(object.column));
	}

	const path = segments.join('.');
	// Compared case-insensitively: the domain is the driver's word, and a data source that reports
	// `TABLE` means the same thing as one that reports `table`.
	return UNTAGGED_DOMAINS.has(object.domain.toLowerCase()) ? path : `${path} [${quote(object.domain)}]`;
}

/**
 * Renders a lineage as one line per edge, in the order given (nearest first, as a driver returns
 * them):
 *
 *     <distance> <source>[ [<domain>]] -> <target>[ [<domain>]]
 *
 * so `1 SALES.PUBLIC.ORDERS -> SALES.PUBLIC.ORDERS_DAILY` says ORDERS_DAILY is built directly from
 * ORDERS, and `2 SALES.RAW.LOAD [stage] -> SALES.PUBLIC.ORDERS` that ORDERS is two hops downstream
 * of a stage. Data always flows left to right, whichever direction was asked for.
 *
 * Deliberately the same shape of payload as the schema summary: a nested JSON edge list costs
 * several times the characters, and the tool that hands this to Assistant truncates long payloads.
 * @param edges The edges to render.
 */
export function renderLineageLines(edges: readonly IDataConnectionLineageEdge[]): string[] {
	return edges.map(edge => `${edge.distance} ${renderLineageObject(edge.source)} -> ${renderLineageObject(edge.target)}`);
}
