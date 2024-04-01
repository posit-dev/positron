/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * RowFilterCondition enumeration.
 */
export enum RowFilterCondition {
	// Conditions with no parameters.
	CONDITION_IS_EMPTY = 'is-empty',
	CONDITION_IS_NOT_EMPTY = 'is-not-empty',

	// Conditions with one parameter.
	CONDITION_IS_LESS_THAN = 'is-less-than',
	CONDITION_IS_GREATER_THAN = 'is-greater-than',
	CONDITION_IS_EQUAL_TO = 'is-equal-to',

	// Conditions with two parameters.
	CONDITION_IS_BETWEEN = 'is-between',
	CONDITION_IS_NOT_BETWEEN = 'is-not-between'
}

/**
 * BaseRowFilter class.
 */
abstract class BaseRowFilter {
	/**
	 * Gets the identifier.
	 */
	readonly identifier;

	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 */
	constructor(public readonly columnSchema: ColumnSchema) {
		this.identifier = generateUuid();
	}

	/**
	 * Gets the row filter condition.
	 */
	abstract get rowFilterCondition(): RowFilterCondition;
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

	/**
	 * Gets the row filter condition.
	 */
	get rowFilterCondition() {
		return RowFilterCondition.CONDITION_IS_EMPTY;
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

	/**
	 * Gets the row filter condition.
	 */
	get rowFilterCondition() {
		return RowFilterCondition.CONDITION_IS_NOT_EMPTY;
	}
}

/**
 * SingleValueRowFilter class.
 */
export abstract class SingleValueRowFilter extends BaseRowFilter {
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

	/**
	 * Gets the row filter condition.
	 */
	get rowFilterCondition() {
		return RowFilterCondition.CONDITION_IS_LESS_THAN;
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

	/**
	 * Gets the row filter condition.
	 */
	get rowFilterCondition() {
		return RowFilterCondition.CONDITION_IS_GREATER_THAN;
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

	/**
	 * Gets the row filter condition.
	 */
	get rowFilterCondition() {
		return RowFilterCondition.CONDITION_IS_EQUAL_TO;
	}
}

/**
 * RangeRowFilter class.
 */
export abstract class RangeRowFilter extends BaseRowFilter {
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

	/**
	 * Gets the row filter condition.
	 */
	get rowFilterCondition() {
		return RowFilterCondition.CONDITION_IS_BETWEEN;
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

	/**
	 * Gets the row filter condition.
	 */
	get rowFilterCondition() {
		return RowFilterCondition.CONDITION_IS_NOT_BETWEEN;
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
