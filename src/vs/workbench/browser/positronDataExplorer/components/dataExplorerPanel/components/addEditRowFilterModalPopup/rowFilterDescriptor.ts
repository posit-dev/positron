/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import {
	ColumnSchema,
	CompareFilterParamsOp,
	RowFilter,
	RowFilterCondition,
	RowFilterType,
	SearchFilterType
} from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * RowFilterDescrType enumeration.
 */
export enum RowFilterDescrType {
	// Filters with no parameters.
	IS_EMPTY = 'is-empty',
	IS_NOT_EMPTY = 'is-not-empty',
	IS_NULL = 'is-null',
	IS_NOT_NULL = 'is-not-null',

	// Filters with one parameter.
	IS_LESS_THAN = 'is-less-than',
	IS_LESS_OR_EQUAL = 'is-less-than-or-equal-to',
	IS_GREATER_THAN = 'is-greater-than',
	IS_GREATER_OR_EQUAL = 'is-greater-than-or-equal-to',
	IS_EQUAL_TO = 'is-equal-to',
	IS_NOT_EQUAL_TO = 'is-not-equal-to',
	SEARCH_CONTAINS = 'search-contains',
	SEARCH_STARTS_WITH = 'search-starts-with',
	SEARCH_ENDS_WITH = 'search-ends-with',
	SEARCH_REGEX_MATCHES = 'search-regex',

	// Filters with two parameters.
	IS_BETWEEN = 'is-between',
	IS_NOT_BETWEEN = 'is-not-between'
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
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	constructor(public readonly columnSchema: ColumnSchema,
		public readonly isValid: boolean | undefined
	) {
		this.identifier = generateUuid();
		this.isValid = isValid;
	}

	/**
	 * Gets the row filter UI type.
	 */
	abstract get descrType(): RowFilterDescrType;

	abstract get backendFilter(): RowFilter;

	protected _sharedBackendParams() {
		return {
			filter_id: this.identifier,
			column_schema: this.columnSchema,
			condition: RowFilterCondition.And
		};
	}
}

/**
 * RowFilterDescriptorIsEmpty class.
 */
export class RowFilterDescriptorIsEmpty extends BaseRowFilterDescriptor {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	constructor(columnSchema: ColumnSchema,
		isValid = true
	) {
		super(columnSchema, isValid);
	}

	/**
	 * Gets the row filter condition.
	 */
	get descrType() {
		return RowFilterDescrType.IS_EMPTY;
	}

	/**
	 * Get the backend OpenRPC type.
	 */
	get backendFilter() {
		return {
			filter_type: RowFilterType.IsEmpty,
			...this._sharedBackendParams()
		};
	}
}

/**
 * RowFilterDescriptorIsNotEmpty class.
 */
export class RowFilterDescriptorIsNotEmpty extends BaseRowFilterDescriptor {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	constructor(columnSchema: ColumnSchema,
		isValid = true
	) {
		super(columnSchema, isValid);
	}

	/**
	 * Gets the row filter condition.
	 */
	get descrType() {
		return RowFilterDescrType.IS_NOT_EMPTY;
	}

	/**
	 * Get the backend OpenRPC type.
	 */
	get backendFilter() {
		return {
			filter_type: RowFilterType.NotEmpty,
			...this._sharedBackendParams()
		};
	}
}

/**
 * RowFilterDescriptorIsNull class.
 */
export class RowFilterDescriptorIsNull extends BaseRowFilterDescriptor {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	constructor(columnSchema: ColumnSchema,
		isValid = true
	) {
		super(columnSchema, isValid);
	}

	/**
	 * Gets the row filter condition.
	 */
	get descrType() {
		return RowFilterDescrType.IS_NULL;
	}

	/**
	 * Get the backend OpenRPC type.
	 */
	get backendFilter() {
		return {
			filter_type: RowFilterType.IsNull,
			...this._sharedBackendParams()
		};
	}
}

/**
 * RowFilterDescriptorIsNotEmpty class.
 */
export class RowFilterDescriptorIsNotNull extends BaseRowFilterDescriptor {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	constructor(columnSchema: ColumnSchema,
		isValid = true
	) {
		super(columnSchema, isValid);
	}

	/**
	 * Gets the row filter condition.
	 */
	get descrType() {
		return RowFilterDescrType.IS_NOT_NULL;
	}

	/**
	 * Get the backend OpenRPC type.
	 */
	get backendFilter() {
		return {
			filter_type: RowFilterType.NotNull,
			...this._sharedBackendParams()
		};
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
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	constructor(columnSchema: ColumnSchema, public readonly value: string,
		isValid = true
	) {
		super(columnSchema, isValid);
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
	 * @param descrType The filter condition.
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	_descrType: RowFilterDescrType;

	constructor(columnSchema: ColumnSchema, value: string, descrType: RowFilterDescrType,
		isValid = true
	) {
		super(columnSchema, value, isValid);
		this._descrType = descrType;
	}

	get operatorText() {
		switch (this.descrType) {
			case RowFilterDescrType.IS_EQUAL_TO:
				return '=';
			case RowFilterDescrType.IS_GREATER_OR_EQUAL:
				return '>=';
			case RowFilterDescrType.IS_GREATER_THAN:
				return '>';
			case RowFilterDescrType.IS_LESS_OR_EQUAL:
				return '<=';
			case RowFilterDescrType.IS_LESS_THAN:
				return '<';
			case RowFilterDescrType.IS_NOT_EQUAL_TO:
				return '!=';
			default:
				return '';
		}
	}

	/**
	 * Get the backend OpenRPC type.
	 */
	get backendFilter() {
		const getCompareOp = () => {
			switch (this.descrType) {
				case RowFilterDescrType.IS_EQUAL_TO:
					return CompareFilterParamsOp.Eq;
				case RowFilterDescrType.IS_GREATER_OR_EQUAL:
					return CompareFilterParamsOp.GtEq;
				case RowFilterDescrType.IS_GREATER_THAN:
					return CompareFilterParamsOp.Gt;
				case RowFilterDescrType.IS_LESS_OR_EQUAL:
					return CompareFilterParamsOp.LtEq;
				case RowFilterDescrType.IS_LESS_THAN:
					return CompareFilterParamsOp.Lt;
				default:
					// IS_NOT_EQUAL_TO
					return CompareFilterParamsOp.NotEq;
			}
		};
		return {
			filter_type: RowFilterType.Compare,
			compare_params: {
				op: getCompareOp(),
				value: this.value
			},
			...this._sharedBackendParams()
		};
	}

	/**
	 * Gets the row filter condition.
	 */
	get descrType() {
		return this._descrType;
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
	 * @param descrType The filter condition.
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	_descrType: RowFilterDescrType;

	constructor(columnSchema: ColumnSchema, value: string, descrType: RowFilterDescrType,
		isValid = true
	) {
		super(columnSchema, value, isValid);
		this._descrType = descrType;
	}

	get operatorText() {
		switch (this._descrType) {
			case RowFilterDescrType.SEARCH_CONTAINS:
				return 'contains';
			case RowFilterDescrType.SEARCH_STARTS_WITH:
				return 'starts with';
			case RowFilterDescrType.SEARCH_ENDS_WITH:
				return 'ends with';
			default:
				// SEARCH_REGEX_MATCHES
				return 'matches regex';
		}
	}


	/**
	 * Gets the row filter condition.
	 */
	get descrType() {
		return this._descrType;
	}

	/**
	 * Get the backend OpenRPC type.
	 */
	get backendFilter() {
		const getSearchOp = () => {
			switch (this._descrType) {
				case RowFilterDescrType.SEARCH_CONTAINS:
					return SearchFilterType.Contains;
				case RowFilterDescrType.SEARCH_STARTS_WITH:
					return SearchFilterType.StartsWith;
				case RowFilterDescrType.SEARCH_ENDS_WITH:
					return SearchFilterType.EndsWith;
				default:
					// SEARCH_REGEX_MATCHES
					return SearchFilterType.RegexMatch;
			}
		};

		return {
			filter_type: RowFilterType.Search,
			search_params: {
				search_type: getSearchOp(),
				term: this.value,
				case_sensitive: false
			},
			...this._sharedBackendParams()
		};
	}
}

/**
 * RowFilterDescriptorSetMembership class.
 */
export class RowFilterDescriptorSetMembership extends BaseRowFilterDescriptor {
	/**
	 * Constructor.
	 * @param columnSchema The column schema.
	 * @param values The values to include.
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	values: Array<string>;

	constructor(columnSchema: ColumnSchema, values: Array<string>, isValid = true
	) {
		super(columnSchema, isValid);
		this.values = values;
	}

	/**
	 * Gets the row filter condition.
	 */
	get descrType() {
		// TODO: Add case and implement this
		return RowFilterDescrType.IS_NULL;
	}

	get operatorText() {
		return 'includes';
	}

	/**
	 * Get the backend OpenRPC type.
	 */
	get backendFilter() {
		return {
			filter_type: RowFilterType.SetMembership,
			set_membership_filter_params: {
				values: this.values,
				inclusive: true
			},
			...this._sharedBackendParams()
		};
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
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	constructor(
		columnSchema: ColumnSchema,
		public readonly lowerLimit: string,
		public readonly upperLimit: string,
		isValid = true
	) {
		super(columnSchema, isValid);
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
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	constructor(columnSchema: ColumnSchema, lowerLimit: string, upperLimit: string,
		isValid = true
	) {
		super(columnSchema, lowerLimit, upperLimit, isValid);
	}

	/**
	 * Gets the row filter condition.
	 */
	get descrType() {
		return RowFilterDescrType.IS_BETWEEN;
	}

	/**
	 * Get the backend OpenRPC type.
	 */
	get backendFilter() {
		return {
			filter_type: RowFilterType.Between,
			between_params: {
				left_value: this.lowerLimit,
				right_value: this.upperLimit
			},
			...this._sharedBackendParams()
		};
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
	 * @param isValid Flag if the filter is valid or invalid and ignored by backend.
	 */
	constructor(columnSchema: ColumnSchema, lowerLimit: string, upperLimit: string, isValid = true) {
		super(columnSchema, lowerLimit, upperLimit);
	}

	/**
	 * Gets the row filter condition.
	 */
	get descrType() {
		return RowFilterDescrType.IS_NOT_BETWEEN;
	}

	/**
	 * Get the backend OpenRPC type.
	 */
	get backendFilter() {
		return {
			filter_type: RowFilterType.NotBetween,
			between_params: {
				left_value: this.lowerLimit,
				right_value: this.upperLimit
			},
			...this._sharedBackendParams()
		};
	}
}

function getCompareDescrType(op: CompareFilterParamsOp) {
	switch (op) {
		case CompareFilterParamsOp.Eq:
			return RowFilterDescrType.IS_EQUAL_TO;
		case CompareFilterParamsOp.NotEq:
			return RowFilterDescrType.IS_NOT_EQUAL_TO;
		case CompareFilterParamsOp.Lt:
			return RowFilterDescrType.IS_LESS_THAN;
		case CompareFilterParamsOp.LtEq:
			return RowFilterDescrType.IS_LESS_OR_EQUAL;
		case CompareFilterParamsOp.Gt:
			return RowFilterDescrType.IS_GREATER_THAN;
		case CompareFilterParamsOp.GtEq:
			return RowFilterDescrType.IS_GREATER_OR_EQUAL;
	}
}

function getSearchDescrType(searchType: SearchFilterType) {
	switch (searchType) {
		case SearchFilterType.Contains:
			return RowFilterDescrType.SEARCH_CONTAINS;
		case SearchFilterType.EndsWith:
			return RowFilterDescrType.SEARCH_ENDS_WITH;
		case SearchFilterType.StartsWith:
			return RowFilterDescrType.SEARCH_STARTS_WITH;
		case SearchFilterType.RegexMatch:
			return RowFilterDescrType.SEARCH_REGEX_MATCHES;
	}
}

export function getRowFilterDescriptor(backendFilter: RowFilter) {
	switch (backendFilter.filter_type) {
		case RowFilterType.Compare: {
			const params = backendFilter.compare_params!;
			return new RowFilterDescriptorComparison(backendFilter.column_schema,
				params.value, getCompareDescrType(params.op),
				backendFilter.is_valid
			);
		}
		case RowFilterType.Between: {
			const params = backendFilter.between_params!;
			return new RowFilterDescriptorIsBetween(backendFilter.column_schema,
				params.left_value, params.right_value, backendFilter.is_valid
			);
		}
		case RowFilterType.NotBetween: {
			const params = backendFilter.between_params!;
			return new RowFilterDescriptorIsNotBetween(backendFilter.column_schema,
				params.left_value, params.right_value, backendFilter.is_valid
			);
		}
		case RowFilterType.IsEmpty:
			return new RowFilterDescriptorIsEmpty(backendFilter.column_schema,
				backendFilter.is_valid
			);
		case RowFilterType.NotEmpty:
			return new RowFilterDescriptorIsNotEmpty(backendFilter.column_schema,
				backendFilter.is_valid
			);
		case RowFilterType.IsNull:
			return new RowFilterDescriptorIsNull(backendFilter.column_schema,
				backendFilter.is_valid
			);
		case RowFilterType.NotNull:
			return new RowFilterDescriptorIsNotNull(backendFilter.column_schema,
				backendFilter.is_valid
			);
		case RowFilterType.Search: {
			const params = backendFilter.search_params!;
			return new RowFilterDescriptorSearch(backendFilter.column_schema,
				params.term, getSearchDescrType(params.search_type),
				backendFilter.is_valid);
		}
		case RowFilterType.SetMembership: {
			const params = backendFilter.set_membership_params!;
			return new RowFilterDescriptorSetMembership(backendFilter.column_schema,
				params.values, backendFilter.is_valid
			);
		}
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
	RowFilterDescriptorIsNotBetween |
	RowFilterDescriptorSearch;
