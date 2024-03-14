/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./addRowFilterModalPopup';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { ComboBox, ComboBoxOption, ComboBoxSeparator } from 'vs/base/browser/ui/positronComponents/comboBox/comboBox';

/**
 * Constants.
 */
const CONDITION_IS_EMPTY = 'is-empty';
const CONDITION_IS_NOT_EMPTY = 'is-not-empty';
const CONDITION_IS_LESS_THAN = 'is-less-than';
const CONDITION_IS_GREATER_THAN = 'is-greater-than';
const CONDITION_IS_EXACTLY = 'is-exactly';
const CONDITION_IS_BETWEEN = 'is-between';
const CONDITION_IS_NOT_BETWEEN = 'is-not-between';

/**
 * Condition enumeration.
 */
enum Condition {
	CONDITION_IS_EMPTY = 'is-empty',
	CONDITION_IS_NOT_EMPTY = 'is-not-empty',
	CONDITION_IS_LESS_THAN = 'is-less-than',
	CONDITION_IS_GREATER_THAN = 'is-greater-than',
	CONDITION_IS_EXACTLY = 'is-exactly',
	CONDITION_IS_BETWEEN = 'is-between',
	CONDITION_IS_NOT_BETWEEN = 'is-not-between'
}

/**
 * RowFilter interface.
 */
export interface RowFilter {
	columnName: string;
	condition: string;
}

/**
 * Shows the add row filter modal popup.
 * @param layoutService The layout service.
 * @param anchorElement The anchor element for the modal popup.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const addRowFilterModalPopup = async (
	layoutService: ILayoutService,
	anchorElement: HTMLElement
): Promise<RowFilter | undefined> => {
	// Build the condition combo box items.
	const conditionItems = [
		new ComboBoxOption({
			value: CONDITION_IS_EMPTY,
			label: localize('positron.isEmpty', "is empty"),
		}),
		new ComboBoxOption({
			value: CONDITION_IS_NOT_EMPTY,
			label: localize('positron.isNotEmpty', "is not empty"),
		}),
		new ComboBoxSeparator(),
		new ComboBoxOption({
			value: CONDITION_IS_LESS_THAN,
			label: localize('positron.isLessThan', "is less than"),
		}),
		new ComboBoxOption({
			value: CONDITION_IS_GREATER_THAN,
			label: localize('positron.isGreaterThan', "is greater than"),
		}),
		new ComboBoxOption({
			value: CONDITION_IS_EXACTLY,
			label: localize('positron.isExactly', "is exactly"),
		}),
		new ComboBoxOption({
			value: CONDITION_IS_BETWEEN,
			label: localize('positron.isBetween', "is between"),
		}),
		new ComboBoxOption({
			value: CONDITION_IS_NOT_BETWEEN,
			label: localize('positron.isNotBetween', "is not between"),
		})
	];

	// Return a promise that resolves when the popup is done.
	return new Promise<RowFilter | undefined>(resolve => {
		// Get the container for the anchor element.
		const containerElement = layoutService.getContainer(DOM.getWindow(anchorElement));

		// Create the modal React renderer.
		const positronModalReactRenderer = new PositronModalReactRenderer(
			containerElement
		);

		/**
		 * AddRowFilterModalPopup component.
		 * @returns The rendered component.
		 */
		const AddRowFilterModalPopup = () => {
			// Reference hooks.
			const buttonRef = useRef<HTMLButtonElement>(undefined!);

			// State hooks.
			const [disabled, _setDisabled] = useState(true);
			const [_column, _setColumn] = useState<ColumnSchema | undefined>(undefined);
			const [_condition, _setCondition] = useState<Condition | undefined>(undefined);

			/**
			 * onDismiss handler.
			 */
			const dismissHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(undefined);
			};

			/**
			 * onPressed handler.
			 */
			const pressedHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(undefined);
			};

			/**
			 * onSelectionChanged handler for filter condition.
			 * @param identifier
			 */
			const conditionSelectionChangedHandler = (identifier: string | undefined) => {
				console.log(`Select Condition changed to ${identifier}`);
			};

			// Render.
			return (
				<PositronModalPopup
					renderer={positronModalReactRenderer}
					containerElement={containerElement}
					anchorElement={anchorElement}
					popupPosition='bottom'
					popupAlignment='left'
					minWidth={275}
					width={'max-content'}
					height={'min-content'}
					keyboardNavigation='dialog'
					onDismiss={dismissHandler}
				>
					<div className='add-row-filter-modal-popup-body'>
						<ComboBox<string>
							layoutService={layoutService}
							className='combo-box'
							title='Select Column'
							items={conditionItems}
							onValueChanged={identifier => console.log(`Select Column changed to ${identifier}`)}
						/>
						<ComboBox<string>
							layoutService={layoutService}
							className='combo-box'
							title='Select Condition'
							items={conditionItems}
							onValueChanged={conditionSelectionChangedHandler}
						/>
						{!disabled &&
							<Button
								ref={buttonRef}
								className='solid button-apply-filter'
								onPressed={pressedHandler}
							>
								Apply Filter
							</Button>
						}
					</div>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		positronModalReactRenderer.render(<AddRowFilterModalPopup />);
	});
};
