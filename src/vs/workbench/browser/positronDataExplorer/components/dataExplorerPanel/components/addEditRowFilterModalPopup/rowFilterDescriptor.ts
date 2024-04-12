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
	CONDITION_IS_NULL = 'is-null',
	CONDITION_IS_NOT_NULL = 'is-not-null',

	// Conditions with one parameter.
	CONDITION_IS_LESS_THAN = 'is-less-than',
	CONDITION_IS_LESS_OR_EQUAL = 'is-less-than-or-equal-to',
	CONDITION_IS_GREATER_THAN = 'is-greater-than',
	CONDITION_IS_GREATER_OR_EQUAL = 'is-greater-than-or-equal-to',
	CONDITION_IS_EQUAL_TO = 'is-equal-to',

	// Conditions with two parameters.
	CONDITION_IS_BETWEEN = 'is-between',
	CONDITION_IS_NOT_BETWEEN = 'is-not-between'
}

/**
 * BaseRowFilterDescriptor class.
 */
abstract class BaseRowFilterDescriptor {
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
 * RowFilterDescriptorIsEmpty class.
 */
export class RowFilterDescriptorIsEmpty extends BaseRowFilterDescriptor {
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
 * RowFilterDescriptorIsNotEmpty class.
 */
export class RowFilterDescriptorIsNotEmpty extends BaseRowFilterDescriptor {
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
 * RowFilterDescriptorIsNull class.
 */
export class RowFilterDescriptorIsNull extends BaseRowFilterDescriptor {
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
		return RowFilterCondition.CONDITION_IS_NULL;
	}
}

/**
 * RowFilterDescriptorIsNotEmpty class.
 */
export class RowFilterDescriptorIsNotNull extends BaseRowFilterDescriptor {
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
		return RowFilterCondition.CONDITION_IS_NOT_NULL;
	}
}

/**
 * SingleValueRowFilterDescriptor class.
 */
export abstract class SingleValueRowFilterDescriptor extends BaseRowFilterDescriptor {
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
 * RowFilterDescriptorIsLessThan class.
 */
export class RowFilterDescriptorIsLessThan extends SingleValueRowFilterDescriptor {
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
 * RowFilterDescriptorIsLessOrEqual class.
 */
export class RowFilterDescriptorIsLessOrEqual extends SingleValueRowFilterDescriptor {
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
		return RowFilterCondition.CONDITION_IS_LESS_OR_EQUAL;
	}
}

/**
 * RowFilterDescriptorIsGreaterThan class.
 */
export class RowFilterDescriptorIsGreaterThan extends SingleValueRowFilterDescriptor {
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
 * RowFilterDescriptorIsGreaterOrEqual class.
 */
export class RowFilterDescriptorIsGreaterOrEqual extends SingleValueRowFilterDescriptor {
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
		return RowFilterCondition.CONDITION_IS_GREATER_OR_EQUAL;
	}
}

/**
 * RowFilterDescriptorIsEqualTo class.
 */
export class RowFilterDescriptorIsEqualTo extends SingleValueRowFilterDescriptor {
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
 * RangeRowFilterDescriptor class.
 */
export abstract class RangeRowFilterDescriptor extends BaseRowFilterDescriptor {
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
 * RowFilterDescriptorIsBetween class.
 */
export class RowFilterDescriptorIsBetween extends RangeRowFilterDescriptor {
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
 * RowFilterDescriptorIsNotBetween class.
 */
export class RowFilterDescriptorIsNotBetween extends RangeRowFilterDescriptor {
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
 * RowFilterDescriptor type.
 */
export type RowFilterDescriptor =
	RowFilterDescriptorIsEmpty |
	RowFilterDescriptorIsNotEmpty |
	RowFilterDescriptorIsNull |
	RowFilterDescriptorIsNotNull |
	RowFilterDescriptorIsLessThan |
	RowFilterDescriptorIsLessOrEqual |
	RowFilterDescriptorIsGreaterThan |
	RowFilterDescriptorIsGreaterOrEqual |
	RowFilterDescriptorIsEqualTo |
	RowFilterDescriptorIsBetween |
	RowFilterDescriptorIsNotBetween;
