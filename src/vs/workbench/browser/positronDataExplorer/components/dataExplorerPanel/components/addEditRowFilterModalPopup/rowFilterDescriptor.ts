/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { ColumnSchema, CompareFilterParamsOp, SearchFilterType } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

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
	CONDITION_IS_NOT_EQUAL_TO = 'is-not-equal-to',
	CONDITION_SEARCH_CONTAINS = 'search-contains',
	CONDITION_SEARCH_STARTS_WITH = 'search-starts-with',
	CONDITION_SEARCH_ENDS_WITH = 'search-ends-width',
	CONDITION_SEARCH_REGEX_MATCHES = 'search-regex',

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
 * RowFilterDescriptorComparison class.
 */
export class RowFilterDescriptorComparison extends SingleValueRowFilterDescriptor {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param value The value.
	 * @param condition The filter condition.
	 */
	condition: RowFilterCondition;

	constructor(columnSchema: ColumnSchema, value: string, condition: RowFilterCondition) {
		super(columnSchema, value);
		this.condition = condition;
	}

	get operatorText() {
		switch (this.condition) {
			case RowFilterCondition.CONDITION_IS_EQUAL_TO:
				return '=';
			case RowFilterCondition.CONDITION_IS_GREATER_OR_EQUAL:
				return '>=';
			case RowFilterCondition.CONDITION_IS_GREATER_THAN:
				return '>';
			case RowFilterCondition.CONDITION_IS_LESS_OR_EQUAL:
				return '<=';
			case RowFilterCondition.CONDITION_IS_LESS_THAN:
				return '<';
			case RowFilterCondition.CONDITION_IS_NOT_EQUAL_TO:
				return '!=';
			default:
				return '';
		}
	}

	get compareFilterOp() {
		switch (this.condition) {
			case RowFilterCondition.CONDITION_IS_EQUAL_TO:
				return CompareFilterParamsOp.Eq;
			case RowFilterCondition.CONDITION_IS_GREATER_OR_EQUAL:
				return CompareFilterParamsOp.GtEq;
			case RowFilterCondition.CONDITION_IS_GREATER_THAN:
				return CompareFilterParamsOp.Gt;
			case RowFilterCondition.CONDITION_IS_LESS_OR_EQUAL:
				return CompareFilterParamsOp.LtEq;
			case RowFilterCondition.CONDITION_IS_LESS_THAN:
				return CompareFilterParamsOp.Lt;
			default:
				// CONDITION_IS_NOT_EQUAL_TO
				return CompareFilterParamsOp.NotEq;
		}
	}

	/**
	 * Gets the row filter condition.
	 */
	get rowFilterCondition() {
		return this.condition;
	}
}

/**
 * RowFilterDescriptorSearch class.
 */
export class RowFilterDescriptorSearch extends SingleValueRowFilterDescriptor {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param value The value.
	 * @param condition The filter condition.
	 */
	condition: RowFilterCondition;

	constructor(columnSchema: ColumnSchema, value: string, condition: RowFilterCondition) {
		super(columnSchema, value);
		this.condition = condition;
	}

	get operatorText() {
		switch (this.condition) {
			case RowFilterCondition.CONDITION_SEARCH_CONTAINS:
				return 'contains';
			case RowFilterCondition.CONDITION_SEARCH_STARTS_WITH:
				return 'starts with';
			case RowFilterCondition.CONDITION_SEARCH_ENDS_WITH:
				return 'ends with';
			default:
				// CONDITION_SEARCH_REGEX_MATCHES
				return 'matches regex';
		}
	}

	get searchOp() {
		switch (this.condition) {
			case RowFilterCondition.CONDITION_SEARCH_CONTAINS:
				return SearchFilterType.Contains;
			case RowFilterCondition.CONDITION_SEARCH_STARTS_WITH:
				return SearchFilterType.StartsWith;
			case RowFilterCondition.CONDITION_SEARCH_ENDS_WITH:
				return SearchFilterType.EndsWith;
			default:
				// CONDITION_SEARCH_REGEX_MATCHES
				return SearchFilterType.RegexMatch;
		}
	}

	/**
	 * Gets the row filter condition.
	 */
	get rowFilterCondition() {
		return this.condition;
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
	RowFilterDescriptorComparison |
	RowFilterDescriptorIsEmpty |
	RowFilterDescriptorIsNotEmpty |
	RowFilterDescriptorIsNull |
	RowFilterDescriptorIsNotNull |
	RowFilterDescriptorIsBetween |
	RowFilterDescriptorIsNotBetween;
