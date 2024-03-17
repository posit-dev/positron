/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./addRowFilterModalPopup';

// React.
import * as React from 'react';
// import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
// import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
// import { ComboBox } from 'vs/base/browser/ui/positronComponents/comboBox/comboBox';
// import { ComboBoxMenuItem } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuItem';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
// import { ComboBoxMenuSeparator } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuSeparator';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { StopCommandsKeyEventProcessor } from 'vs/workbench/browser/stopCommandsKeyEventProcessor';

/**
 * Condition enumeration.
 */
// const CONDITION_IS_EMPTY = 'is-empty';
// const CONDITION_IS_NOT_EMPTY = 'is-not-empty';
// const CONDITION_IS_LESS_THAN = 'is-less-than';
// const CONDITION_IS_GREATER_THAN = 'is-greater-than';
// const CONDITION_IS_EXACTLY = 'is-exactly';
// const CONDITION_IS_BETWEEN = 'is-between';
// const CONDITION_IS_NOT_BETWEEN = 'is-not-between';

/**
 * Shows the add row filter modal popup.
 * @param options The add row filter modal popup options.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const addRowFilterModalPopup = async (options: {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	anchorElement: HTMLElement;
}): Promise<void> => {
	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Get the container for the anchor element.
		const container = options.layoutService.getContainer(
			DOM.getWindow(options.anchorElement)
		);

		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			container,
			keyEventProcessor: new StopCommandsKeyEventProcessor(options)
		});

		/**
		 * AddRowFilterModalPopup component.
		 * @returns The rendered component.
		 */
		const AddRowFilterModalPopup = () => {
			// Render.
			return (
				<PositronModalPopup
					renderer={renderer}
					containerElement={container}
					anchorElement={options.anchorElement}
					popupPosition='bottom'
					popupAlignment='left'
					minWidth={275}
					width={'max-content'}
					height={'min-content'}
					keyboardNavigation='dialog'
					onDismiss={() => console.log()}
				>
					<div className='add-row-filter-modal-popup-body'>
						{/*
						<ComboBox
							layoutService={layoutService}
							className='combo-box'
							searchable={true}
							title='Select Column'
							items={columnsComboBoxItemsProvider}
							onValueChanged={identifier => console.log(`Select Column changed to ${identifier}`)}
						/>
						<ComboBox<string>
							layoutService={layoutService}
							className='combo-box'
							title='Select Condition'
							items={conditionItems}
							onValueChanged={conditionSelectionChangedHandler}
						/>
						*/}
						<Button className='solid button-apply-filter'>
							Apply Filter
						</Button>
					</div>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		renderer.render(<AddRowFilterModalPopup />);
	});
};
