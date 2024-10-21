/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dropDownColumnSelector';

// React.
import * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { OKModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKModalDialog';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { columnSchemaDataTypeIcon } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/utility/columnSchemaUtilities';
import { ColumnSelectorModalPopup } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/columnSelectorModalPopup';
import { ColumnSelectorDataGridInstance } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/columnSelectorDataGridInstance';

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
					renderer={renderer}
					width={400}
					height={195}
					title={title}
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
					configurationService={props.configurationService}
					renderer={renderer}
					columnSelectorDataGridInstance={columnSelectorDataGridInstance}
					anchorElement={ref.current}
					focusInput={focusInput}
					onItemHighlighted={columnSchema => {
						console.log(`onItemHighlighted ${columnSchema.column_name}`);
					}}
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
			<div className='chevron' aria-hidden='true'>
				<div className='codicon codicon-chevron-down' />
			</div>
		</Button>
	);
};
