/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { VerticalStack } from '../positronComponents/positronModalDialog/components/verticalStack.js';
import { OKCancelModalDialog } from '../positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { IPositronDataExplorerInstance } from '../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { PositronDataExplorerCommandId } from '../../contrib/positronDataExplorerEditor/browser/positronDataExplorerActions.js';
import { DropDownListBox } from '../positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { DropdownEntry } from './components/dropdownEntry.js';
import { CodeSyntaxName } from '../../services/languageRuntime/common/positronDataExplorerComm.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';

/**
 * Shows the convert to code modal dialog.
 * @param dataExplorerClientInstance The data explorer client instance.
 * @returns A promise that resolves when the dialog is closed.
 */
export const showConvertToCodeModalDialog = async (
	dataExplorerClientInstance: IPositronDataExplorerInstance,
): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer()

	// Show the copy as code dialog.
	renderer.render(
		<ConvertToCodeModalDialog
			dataExplorerClientInstance={dataExplorerClientInstance}
			renderer={renderer}
		/>
	);
};

/**
 * ConvertToCodeDialogProps interface.
 */
interface ConvertToCodeDialogProps {
	dataExplorerClientInstance: IPositronDataExplorerInstance
	renderer: PositronModalReactRenderer;
}


/**
 * ConvertToCodeModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ConvertToCodeModalDialog = (props: ConvertToCodeDialogProps) => {
	// Service hooks.
	const services = usePositronReactServicesContext();

	// State hooks.
	const instance = props.dataExplorerClientInstance.dataExplorerClientInstance;
	const codeSyntaxOptions = instance.cachedBackendState?.supported_features?.convert_to_code?.code_syntaxes ?? [];

	const [selectedSyntax, setSelectedSyntax] = useState<CodeSyntaxName | undefined>(instance.suggestedSyntax);

	const [codeString, setCodeString] = useState<string | undefined>(undefined);

	useEffect(() => {
		const getCodeString = async () => {
			try {
				// Execute the command to get the code string based on the selected syntax.
				const result = await services.commandService.executeCommand(PositronDataExplorerCommandId.ConvertToCodeAction, selectedSyntax);
				setCodeString(result);
			} catch (error) {
				if (selectedSyntax) {
					setCodeString(localize(
						'positron.dataExplorer.getCodeStringWithSyntax',
						"Cannot generate code for type {0}",
						selectedSyntax.code_syntax_name
					));
				} else {
					setCodeString(localize(
						'positron.dataExplorer.getCodeStringNoSyntax',
						"Cannot generate code"
					));
				}
			}
		};

		getCodeString(); // Call the async function
	}, [selectedSyntax, services.commandService]);

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
		return localize('positron.dataExplorer.selectCodeSyntax', 'Select Code Syntax');
	}

	const onSelectionChanged = async (item: DropDownListBoxItem<string, CodeSyntaxName>) => {
		const typedItem = item as DropDownListBoxItem<string, CodeSyntaxName>;
		setSelectedSyntax(typedItem.options.value);

		// Execute the command to get the code string based on the selected syntax.
		try {
			const exc = await services.commandService.executeCommand(PositronDataExplorerCommandId.ConvertToCodeAction, typedItem.options.value);
			setCodeString(exc);
		} catch (error) {
			setCodeString(localize(
				'positron.dataExplorer.cannotGenerateCodeForType',
				"Cannot generate code for type {0}",
				typedItem.options.value.code_syntax_name
			));
		}
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
				if (codeString) {
					try {
						await services.clipboardService.writeText(codeString);
					} catch (error) {
						// If clipboard write fails, still dispose the modal
						console.error('Failed to copy to clipboard:', error);
					}
				}
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
