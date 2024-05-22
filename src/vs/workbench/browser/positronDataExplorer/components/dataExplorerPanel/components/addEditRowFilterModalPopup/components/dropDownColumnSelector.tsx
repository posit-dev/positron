/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dropDownColumnSelector';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import * as DOM from 'vs/base/browser/dom';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
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

	// // State hooks.
	const [selectedColumnSchema, setSelectedColumnSchema] =
		useState<ColumnSchema | undefined>(props.selectedColumnSchema);

	// Render.
	return (
		<Button
			ref={ref}
			className='drop-down-column-selector'
			onPressed={() => {
				// Create the renderer.
				const renderer = new PositronModalReactRenderer({
					keybindingService: props.keybindingService,
					layoutService: props.layoutService,
					container: props.layoutService.getContainer(DOM.getWindow(ref.current)),
					onDisposed: () => {
						ref.current.focus();
					}
				});

				// Create the column selector data grid instance.
				const columnSelectorDataGridInstance = new ColumnSelectorDataGridInstance(
					props.dataExplorerClientInstance
				);

				// Show the drop down list box modal popup.
				renderer.render(
					<ColumnSelectorModalPopup
						configurationService={props.configurationService}
						renderer={renderer}
						columnSelectorDataGridInstance={columnSelectorDataGridInstance}
						anchor={ref.current}
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
			}}
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
