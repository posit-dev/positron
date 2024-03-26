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
import { ColumnSchema, ColumnSchemaTypeDisplay } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { DataExplorerClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeDataExplorerClient';
import { ColumnSelectorModalPopup } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/columnSelectorModalPopup';
import { ColumnSelectorDataGridInstance } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/columnSelectorDataGridInstance';

/**
 * DropDownColumnSelectorProps interface.
 */
interface DropDownColumnSelectorProps {
	keybindingService: IKeybindingService;
	layoutService: ILayoutService;
	dataExplorerClientInstance: DataExplorerClientInstance;
	title: string;
	onValueChanged: (value: ColumnSchema) => void;
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
		useState<ColumnSchema | undefined>(undefined);
	// const [highlightedDropDownListBoxItem, setHighlightedDropDownListBoxItem] =
	// 	useState<DropDownListBoxItem | undefined>(undefined);

	/**
	 * Returns the data type icon for the column schema.
	 * @returns The data type icon.
	 */
	const dataTypeIcon = () => {
		// Determine the alignment based on type.
		switch (selectedColumnSchema?.type_display) {
			case ColumnSchemaTypeDisplay.Number:
				return 'codicon-positron-data-type-number';

			case ColumnSchemaTypeDisplay.Boolean:
				return 'codicon-positron-data-type-boolean';

			case ColumnSchemaTypeDisplay.String:
				return 'codicon-positron-data-type-string';

			case ColumnSchemaTypeDisplay.Date:
				return 'codicon-positron-data-type-date';

			case ColumnSchemaTypeDisplay.Datetime:
				return 'codicon-positron-data-type-date-time';

			case ColumnSchemaTypeDisplay.Time:
				return 'codicon-positron-data-type-time';

			case ColumnSchemaTypeDisplay.Array:
				return 'codicon-positron-data-type-array';

			case ColumnSchemaTypeDisplay.Struct:
				return 'codicon-positron-data-type-struct';

			case ColumnSchemaTypeDisplay.Unknown:
				return 'codicon-positron-data-type-unknown';

			// This shouldn't ever happen.
			default:
				return 'codicon-question';
		}
	};

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
						// setHighlightedDropDownListBoxItem(undefined);
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
						renderer={renderer}
						columnSelectorDataGridInstance={columnSelectorDataGridInstance}
						anchor={ref.current}
						onItemHighlighted={columnSchema => {
							console.log(`onItemHighlighted ${columnSchema.column_name}`);
						}}
						onItemSelected={columnSchema => {
							renderer.dispose();
							setSelectedColumnSchema(columnSchema);
						}}
					/>
				);
			}}
		>
			{selectedColumnSchema ?
				(
					<div className='title-foo'>
						<div className={`data-type-icon codicon ${dataTypeIcon()}`}></div>
						<div className='column-name'>
							{selectedColumnSchema.column_name}
						</div>
					</div>
				) :
				(<div className='title'>{title}</div>)
			}
			{/* <div className='title'>{selectedColumnSchema ? selectedColumnSchema.column_name : title}</div> */}
			<div className='chevron' aria-hidden='true'>
				<div className='codicon codicon-chevron-down' />
			</div>
		</Button>
	);
};
