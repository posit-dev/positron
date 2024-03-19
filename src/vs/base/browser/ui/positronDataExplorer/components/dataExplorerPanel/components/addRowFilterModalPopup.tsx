/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./addRowFilterModalPopup';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ComboBox } from 'vs/base/browser/ui/positronComponents/comboBox/comboBox';
import { PositronModalPopup } from 'vs/base/browser/ui/positronModalPopup/positronModalPopup';
import { ComboBoxMenuItem } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuItem';
import { ComboBoxMenuSeparator } from 'vs/base/browser/ui/positronComponents/comboBox/comboBoxMenuSeparator';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { StopCommandsKeyEventProcessor } from 'vs/platform/stopCommandsKeyEventProcessor/browser/stopCommandsKeyEventProcessor';

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
 * Shows the add row filter modal popup.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param anchor The anchor element for the modal popup.
 * @returns A promise that resolves when the popup is dismissed.
 */
export const addRowFilterModalPopup = async (
	keybindingService: IKeybindingService,
	layoutService: ILayoutService,
	anchor: HTMLElement
): Promise<void> => {
	// Build the condition combo box entries.
	const conditionEntries = [
		new ComboBoxMenuItem({
			identifier: CONDITION_IS_EMPTY,
			label: localize('positron.isEmpty', "is empty"),
		}),
		new ComboBoxMenuItem({
			identifier: CONDITION_IS_NOT_EMPTY,
			label: localize('positron.isNotEmpty', "is not empty"),
		}),
		new ComboBoxMenuSeparator(),
		new ComboBoxMenuItem({
			identifier: CONDITION_IS_LESS_THAN,
			label: localize('positron.isLessThan', "is less than"),
		}),
		new ComboBoxMenuItem({
			identifier: CONDITION_IS_GREATER_THAN,
			label: localize('positron.isGreaterThan', "is greater than"),
		}),
		new ComboBoxMenuItem({
			identifier: CONDITION_IS_EXACTLY,
			label: localize('positron.isExactly', "is exactly"),
		}),
		new ComboBoxMenuItem({
			identifier: CONDITION_IS_BETWEEN,
			label: localize('positron.isBetween', "is between"),
		}),
		new ComboBoxMenuItem({
			identifier: CONDITION_IS_NOT_BETWEEN,
			label: localize('positron.isNotBetween', "is not between"),
		})
	];

	// Return a promise that resolves when the popup is done.
	return new Promise<void>(resolve => {
		// Get the container for the anchor.
		const container = layoutService.getContainer(DOM.getWindow(anchor));

		// Create the modal React renderer.
		const renderer = new PositronModalReactRenderer({
			container,
			keyEventProcessor: new StopCommandsKeyEventProcessor({
				keybindingService,
				layoutService
			})
		});

		// The modal popup component.
		const ModalPopup = () => {
			/**
			 * Dismisses the popup.
			 */
			const dismiss = () => {
				renderer.dispose();
				resolve();
			};

			// Render.
			return (
				<PositronModalPopup
					renderer={renderer}
					container={container}
					anchor={anchor}
					popupPosition='bottom'
					popupAlignment='left'
					minWidth={275}
					width={'max-content'}
					height={'min-content'}
					keyboardNavigation='dialog'
					onDismiss={() => dismiss()}
				>
					<div className='add-row-filter-modal-popup-body'>
						<ComboBox
							keybindingService={keybindingService}
							layoutService={layoutService}
							title='Select Column'
							entries={conditionEntries}
							onSelectionChanged={identifier => console.log(`Select Column changed to ${identifier}`)}
						/>
						<ComboBox
							keybindingService={keybindingService}
							layoutService={layoutService}
							title='Select Condition'
							entries={conditionEntries}
							onSelectionChanged={identifier => console.log(`Select Condition changed to ${identifier}`)}
						/>
						<Button className='solid button-apply-filter'>
							Apply Filter
						</Button>
					</div>
				</PositronModalPopup>
			);
		};

		// Render the modal popup component.
		renderer.render(<ModalPopup />);
	});
};
