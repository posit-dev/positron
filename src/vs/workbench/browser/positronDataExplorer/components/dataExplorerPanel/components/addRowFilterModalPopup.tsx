/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./addRowFilterModalPopup';

// React.
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { ColumnSchema, ColumnSchemaTypeDisplay } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import { PositronModalPopup } from 'vs/workbench/browser/positronComponents/positronModalPopup/positronModalPopup';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { DropDownListBoxSeparator } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxSeparator';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { DropDownColumnSelector } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/dropDownColumnSelector';

/**
 * Condition enumeration.
 */
export enum Condition {
	CONDITION_IS_EMPTY = 'is-empty',
	CONDITION_IS_NOT_EMPTY = 'is-not-empty',
	CONDITION_IS_LESS_THAN = 'is-less-than',
	CONDITION_IS_GREATER_THAN = 'is-greater-than',
	CONDITION_IS_EXACTLY = 'is-exactly',
	CONDITION_IS_BETWEEN = 'is-between',
	CONDITION_IS_NOT_BETWEEN = 'is-not-between'
}

/**
 * AddRowFilterModalPopupProps interface.
 */
interface AddRowFilterModalPopupProps {
	dataExplorerClientInstance: DataExplorerClientInstance;
	renderer: PositronModalReactRenderer;
	anchor: HTMLElement;
}

/**
 * AddRowFilterModalPopup component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const AddRowFilterModalPopup = (props: AddRowFilterModalPopupProps) => {
	// State hooks.
	const [selectedColumnSchema, setSelectedColumnSchema] =
		useState<ColumnSchema | undefined>(undefined);
	const [selectedCondition, setSelectedCondition] = useState<string | undefined>(undefined);

	// Form useEffect.
	useEffect(() => {

	}, [selectedCondition, selectedColumnSchema]);

	/**
	 * Apple button onPressed handler.
	 */
	const applyButtonPressed = () => {

	};

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
			identifier: Condition.CONDITION_IS_EMPTY,
			title: localize('positron.isEmpty', "is empty")
		}));
		conditionEntries.push(new DropDownListBoxItem({
			identifier: Condition.CONDITION_IS_NOT_EMPTY,
			title: localize('positron.isNotEmpty', "is not empty")
		}));
		conditionEntries.push(new DropDownListBoxSeparator());

		// Add is less than / is greater than conditions.
		switch (selectedColumnSchema.type_display) {
			case ColumnSchemaTypeDisplay.Number:
			case ColumnSchemaTypeDisplay.Date:
			case ColumnSchemaTypeDisplay.Datetime:
			case ColumnSchemaTypeDisplay.Time:
				conditionEntries.push(new DropDownListBoxItem({
					identifier: Condition.CONDITION_IS_LESS_THAN,
					title: localize('positron.isLessThan', "is less than")
				}));
				conditionEntries.push(new DropDownListBoxItem({
					identifier: Condition.CONDITION_IS_GREATER_THAN,
					title: localize('positron.isGreaterThan', "is greater than")
				}));

				break;
		}

		// Add is exactly condition.
		switch (selectedColumnSchema.type_display) {
			case ColumnSchemaTypeDisplay.Number:
			case ColumnSchemaTypeDisplay.Boolean:
			case ColumnSchemaTypeDisplay.String:
			case ColumnSchemaTypeDisplay.Date:
			case ColumnSchemaTypeDisplay.Datetime:
			case ColumnSchemaTypeDisplay.Time:
				conditionEntries.push(new DropDownListBoxItem({
					identifier: Condition.CONDITION_IS_EXACTLY,
					title: localize('positron.isExactly', "is exactly")
				}));
				break;
		}

		// Add is between / is not between conditions.
		switch (selectedColumnSchema.type_display) {
			case ColumnSchemaTypeDisplay.Number:
			case ColumnSchemaTypeDisplay.Date:
			case ColumnSchemaTypeDisplay.Datetime:
			case ColumnSchemaTypeDisplay.Time:
				conditionEntries.push(new DropDownListBoxItem({
					identifier: Condition.CONDITION_IS_BETWEEN,
					title: localize('positron.isBetween', "is between")
				}));
				conditionEntries.push(new DropDownListBoxItem({
					identifier: Condition.CONDITION_IS_NOT_BETWEEN,
					title: localize('positron.isNotBetween', "is not between")
				}));
				break;
		}

		// Return the condition entries.
		return conditionEntries;
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
			<div className='add-row-filter-modal-popup-body'>
				<DropDownColumnSelector
					keybindingService={props.renderer.keybindingService}
					layoutService={props.renderer.layoutService}
					dataExplorerClientInstance={props.dataExplorerClientInstance}
					title={localize('positron.selectColumn', "Select Column")}
					onValueChanged={columnSchema => {
						setSelectedCondition(undefined);
						setSelectedColumnSchema(columnSchema);
					}}
				/>
				<DropDownListBox
					disabled={selectedColumnSchema === undefined}
					keybindingService={props.renderer.keybindingService}
					layoutService={props.renderer.layoutService}
					title={localize('positron.selectCondition', "Select Condition")}
					entries={conditionEntries()}
					selectedIdentifier={selectedCondition}
					onSelectionChanged={identifier => setSelectedCondition(identifier)}
				/>
				<Button className='solid button-apply-filter' onPressed={applyButtonPressed}>
					{localize('positron.ApplyFilter', 'Apply Filter')}
				</Button>
			</div>
		</PositronModalPopup>
	);
};
