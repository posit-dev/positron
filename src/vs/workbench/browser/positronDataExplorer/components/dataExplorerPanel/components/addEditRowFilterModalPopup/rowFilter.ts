/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * BaseRowFilter class.
 */
class BaseRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 */
	constructor(public readonly columnSchema: ColumnSchema) { }
}

/**
 * RowFilterIsEmpty class.
 */
export class RowFilterIsEmpty extends BaseRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 */
	constructor(columnSchema: ColumnSchema) {
		super(columnSchema);
	}
}

/**
 * RowFilterIsNotEmpty class.
 */
export class RowFilterIsNotEmpty extends BaseRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 */
	constructor(columnSchema: ColumnSchema) {
		super(columnSchema);
	}
}

/**
 * SingleValueRowFilter class.
 */
class SingleValueRowFilter extends BaseRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param value The value.
	 */
	constructor(columnSchema: ColumnSchema, public readonly value: string) {
		super(columnSchema);
	}
}

/**
 * RowFilterIsLessThan row filter.
 */
export class RowFilterIsLessThan extends SingleValueRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param value The value.
	 */
	constructor(columnSchema: ColumnSchema, value: string) {
		super(columnSchema, value);
	}
}

/**
 * RowFilterIsGreaterThan row filter.
 */
export class RowFilterIsGreaterThan extends SingleValueRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param value The value.
	 */
	constructor(columnSchema: ColumnSchema, value: string) {
		super(columnSchema, value);
	}
}

/**
 * RowFilterIsEqualTo row filter.
 */
export class RowFilterIsEqualTo extends SingleValueRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param value The value.
	 */
	constructor(columnSchema: ColumnSchema, value: string) {
		super(columnSchema, value);
	}
}

/**
 * RangeRowFilter class.
 */
class RangeRowFilter extends BaseRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param lowerLimit The lower limit.
	 * @param upperLimit The lower limit.
	 */
	constructor(
		columnSchema: ColumnSchema,
		public readonly lowerLimit: string,
		public readonly upperLimit: string
	) {
		super(columnSchema);
	}
}

/**
 * RowFilterIsBetween row filter.
 */
export class RowFilterIsBetween extends RangeRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param lowerLimit The lower limit.
	 * @param upperLimit The lower limit.
	 */
	constructor(columnSchema: ColumnSchema, lowerLimit: string, upperLimit: string) {
		super(columnSchema, lowerLimit, upperLimit);
	}
}

/**
 * RowFilterIsNotBetween row filter.
 */
export class RowFilterIsNotBetween extends RangeRowFilter {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param lowerLimit The lower limit.
	 * @param upperLimit The lower limit.
	 */
	constructor(columnSchema: ColumnSchema, lowerLimit: string, upperLimit: string) {
		super(columnSchema, lowerLimit, upperLimit);
	}
}

/**
 * RowFilter type.
 */
export type RowFilter =
	RowFilterIsEmpty |
	RowFilterIsNotEmpty |
	RowFilterIsLessThan |
	RowFilterIsGreaterThan |
	RowFilterIsBetween |
	RowFilterIsNotBetween;
