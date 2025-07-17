/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { IWorkbenchLayoutService } from '../../services/layout/browser/layoutService.js';
import { VerticalStack } from '../positronComponents/positronModalDialog/components/verticalStack.js';
import { PositronModalReactRenderer } from '../positronModalReactRenderer/positronModalReactRenderer.js';
import { OKCancelModalDialog } from '../positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { IPositronDataExplorerInstance } from '../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { PositronDataExplorerCommandId } from '../../contrib/positronDataExplorerEditor/browser/positronDataExplorerActions.js';
import { DropDownListBox } from '../positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { DropdownEntry } from './components/dropdownEntry.js';

/**
 * Shows the copy as code modal dialog.
 * @param commandService The command service.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param dataExplorerClientInstance The data explorer client instance.
 * @returns A promise that resolves when the dialog is closed.
 */
export const showCopyAsCodeModalDialog = async (
	commandService: ICommandService,
	keybindingService: IKeybindingService,
	layoutService: IWorkbenchLayoutService,
	dataExplorerClientInstance: IPositronDataExplorerInstance,
): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.activeContainer
	});

	// Show the copy as code dialog.
	renderer.render(
		<NewCopyAsCodeModalDialog
			commandService={commandService}
			dataExplorerClientInstance={dataExplorerClientInstance}
			keybindingService={keybindingService}
			layoutService={layoutService}
			renderer={renderer}
		/>
	);
};

/**
 * CopyAsCodeDialogProps interface.
 */
interface CopyAsCodeDialogProps {
	commandService: ICommandService;
	dataExplorerClientInstance: IPositronDataExplorerInstance
	keybindingService: IKeybindingService;
	layoutService: IWorkbenchLayoutService;
	renderer: PositronModalReactRenderer;
}


/**
 * CopyAsCodeModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const CopyAsCodeModalDialog = (props: CopyAsCodeDialogProps) => {
	// State hooks.
	const instance = props.dataExplorerClientInstance.dataExplorerClientInstance;
	const codeSyntaxOptions = instance.cachedBackendState?.supported_features?.code_syntaxes.code_syntaxes ?? [];

	const [selectedSyntax, setSelectedSyntax] = useState<string>(instance.suggestedSyntax?.code_syntax_name ?? 'Select Code Syntax');

	const [codeString, setCodeString] = useState<string | undefined>(undefined);

	useEffect(() => {
		const getCodeString = async () => {
			// Execute the command to get the code string based on the selected syntax.
			const codeString = await props.commandService.executeCommand(PositronDataExplorerCommandId.CopyAsCodeAction, selectedSyntax);
			setCodeString(codeString);
		}
		getCodeString();
	}, [props.commandService, selectedSyntax]);

	// Construct the syntax options dropdown entries
	const syntaxDropdownEntries = () => {
		return syntaxInfoToDropDownItems(codeSyntaxOptions);
	};

	const syntaxInfoToDropDownItems = (
		syntaxes: string[]
	): DropDownListBoxItem<string, string>[] => {
		return syntaxes.map(
			(syntax) =>
				new DropDownListBoxItem<string, string>({
					identifier: syntax,
					value: syntax,
				})
		);
	};

	// Construct the syntax dropdown title.
	const syntaxDropdownTitle = () => {
		return selectedSyntax;
	};

	const onSelectionChanged = async (item: DropDownListBoxItem<string, string>) => {
		const typedItem = item as DropDownListBoxItem<string, string>;
		setSelectedSyntax(typedItem.options.identifier);

		// Execute the command to get the code string based on the selected syntax.
		const exc = await props.commandService.executeCommand(PositronDataExplorerCommandId.CopyAsCodeAction, typedItem.options.identifier)
		setCodeString(exc);
	};

	// Render.
	return (
		<OKCancelModalDialog
			catchErrors
			height={300}
			renderer={props.renderer}
			title={(() => localize(
				'positronCopyAsCodeModalDialogTitle',
				"Copy as Code"
			))()}
			width={400}
			onAccept={async () => {
				props.renderer.dispose();
			}}
			onCancel={() => props.renderer.dispose()}
		>
			<VerticalStack>
				<DropDownListBox
					createItem={(item) => (
						<DropdownEntry
							title={item.options.identifier}
						/>
					)}
					entries={syntaxDropdownEntries()}
					keybindingService={props.keybindingService}
					layoutService={props.layoutService}
					title={selectedSyntax}
					onSelectionChanged={onSelectionChanged}
				/>
				<pre>
					{codeString}
				</pre>
			</VerticalStack>

		</OKCancelModalDialog>
	);
};
