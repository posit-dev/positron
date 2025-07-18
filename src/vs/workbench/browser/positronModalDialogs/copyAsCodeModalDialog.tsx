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
import { OKCancelModalDialog } from '../positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { IPositronDataExplorerInstance } from '../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { PositronDataExplorerCommandId } from '../../contrib/positronDataExplorerEditor/browser/positronDataExplorerActions.js';
import { DropDownListBox } from '../positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { DropdownEntry } from './components/dropdownEntry.js';
import { CodeSyntaxName } from '../../services/languageRuntime/common/positronDataExplorerComm.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';

/**
 * Shows the convert to code modal dialog.
 * @param commandService The command service.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
 * @param dataExplorerClientInstance The data explorer client instance.
 * @returns A promise that resolves when the dialog is closed.
 */
export const showConvertToCodeModalDialog = async (
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
		<ConvertToCodeModalDialog
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
export const ConvertToCodeModalDialog = (props: CopyAsCodeDialogProps) => {
	// State hooks.
	const instance = props.dataExplorerClientInstance.dataExplorerClientInstance;
	const codeSyntaxOptions = instance.cachedBackendState?.supported_features?.convert_to_code.code_syntaxes ?? [];

	const [selectedSyntax, setSelectedSyntax] = useState<CodeSyntaxName | undefined>(instance.suggestedSyntax);

	const [codeString, setCodeString] = useState<string | undefined>(undefined);

	useEffect(() => {
		const getCodeString = async () => {
			if (!selectedSyntax) {
				return;
			}
			// Execute the command to get the code string based on the selected syntax.
			const codeString = await props.commandService.executeCommand(PositronDataExplorerCommandId.ConvertToCodeAction, selectedSyntax);
			setCodeString(codeString);
		}
		getCodeString();
	}, [props.commandService, selectedSyntax]);

	// Construct the syntax options dropdown entries
	const syntaxDropdownEntries = () => {
		return syntaxInfoToDropDownItems(codeSyntaxOptions);
	};

	const syntaxInfoToDropDownItems = (
		syntaxes: CodeSyntaxName[]
	): DropDownListBoxItem<string, CodeSyntaxName>[] => {
		return syntaxes.map(
			(syntax) =>
				new DropDownListBoxItem<string, CodeSyntaxName>({
					identifier: syntax.code_syntax_name,
					value: syntax,
				})
		);
	};

	const syntaxDropdownTitle = (): string => {
		// if selectedSyntax is an object with code_syntax_name, return that name
		if (typeof selectedSyntax === 'object' && 'code_syntax_name' in selectedSyntax) {
			return (selectedSyntax as CodeSyntaxName).code_syntax_name;
		}
		return localize('selectCodeSyntax', 'Select Code Syntax');
	}

	const onSelectionChanged = async (item: DropDownListBoxItem<string, CodeSyntaxName>) => {
		const typedItem = item as DropDownListBoxItem<string, CodeSyntaxName>;
		setSelectedSyntax(typedItem.options.value);

		// Execute the command to get the code string based on the selected syntax.
		const exc = await props.commandService.executeCommand(PositronDataExplorerCommandId.ConvertToCodeAction, typedItem.options.value);
		setCodeString(exc);
	};

	// Render.
	return (
		<OKCancelModalDialog
			catchErrors
			height={300}
			renderer={props.renderer}
			title={(() => localize(
				'positronConvertToCodeModalDialogTitle',
				"Convert to Code"
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
