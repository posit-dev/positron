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
 * Shows the new folder from Git modal dialog.
 * @param commandService The command service.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param dataExplorerClientInstance The data explorer client instance.
 * @returns A promise that resolves when the dialog is closed.
 */
export const copyAsCodeModalDialog = async (
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
 * NewCopyAsCodeModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const NewCopyAsCodeModalDialog = (props: CopyAsCodeDialogProps) => {
	// State hooks.
	const [codeSyntaxOptions, setcodeSyntaxOptions] = useState<Array<string>>(['No available syntaxes.']);
	const [selectedSyntax, setSelectedSyntax] = useState<string | undefined>(undefined);

	const [codeString, setCodeString] = useState<string | undefined>(undefined);

	useEffect(() => {
		const getCodeString = async () => {
			if (!selectedSyntax) {
				return;
			}
			// Execute the command to get the code string based on the selected syntax.
			const codeString = await props.commandService.executeCommand<string>(PositronDataExplorerCommandId.CopyAsCodeAction, selectedSyntax);
			setCodeString(codeString);
		}
		getCodeString();
	}, [props.commandService, selectedSyntax]);


	useEffect(() => {
		const getCodeSyntax = async () => {
			const codeSyntaxes = await props.commandService.executeCommand<Array<string>>(PositronDataExplorerCommandId.GetCodeSyntaxesAction);
			if (!codeSyntaxes) {
				return;
			}
			setcodeSyntaxOptions(codeSyntaxes);
			setSelectedSyntax(codeSyntaxes[0]);
		}
		getCodeSyntax();
	}, [props.commandService]);

	// Construct the syntax options dropdown entries
	const syntaxDropdownEntries = () => {
		if (codeSyntaxOptions.length === 0) {
			return [];
		}
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
		return codeSyntaxOptions[0]
	};

	const onSelectionChanged = async (item: DropDownListBoxItem<unknown, unknown>) => {
		const typedItem = item as DropDownListBoxItem<string, string>;
		setSelectedSyntax(typedItem.options.identifier);

		// Execute the command to get the code string based on the selected syntax.
		const exc = await props.commandService.executeCommand<string>(PositronDataExplorerCommandId.CopyAsCodeAction, typedItem.options.identifier)
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
					title={syntaxDropdownTitle()}
					onSelectionChanged={onSelectionChanged}
				/>
				<pre>
					{codeString}
				</pre>
			</VerticalStack>

		</OKCancelModalDialog>
	);
};
