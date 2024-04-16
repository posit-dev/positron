/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./addEditRowFilterModalPopup';

// React.
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { ColumnSchema, ColumnDisplayType } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { DropDownListBox, DropDownListBoxEntry } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { RowFilterParameter } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/rowFilterParameter';
import { DropDownColumnSelector } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/dropDownColumnSelector';
import {
	RangeRowFilterDescriptor,
	RowFilterDescriptor,
	RowFilterCondition,
	RowFilterDescriptorComparison,
	RowFilterDescriptorIsBetween,
	RowFilterDescriptorIsEmpty,
	RowFilterDescriptorIsNotBetween,
	RowFilterDescriptorIsNotEmpty,
	SingleValueRowFilterDescriptor,
	RowFilterDescriptorIsNotNull,
	RowFilterDescriptorIsNull,
	RowFilterDescriptorSearch,
} from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilterDescriptor';

/**
 * Validates a row filter value.
 * @param columnSchema The column schema.
 * @param value The row filter value.
 * @returns true if the row filter value is valid; otherwise, false.
 */
const validateRowFilterValue = (columnSchema: ColumnSchema, value: string) => {
	/**
	 * Checks whether the value is a number.
	 * @returns true if the value is a number; otherwise, false.
	 */
	const isNumber = () => /^[-]?\d*\.?\d*$/.test(value);

	/**
	 * Checks whether the value is a boolean.
	 * @returns true if the value is a boolean; otherwise, false.
	 */
	const isBoolean = () => /^(true|false)$/i.test(value);

	/**
	 * Checks whether the value is a date.
	 * @returns true if the value is a date; otherwise, false.
	 */
	const isDate = () => !Number.isNaN(Date.parse(value));

	// Validate the row filter value that was supplied based on the column schema type.
	switch (columnSchema.type_display) {
		// Number.
		case ColumnDisplayType.Number:
			return isNumber();

		// Boolean.
		case ColumnDisplayType.Boolean:
			return isBoolean();

		// String.
		case ColumnDisplayType.String:
			return true;

		// TODO: Add more complete validation.
		case ColumnDisplayType.Date:
		case ColumnDisplayType.Datetime:
		case ColumnDisplayType.Time:
			return isDate();

		// Can't get here.
		default:
			return true;
	}
};

const conditionNumParams = (cond: RowFilterCondition | undefined) => {
	switch (cond) {
		case undefined:
		case RowFilterCondition.CONDITION_IS_EMPTY:
		case RowFilterCondition.CONDITION_IS_NOT_EMPTY:
		case RowFilterCondition.CONDITION_IS_NULL:
		case RowFilterCondition.CONDITION_IS_NOT_NULL:
			return 0;
		case RowFilterCondition.CONDITION_IS_EQUAL_TO:
		case RowFilterCondition.CONDITION_IS_NOT_EQUAL_TO:
		case RowFilterCondition.CONDITION_IS_GREATER_OR_EQUAL:
		case RowFilterCondition.CONDITION_IS_GREATER_THAN:
		case RowFilterCondition.CONDITION_IS_LESS_OR_EQUAL:
		case RowFilterCondition.CONDITION_IS_LESS_THAN:
		case RowFilterCondition.CONDITION_SEARCH_CONTAINS:
		case RowFilterCondition.CONDITION_SEARCH_STARTS_WITH:
		case RowFilterCondition.CONDITION_SEARCH_ENDS_WITH:
		case RowFilterCondition.CONDITION_SEARCH_REGEX_MATCHES:
			return 1;
		case RowFilterCondition.CONDITION_IS_BETWEEN:
		case RowFilterCondition.CONDITION_IS_NOT_BETWEEN:
			return 2;
	}
};

/**
 * Checks whether a RowFilterCondition is a comparison or not.
 * @param cond A row filter condition.
 * @returns Whether the condition is a comparison.
 */
const isSingleParam = (cond: RowFilterCondition | undefined) => {
	if (cond === undefined) {
		return false;
	}
	return conditionNumParams(cond) === 1;
};

/**
 * AddEditRowFilterModalPopupProps interface.
 */
interface AddEditRowFilterModalPopupProps {
	dataExplorerClientInstance: DataExplorerClientInstance;
	renderer: PositronModalReactRenderer;
	anchor: HTMLElement;
	editRowFilter?: RowFilterDescriptor;
	onApplyRowFilter: (rowFilter: RowFilterDescriptor) => void;
}

/**
 * AddEditRowFilterModalPopup component.
 * @param props An AddEditRowFilterModalPopupProps that contains the component properties.
 * @returns The rendered component.
 */
export const AddEditRowFilterModalPopup = (props: AddEditRowFilterModalPopupProps) => {
	// Reference hooks.
	const firstRowFilterParameterRef = useRef<HTMLInputElement>(undefined!);
	const secondRowFilterParameterRef = useRef<HTMLInputElement>(undefined!);

	// State hooks.
	const [selectedColumnSchema, setSelectedColumnSchema] = useState<ColumnSchema | undefined>(
		props.editRowFilter?.columnSchema
	);
	const [selectedCondition, setSelectedCondition] = useState<RowFilterCondition | undefined>(
		props.editRowFilter?.rowFilterCondition
	);
	const [firstRowFilterValue, setFirstRowFilterValue] = useState<string>(() => {
		if (props.editRowFilter instanceof SingleValueRowFilterDescriptor) {
			return props.editRowFilter.value;
		} else if (props.editRowFilter instanceof RangeRowFilterDescriptor) {
			return props.editRowFilter.lowerLimit;
		} else {
			return '';
		}
	});
	const [secondRowFilterValue, setSecondRowFilterValue] = useState<string>(() => {
		if (props.editRowFilter instanceof RangeRowFilterDescriptor) {
			return props.editRowFilter.upperLimit;
		} else {
			return '';
		}
	});
	const [errorText, setErrorText] = useState<string | undefined>(undefined);

	// useEffect for when the selectedCondition changes.
	useEffect(() => {
		// When there is a selected condition, drive focus into the first row filter parameter.
		if (selectedCondition) {
			firstRowFilterParameterRef.current?.focus();
		}
	}, [selectedCondition]);

	/**
	 * Returns the condition entries for the condition drop down list box.
	 * @returns The condition entries for the condition drop down list box.
	 */
	const conditionEntries = () => {
		// If there isn't a column schema, return an empty set of condition entries.
		if (!selectedColumnSchema) {
			return [];
		}

		// Build the condition entries.
		const conditionEntries: DropDownListBoxEntry<RowFilterCondition, void>[] = [];

		// Every type allows is null and is not null conditions.
		conditionEntries.push(new DropDownListBoxItem({
			identifier: RowFilterCondition.CONDITION_IS_NULL,
			title: localize(
				'positron.addEditRowFilter.conditionIsNull',
				"is null"
			),
			value: RowFilterCondition.CONDITION_IS_NULL
		}));
		conditionEntries.push(new DropDownListBoxItem({
			identifier: RowFilterCondition.CONDITION_IS_NOT_NULL,
			title: localize(
				'positron.addEditRowFilter.conditionIsNotNull',
				"is not null"
			),
			value: RowFilterCondition.CONDITION_IS_NOT_NULL
		}));
		conditionEntries.push(new DropDownListBoxSeparator());

		if (selectedColumnSchema.type_display === ColumnDisplayType.String) {
			conditionEntries.push(new DropDownListBoxItem({
				identifier: RowFilterCondition.CONDITION_SEARCH_CONTAINS,
				title: localize(
					'positron.addEditRowFilter.conditionSearchContains',
					"contains"
				),
				value: RowFilterCondition.CONDITION_SEARCH_CONTAINS
			}));
			conditionEntries.push(new DropDownListBoxItem({
				identifier: RowFilterCondition.CONDITION_SEARCH_STARTS_WITH,
				title: localize(
					'positron.addEditRowFilter.conditionSearchStartsWith',
					"starts with"
				),
				value: RowFilterCondition.CONDITION_SEARCH_STARTS_WITH
			}));
			conditionEntries.push(new DropDownListBoxItem({
				identifier: RowFilterCondition.CONDITION_SEARCH_ENDS_WITH,
				title: localize(
					'positron.addEditRowFilter.conditionSearchEndsWith',
					"ends with"
				),
				value: RowFilterCondition.CONDITION_SEARCH_ENDS_WITH
			}));
			conditionEntries.push(new DropDownListBoxItem({
				identifier: RowFilterCondition.CONDITION_SEARCH_REGEX_MATCHES,
				title: localize(
					'positron.addEditRowFilter.conditionSearchRegexMatches',
					"regex matches"
				),
				value: RowFilterCondition.CONDITION_SEARCH_REGEX_MATCHES
			}));

			// String types support is empty, is not empty filter types
			conditionEntries.push(new DropDownListBoxItem({
				identifier: RowFilterCondition.CONDITION_IS_EMPTY,
				title: localize(
					'positron.addEditRowFilter.conditionIsEmpty',
					"is empty"
				),
				value: RowFilterCondition.CONDITION_IS_EMPTY
			}));
			conditionEntries.push(new DropDownListBoxItem({
				identifier: RowFilterCondition.CONDITION_IS_NOT_EMPTY,
				title: localize(
					'positron.addEditRowFilter.conditionIsNotEmpty',
					"is not empty"
				),
				value: RowFilterCondition.CONDITION_IS_NOT_EMPTY
			}));
			conditionEntries.push(new DropDownListBoxSeparator());
		}

		// Add is less than / is greater than conditions.
		switch (selectedColumnSchema.type_display) {
			case ColumnDisplayType.Number:
			case ColumnDisplayType.Date:
			case ColumnDisplayType.Datetime:
			case ColumnDisplayType.Time:
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_LESS_THAN,
					title: localize(
						'positron.addEditRowFilter.conditionIsLessThan',
						"is less than"
					),
					value: RowFilterCondition.CONDITION_IS_LESS_THAN
				}));
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_LESS_OR_EQUAL,
					title: localize(
						'positron.addEditRowFilter.conditionIsLessThanOrEqual',
						"is less than or equal to"
					),
					value: RowFilterCondition.CONDITION_IS_LESS_OR_EQUAL
				}));
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_GREATER_THAN,
					title: localize(
						'positron.addEditRowFilter.conditionIsGreaterThan',
						"is greater than"
					),
					value: RowFilterCondition.CONDITION_IS_GREATER_THAN
				}));
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_GREATER_OR_EQUAL,
					title: localize(
						'positron.addEditRowFilter.conditionIsGreaterThanOrEqual',
						"is greater than or equal to"
					),
					value: RowFilterCondition.CONDITION_IS_GREATER_OR_EQUAL
				}));
				break;
		}

		// Add is equal to, is not equal to conditions.
		switch (selectedColumnSchema.type_display) {
			case ColumnDisplayType.Number:
			case ColumnDisplayType.Boolean:
			case ColumnDisplayType.String:
			case ColumnDisplayType.Date:
			case ColumnDisplayType.Datetime:
			case ColumnDisplayType.Time:
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_EQUAL_TO,
					title: localize(
						'positron.addEditRowFilter.conditionIsEqualTo',
						"is equal to"
					),
					value: RowFilterCondition.CONDITION_IS_EQUAL_TO
				}));
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_NOT_EQUAL_TO,
					title: localize(
						'positron.addEditRowFilter.conditionIsNotEqualTo',
						"is not equal to"
					),
					value: RowFilterCondition.CONDITION_IS_NOT_EQUAL_TO
				}));
				break;
		}

		// Add is between / is not between conditions.
		switch (selectedColumnSchema.type_display) {
			case ColumnDisplayType.Number:
			case ColumnDisplayType.Date:
			case ColumnDisplayType.Datetime:
			case ColumnDisplayType.Time:
				conditionEntries.push(new DropDownListBoxSeparator());
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_BETWEEN,
					title: localize(
						'positron.addEditRowFilter.conditionIsBetween',
						"is between"
					),
					value: RowFilterCondition.CONDITION_IS_BETWEEN
				}));
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_NOT_BETWEEN,
					title: localize(
						'positron.addEditRowFilter.conditionIsNotBetween',
						"is not between"
					),
					value: RowFilterCondition.CONDITION_IS_NOT_BETWEEN
				}));
				break;
		}

		// Return the condition entries.
		return conditionEntries;
	};

	const numParams = conditionNumParams(selectedCondition);

	// Set the first row filter parameter component.
	const firstRowFilterParameterComponent = (() => {
		let placeholderText: string | undefined = undefined;

		switch (numParams) {
			// Do not render the first row filter parameter component.
			case 0:
				return null;

			// Render the first row filter parameter component in single-value mode.
			case 1:
				placeholderText = localize(
					'positron.addEditRowFilter.valuePlaceholder',
					"value"
				);
				break;

			// Render the first row filter parameter component in two-value mode.
			case 2:
				// TODO: handle between vs. other type of conditions with two parameters
				placeholderText = localize(
					'positron.addEditRowFilter.lowerLimitPlaceholder',
					"lower limit"
				);
				break;
		}

		// Return the first row filter parameter component.
		return (
			<RowFilterParameter
				ref={firstRowFilterParameterRef}
				placeholder={placeholderText}
				value={firstRowFilterValue}
				onTextChanged={text => {
					// Set the first row filter value.
					setFirstRowFilterValue(text);

					// Clear the error text.
					setErrorText(undefined);
				}}
			/>
		);
	})();

	// Set the second row filter parameter component.
	const secondRowFilterParameterComponent = (() => {
		let placeholderText: string | undefined = undefined;
		switch (numParams) {
			// Do not render the second row filter parameter component.
			case 0:
			case 1:
				return null;

			// Render the second row filter parameter component in two-value mode.
			case 2:
				// TODO: handle between vs. other type of conditions with two parameters
				placeholderText = localize(
					'positron.addEditRowFilter.upperLimitPlaceholder',
					"upper limit"
				);
				break;
		}

		// Return the second row filter parameter component.
		return (
			<RowFilterParameter
				ref={secondRowFilterParameterRef}
				placeholder={placeholderText}
				value={secondRowFilterValue}
				onTextChanged={text => {
					// Set the second row filter value.
					setSecondRowFilterValue(text);

					// Clear the error text.
					setErrorText(undefined);
				}}
			/>
		);
	})();

	/**
	 * Applies the row filter, if it is valid.
	 */
	const applyRowFilter = () => {
		// Ensure that the user has selected a column schema.
		if (!selectedColumnSchema) {
			setErrorText(localize(
				'positron.addEditRowFilter.pleaseSelectColumn',
				"Please select the column."
			));
			return;
		}

		// Ensure that the user has selected a condition.
		if (!selectedCondition) {
			setErrorText(localize(
				'positron.addEditRowFilter.pleaseSelectCondition',
				"Please select the condition."
			));
			return;
		}

		/**
		 * Validates the first row filter value.
		 * @param rowFilterValue The row filter value to validate.
		 * @returns true if the row filter value is valid; otherwise, false.
		 */
		const validateFirstRowFilterValue = () => {
			// Get the first row filter value.
			const value = firstRowFilterValue.trim();

			// Validate that the first row filter value is not empty.
			if (value.length === 0) {
				// Set the error text.
				switch (selectedCondition) {
					case RowFilterCondition.CONDITION_IS_BETWEEN:
					case RowFilterCondition.CONDITION_IS_NOT_BETWEEN:
						setErrorText(localize(
							'positron.addEditRowFilter.pleaseSupplyLowerLimit',
							"Please supply the lower limit."
						));
						break;

					default:
						setErrorText(localize(
							'positron.addEditRowFilter.pleaseSupplyValue',
							"Please supply the value."
						));
						break;
				}

				// The first row filter value is empty.
				firstRowFilterParameterRef.current?.focus();
				return false;
			}

			// Validate the first row filter value.
			if (!validateRowFilterValue(selectedColumnSchema, value)) {
				// Set the error text.
				switch (selectedCondition) {
					case RowFilterCondition.CONDITION_IS_BETWEEN:
					case RowFilterCondition.CONDITION_IS_NOT_BETWEEN:
						setErrorText(localize(
							'positron.addEditRowFilter.pleaseSupplyValidLowerLimit',
							"Please supply a valid lower limit."
						));
						break;

					default:
						setErrorText(localize(
							'positron.addEditRowFilter.pleaseSupplyValidValue',
							"Please supply a valid value."
						));
						break;
				}

				// The first row filter value is invalid.
				firstRowFilterParameterRef.current?.focus();
				return false;
			}

			// The first row filter value is valid.
			return true;
		};

		/**
		 * Validates the second row filter value.
		 * @param rowFilterValue The row filter value to validate.
		 * @returns true if the row filter value is valid; otherwise, false.
		 */
		const validateSecondRowFilterValue = () => {
			// Get the second row filter value.
			const value = secondRowFilterValue.trim();

			// Validate that the second row filter value is not empty.
			if (value.length === 0) {
				// Set the error text.
				setErrorText(localize(
					'positron.addEditRowFilter.pleaseSupplyUpperLimit',
					"Please supply the upper limit."
				));

				// The second row filter value is empty.
				secondRowFilterParameterRef.current?.focus();
				return false;
			}

			// Validate the second row filter value.
			if (!validateRowFilterValue(selectedColumnSchema, value)) {
				// Set the error text.
				setErrorText(localize(
					'positron.addEditRowFilter.pleaseSupplyValidUpperLimit',
					"Please supply a valid upper limit."
				));

				// The second row filter value is invalid.
				secondRowFilterParameterRef.current?.focus();
				return false;
			}

			// The the second row filter value is valid.
			return true;
		};

		/**
		 * Applies a row filter.
		 * @param rowFilter The row filter to add.
		 */
		const applyRowFilter = (rowFilter: RowFilterDescriptor) => {
			setErrorText(undefined);
			props.renderer.dispose();
			props.onApplyRowFilter(rowFilter);
		};

		// Validate the condition and row filter values. If things are valid, add the row filter.
		switch (selectedCondition) {
			// Apply the is empty row filter.
			case RowFilterCondition.CONDITION_IS_EMPTY: {
				applyRowFilter(new RowFilterDescriptorIsEmpty(selectedColumnSchema));
				break;
			}

			// Apply the is not empty row filter.
			case RowFilterCondition.CONDITION_IS_NOT_EMPTY: {
				applyRowFilter(new RowFilterDescriptorIsNotEmpty(selectedColumnSchema));
				break;
			}

			// Apply the is null row filter.
			case RowFilterCondition.CONDITION_IS_NULL: {
				applyRowFilter(new RowFilterDescriptorIsNull(selectedColumnSchema));
				break;
			}

			// Apply the is not null row filter.
			case RowFilterCondition.CONDITION_IS_NOT_NULL: {
				applyRowFilter(new RowFilterDescriptorIsNotNull(selectedColumnSchema));
				break;
			}

			// Apply comparison row filter.
			case RowFilterCondition.CONDITION_SEARCH_CONTAINS:
			case RowFilterCondition.CONDITION_SEARCH_STARTS_WITH:
			case RowFilterCondition.CONDITION_SEARCH_ENDS_WITH:
			case RowFilterCondition.CONDITION_SEARCH_REGEX_MATCHES: {
				if (!validateFirstRowFilterValue()) {
					return;
				}
				applyRowFilter(new RowFilterDescriptorSearch(
					selectedColumnSchema,
					firstRowFilterValue,
					selectedCondition
				));
				break;
			}

			// Apply comparison row filter.
			case RowFilterCondition.CONDITION_IS_LESS_THAN:
			case RowFilterCondition.CONDITION_IS_LESS_OR_EQUAL:
			case RowFilterCondition.CONDITION_IS_GREATER_THAN:
			case RowFilterCondition.CONDITION_IS_GREATER_OR_EQUAL:
			case RowFilterCondition.CONDITION_IS_EQUAL_TO:
			case RowFilterCondition.CONDITION_IS_NOT_EQUAL_TO: {
				if (!validateFirstRowFilterValue()) {
					return;
				}
				applyRowFilter(new RowFilterDescriptorComparison(
					selectedColumnSchema,
					firstRowFilterValue,
					selectedCondition
				));
				break;
			}

			// Apply the is between row filter.
			case RowFilterCondition.CONDITION_IS_BETWEEN: {
				if (!validateFirstRowFilterValue()) {
					return;
				}
				if (!validateSecondRowFilterValue()) {
					return;
				}
				applyRowFilter(new RowFilterDescriptorIsBetween(
					selectedColumnSchema,
					firstRowFilterValue,
					secondRowFilterValue
				));
				break;
			}

			// Apply the is not between row filter.
			case RowFilterCondition.CONDITION_IS_NOT_BETWEEN: {
				if (!validateFirstRowFilterValue()) {
					return;
				}
				if (!validateSecondRowFilterValue()) {
					return;
				}
				applyRowFilter(new RowFilterDescriptorIsNotBetween(
					selectedColumnSchema,
					firstRowFilterValue,
					secondRowFilterValue
				));
				break;
			}
		}
	};

	/**
	 * Clears the filter values and error text.
	 */
	const clearFilterValuesAndErrorText = () => {
		setFirstRowFilterValue('');
		setSecondRowFilterValue('');
		setErrorText(undefined);
	};

	// Render.
	return (
		<PositronModalPopup
			renderer={props.renderer}
			anchor={props.anchor}
			popupPosition='bottom'
			popupAlignment='left'
			width={275}
			height={'min-content'}
			keyboardNavigation='dialog'
			onAccept={applyRowFilter}
		>
			<div className='add-edit-row-filter-modal-popup-body'>
				<DropDownColumnSelector
					keybindingService={props.renderer.keybindingService}
					layoutService={props.renderer.layoutService}
					dataExplorerClientInstance={props.dataExplorerClientInstance}
					title={(() => localize(
						'positron.addEditRowFilter.selectColumn',
						"Select Column"
					))()}
					selectedColumnSchema={selectedColumnSchema}
					onSelectedColumnSchemaChanged={columnSchema => {
						// Set the selected column schema.
						setSelectedColumnSchema(columnSchema);

						// Reset the selected condition.
						setSelectedCondition(undefined);

						// Clear the filter values and error text.
						clearFilterValuesAndErrorText();
					}}
				/>
				<DropDownListBox
					disabled={selectedColumnSchema === undefined}
					keybindingService={props.renderer.keybindingService}
					layoutService={props.renderer.layoutService}
					title={(() => localize(
						'positron.addEditRowFilter.selectCondition',
						"Select Condition"
					))()}
					entries={conditionEntries()}
					selectedIdentifier={selectedCondition}
					onSelectionChanged={dropDownListBoxItem => {
						const prevSelected = selectedCondition;
						const nextSelected = dropDownListBoxItem.options.identifier;
						// Set the selected condition.
						setSelectedCondition(nextSelected);

						// Clear the filter values and error text.
						if (!(isSingleParam(prevSelected) && isSingleParam(nextSelected))) {
							clearFilterValuesAndErrorText();
						}
					}}
				/>

				{firstRowFilterParameterComponent}
				{secondRowFilterParameterComponent}
				{errorText && (
					<div className='error'>{errorText}</div>
				)}
				<Button
					className='solid button-apply-row-filter'
					onPressed={applyRowFilter}
				>
					{(() => localize(
						'positron.addEditRowFilter.applyFilter',
						"Apply Filter"
					))()}
				</Button>
			</div>
		</PositronModalPopup>
	);
};
