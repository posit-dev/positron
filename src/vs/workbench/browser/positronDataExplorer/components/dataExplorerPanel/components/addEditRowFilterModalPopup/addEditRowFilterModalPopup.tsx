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
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { ColumnSchema, ColumnSchemaTypeDisplay } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { RowFilterParameter } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/rowFilterParameter';
import { DropDownColumnSelector } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/dropDownColumnSelector';
import { RowFilter, RowFilterIsBetween, RowFilterIsEmpty, RowFilterIsEqualTo, RowFilterIsGreaterThan, RowFilterIsLessThan, RowFilterIsNotBetween, RowFilterIsNotEmpty } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilter';

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
		case ColumnSchemaTypeDisplay.Number:
			return isNumber();

		// Boolean.
		case ColumnSchemaTypeDisplay.Boolean:
			return isBoolean();

		// String.
		case ColumnSchemaTypeDisplay.String:
			return true;

		// TODO: Add more complete validation.
		case ColumnSchemaTypeDisplay.Date:
		case ColumnSchemaTypeDisplay.Datetime:
		case ColumnSchemaTypeDisplay.Time:
			return isDate();

		// Can't get here.
		default:
			return true;
	}
};

/**
 * RowFilterCondition enumeration.
 */
enum RowFilterCondition {
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
 * AddEditRowFilterModalPopupProps interface.
 */
interface AddEditRowFilterModalPopupProps {
	dataExplorerClientInstance: DataExplorerClientInstance;
	renderer: PositronModalReactRenderer;
	anchor: HTMLElement;
	rowFilter?: RowFilter;
	onApplyRowFilter: (rowFilter: RowFilter) => void;
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
	const [selectedColumnSchema, setSelectedColumnSchema] =
		useState<ColumnSchema | undefined>(undefined);
	const [selectedCondition, setSelectedCondition] = useState<string | undefined>(undefined);
	const [firstRowFilterValue, setFirstRowFilterValue] = useState<string>('');
	const [secondRowFilterValue, setSecondRowFilterValue] = useState<string>('');
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
		const conditionEntries: (DropDownListBoxItem | DropDownListBoxSeparator)[] = [];

		// Every type allows is empty and is not empty conditions.
		conditionEntries.push(new DropDownListBoxItem({
			identifier: RowFilterCondition.CONDITION_IS_EMPTY,
			title: localize(
				'positron.addEditRowFilter.conditionIsEmpty',
				"is empty"
			)
		}));
		conditionEntries.push(new DropDownListBoxItem({
			identifier: RowFilterCondition.CONDITION_IS_NOT_EMPTY,
			title: localize(
				'positron.addEditRowFilter.conditionIsNotEmpty',
				"is not empty"
			)
		}));
		conditionEntries.push(new DropDownListBoxSeparator());

		// Add is less than / is greater than conditions.
		switch (selectedColumnSchema.type_display) {
			case ColumnSchemaTypeDisplay.Number:
			case ColumnSchemaTypeDisplay.Date:
			case ColumnSchemaTypeDisplay.Datetime:
			case ColumnSchemaTypeDisplay.Time:
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_LESS_THAN,
					title: localize(
						'positron.addEditRowFilter.conditionIsLessThan',
						"is less than"
					)
				}));
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_GREATER_THAN,
					title: localize(
						'positron.addEditRowFilter.conditionIsGreaterThan',
						"is greater than"
					)
				}));
				break;
		}

		// Add is equal to condition.
		switch (selectedColumnSchema.type_display) {
			case ColumnSchemaTypeDisplay.Number:
			case ColumnSchemaTypeDisplay.Boolean:
			case ColumnSchemaTypeDisplay.String:
			case ColumnSchemaTypeDisplay.Date:
			case ColumnSchemaTypeDisplay.Datetime:
			case ColumnSchemaTypeDisplay.Time:
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_EQUAL_TO,
					title: localize(
						'positron.addEditRowFilter.conditionIsEqualTo',
						"is equal to"
					)
				}));
				break;
		}

		// Add is between / is not between conditions.
		switch (selectedColumnSchema.type_display) {
			case ColumnSchemaTypeDisplay.Number:
			case ColumnSchemaTypeDisplay.Date:
			case ColumnSchemaTypeDisplay.Datetime:
			case ColumnSchemaTypeDisplay.Time:
				conditionEntries.push(new DropDownListBoxSeparator());
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_BETWEEN,
					title: localize(
						'positron.addEditRowFilter.conditionIsBetween',
						"is between"
					)
				}));
				conditionEntries.push(new DropDownListBoxItem({
					identifier: RowFilterCondition.CONDITION_IS_NOT_BETWEEN,
					title: localize(
						'positron.addEditRowFilter.conditionIsNotBetween',
						"is not between"
					)
				}));
				break;
		}

		// Return the condition entries.
		return conditionEntries;
	};

	// Set the first row filter parameter component.
	const firstRowFilterParameterComponent = (() => {
		let placeholderText: string | undefined = undefined;
		switch (selectedCondition) {
			// Do not render the first row filter parameter component.
			case undefined:
			case RowFilterCondition.CONDITION_IS_EMPTY:
			case RowFilterCondition.CONDITION_IS_NOT_EMPTY:
				return null;

			// Render the first row filter parameter component in single-value mode.
			case RowFilterCondition.CONDITION_IS_LESS_THAN:
			case RowFilterCondition.CONDITION_IS_GREATER_THAN:
			case RowFilterCondition.CONDITION_IS_EQUAL_TO:
				placeholderText = localize(
					'positron.addEditRowFilter.valuePlaceholder',
					"value"
				);
				break;

			// Render the first row filter parameter component in two-value mode.
			case RowFilterCondition.CONDITION_IS_BETWEEN:
			case RowFilterCondition.CONDITION_IS_NOT_BETWEEN:
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
		switch (selectedCondition) {
			// Do not render the second row filter parameter component.
			case undefined:
			case RowFilterCondition.CONDITION_IS_EMPTY:
			case RowFilterCondition.CONDITION_IS_NOT_EMPTY:
			case RowFilterCondition.CONDITION_IS_LESS_THAN:
			case RowFilterCondition.CONDITION_IS_GREATER_THAN:
			case RowFilterCondition.CONDITION_IS_EQUAL_TO:
				return null;

			// Render the second row filter parameter component in two-value mode.
			case RowFilterCondition.CONDITION_IS_BETWEEN:
			case RowFilterCondition.CONDITION_IS_NOT_BETWEEN:
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
	 * Apply row filter button onPressed handler.
	 */
	const applyRowFilterButtonPressed = () => {
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
		const applyRowFilter = (rowFilter: RowFilter) => {
			setErrorText(undefined);
			props.renderer.dispose();
			props.onApplyRowFilter(rowFilter);
		};

		// Validate the condition and row filter values. If things are valid, add the row filter.
		switch (selectedCondition) {
			// Apply the is empty row filter.
			case RowFilterCondition.CONDITION_IS_EMPTY: {
				applyRowFilter(new RowFilterIsEmpty(selectedColumnSchema));
				break;
			}

			// Apply the is not empty row filter.
			case RowFilterCondition.CONDITION_IS_NOT_EMPTY: {
				applyRowFilter(new RowFilterIsNotEmpty(selectedColumnSchema));
				break;
			}

			// Apply the is less than row filter.
			case RowFilterCondition.CONDITION_IS_LESS_THAN: {
				if (!validateFirstRowFilterValue()) {
					return;
				}
				applyRowFilter(new RowFilterIsLessThan(selectedColumnSchema, firstRowFilterValue));
				break;
			}

			// Apply the is greater than row filter.
			case RowFilterCondition.CONDITION_IS_GREATER_THAN: {
				if (!validateFirstRowFilterValue()) {
					return;
				}
				applyRowFilter(new RowFilterIsGreaterThan(selectedColumnSchema, firstRowFilterValue));
				break;
			}

			// Apply the is equal to row filter.
			case RowFilterCondition.CONDITION_IS_EQUAL_TO: {
				if (!validateFirstRowFilterValue()) {
					return;
				}
				applyRowFilter(new RowFilterIsEqualTo(selectedColumnSchema, firstRowFilterValue));
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
				applyRowFilter(new RowFilterIsBetween(
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
				applyRowFilter(new RowFilterIsNotBetween(
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
		>
			<div className='add-edit-row-filter-modal-popup-body'>
				<DropDownColumnSelector
					keybindingService={props.renderer.keybindingService}
					layoutService={props.renderer.layoutService}
					dataExplorerClientInstance={props.dataExplorerClientInstance}
					title={localize(
						'positron.addEditRowFilter.selectColumn',
						"Select Column"
					)}
					onValueChanged={columnSchema => {
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
					title={localize(
						'positron.addEditRowFilter.selectCondition',
						"Select Condition"
					)}
					entries={conditionEntries()}
					selectedIdentifier={selectedCondition}
					onSelectionChanged={identifier => {
						// Set the selected condition.
						setSelectedCondition(identifier);

						// Clear the filter values and error text.
						clearFilterValuesAndErrorText();
					}}
				/>
				{firstRowFilterParameterComponent}
				{secondRowFilterParameterComponent}
				{errorText && (
					<div className='error'>{errorText}</div>
				)}
				<Button
					className='solid button-apply-row-filter'
					onPressed={applyRowFilterButtonPressed}
				>
					{localize(
						'positron.addEditRowFilter.applyFilter',
						"Apply Filter"
					)}
				</Button>
			</div>
		</PositronModalPopup>
	);
};
