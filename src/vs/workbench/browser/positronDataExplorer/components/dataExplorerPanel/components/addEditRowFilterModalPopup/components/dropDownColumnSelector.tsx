/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dropDownColumnSelector.css';

// React.
import React, { useCallback, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../../../nls.js';
import * as DOM from '../../../../../../../../base/browser/dom.js';
import { ILayoutService } from '../../../../../../../../platform/layout/browser/layoutService.js';
import { Button } from '../../../../../../../../base/browser/ui/positronComponents/button/button.js';
import { IKeybindingService } from '../../../../../../../../platform/keybinding/common/keybinding.js';
import { IConfigurationService } from '../../../../../../../../platform/configuration/common/configuration.js';
import { ColumnSchema } from '../../../../../../../services/languageRuntime/common/positronDataExplorerComm.js';
import { OKModalDialog } from '../../../../../../positronComponents/positronModalDialog/positronOKModalDialog.js';
import { VerticalStack } from '../../../../../../positronComponents/positronModalDialog/components/verticalStack.js';
import { PositronModalReactRenderer } from '../../../../../../positronModalReactRenderer/positronModalReactRenderer.js';
import { DataExplorerClientInstance } from '../../../../../../../services/languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { columnSchemaDataTypeIcon } from '../../../utility/columnSchemaUtilities.js';
import { ColumnSelectorModalPopup } from './columnSelectorModalPopup.js';
import { ColumnSelectorDataGridInstance } from './columnSelectorDataGridInstance.js';

/**
 * DropDownColumnSelectorProps interface.
 */
interface DropDownColumnSelectorProps {
	configurationService: IConfigurationService;
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	dataExplorerClientInstance: DataExplorerClientInstance;
	title: string;
	selectedColumnSchema?: ColumnSchema;
	onSelectedColumnSchemaChanged: (selectedColumnSchema: ColumnSchema) => void;
}

/**
 * DropDownColumnSelector component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const DropDownColumnSelector = (props: DropDownColumnSelectorProps) => {
	// Reference hooks.
	const ref = useRef<HTMLButtonElement>(undefined!);

	// State hooks.
	const [title, _setTitle] = useState(props.title);
	const [selectedColumnSchema, setSelectedColumnSchema] = useState<ColumnSchema | undefined>(props.selectedColumnSchema);

	const onPressed = useCallback(async (focusInput?: boolean) => {
		// Create the column selector data grid instance.
		const columnSelectorDataGridInstance = await ColumnSelectorDataGridInstance.create(
			props.dataExplorerClientInstance,
		);

		// Get the container.
		const container = props.layoutService.getContainer(DOM.getWindow(ref.current));

		// If the column selector data grid instance could not be created, alert the user.
		// Otherwise, show the column selector modal popup.
		if (!columnSelectorDataGridInstance) {
			// Create the modal React renderer.
			const renderer = new PositronModalReactRenderer({
				keybindingService: props.keybindingService,
				layoutService: props.layoutService,
				container
			});

			// Get the title and message.
			const title = localize('positron.dataExplorer.selectColumn', "Select Column");
			const message = localize(
				'positron.dataExplorer.unableToOpenTheColumnSelector',
				"Unable to open the column selector."
			);

			// Inform the user that the column selector data grid instance could not be created.
			renderer.render(
				<OKModalDialog
					height={195}
					renderer={renderer}
					title={title}
					width={400}
					onAccept={async () => {
						renderer.dispose();
					}}
					onCancel={() => renderer.dispose()}>
					<VerticalStack>
						<div>{message}</div>
					</VerticalStack>
				</OKModalDialog>
			);
		} else {
			// Create the renderer.
			const renderer = new PositronModalReactRenderer({
				keybindingService: props.keybindingService,
				layoutService: props.layoutService,
				container,
				disableCaptures: true, // permits the usage of the enter key where applicable
				onDisposed: () => {
					columnSelectorDataGridInstance.dispose();
					ref.current.focus();
				}
			});

			// Show the drop down list box modal popup.
			renderer.render(
				<ColumnSelectorModalPopup
					anchorElement={ref.current}
					columnSelectorDataGridInstance={columnSelectorDataGridInstance}
					configurationService={props.configurationService}
					focusInput={focusInput}
					renderer={renderer}
					onItemSelected={columnSchema => {
						renderer.dispose();
						setSelectedColumnSchema(columnSchema);
						props.onSelectedColumnSchemaChanged(columnSchema);
					}}
				/>
			);
		}
	}, [props]);

	const onKeyDown = useCallback((evt: KeyboardEvent) => {
		// eliminate key events for anything that isn't a single-character key or whitespaces
		if (evt.key.trim().length !== 1) { return; }
		// don't consume event here; the input will pick it up
		onPressed(true);
	}, [onPressed]);

	useEffect(() => {
		const el = ref.current;
		el.addEventListener('keydown', onKeyDown);
		return () => {
			el.removeEventListener('keydown', onKeyDown);
		};
	}, [ref, onKeyDown]);

	// Render.
	return (
		<Button
			ref={ref}
			className='drop-down-column-selector'
			onPressed={() => onPressed()}
		>
			{!selectedColumnSchema ?
				(<div className='title'>{title}</div>) :
				(
					<div className='column-schema-title'>
						<div className={`data-type-icon codicon ${columnSchemaDataTypeIcon(selectedColumnSchema)}`}></div>
						<div className='column-name'>
							{selectedColumnSchema.column_name}
						</div>
					</div>
				)
			}
			<div aria-hidden='true' className='chevron'>
				<div className='codicon codicon-chevron-down' />
			</div>
		</Button>
	);
};
