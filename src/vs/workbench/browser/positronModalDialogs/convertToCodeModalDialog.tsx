/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './convertToCodeModalDialog.css';

// React.
import React, { useEffect, useState, useRef } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { IPositronDataExplorerInstance } from '../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { PositronDataExplorerCommandId } from '../../contrib/positronDataExplorerEditor/browser/positronDataExplorerActions.js';
import { DropDownListBox } from '../positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { DropdownEntry } from './components/dropdownEntry.js';
import { CodeSyntaxName } from '../../services/languageRuntime/common/positronDataExplorerComm.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';
import { CodeEditorWidget } from '../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from '../../contrib/codeEditor/browser/simpleEditorOptions.js';
import { Button } from '../../../base/browser/ui/positronComponents/button/button.js';
import { PlatformNativeDialogActionBar } from '../positronComponents/positronModalDialog/components/platformNativeDialogActionBar.js';
import { PositronModalDialog } from '../positronComponents/positronModalDialog/positronModalDialog.js';
import { ContentArea } from '../positronComponents/positronModalDialog/components/contentArea.js';

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

	// Code string display
	const editorRef = useRef<CodeEditorWidget>(undefined!);
	const editorContainerRef = useRef<HTMLDivElement>(undefined!);

	// for our purposes, this is equivalent to the language id
	const language = props.dataExplorerClientInstance.languageName.toLocaleLowerCase();

	useEffect(() => {
		const getCodeString = async () => {
			try {
				// Execute the command to get the code string based on the selected syntax.
				const result = await services.commandService.executeCommand(PositronDataExplorerCommandId.ConvertToCodeAction, selectedSyntax);
				setCodeString(typeof result === 'string' ? result : undefined);
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


	useEffect(() => {
		const disposableStore = new DisposableStore();
		const codeEditorWidget = disposableStore.add(services.instantiationService.createInstance(
			CodeEditorWidget,
			editorContainerRef.current,
			{
				...getSimpleEditorOptions(services.configurationService),
				readOnly: true,
				// lineDecorationsWidth is how we are adding left margin to the editor content
				lineDecorationsWidth: 10,
				padding: {
					top: 10,
					bottom: 10,
				}
			},
			getSimpleCodeEditorWidgetOptions()
		));

		codeEditorWidget.setModel(services.modelService.createModel(
			codeString || '',
			services.languageService.createById(language),
			undefined,
			true
		));

		editorRef.current = codeEditorWidget;

		return () => {
			disposableStore.dispose();
		};
	}, [codeString, language, services.instantiationService, services.configurationService, services.modelService, services.languageService]);

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
			setCodeString(typeof exc === 'string' ? exc : undefined);
		} catch (error) {
			setCodeString(localize(
				'positron.dataExplorer.cannotGenerateCodeForType',
				"Cannot generate code for type {0}",
				typedItem.options.value.code_syntax_name
			));
		}
	};

	const handleCopyToClipboard = async () => {
		if (codeString) {
			await services.clipboardService.writeText(codeString);
			services.notificationService.info(localize(
				'positron.dataExplorer.codeCopiedToClipboard',
				"Code copied to clipboard"
			));
			props.renderer.dispose();
		}
	};

	const okButton = (
		<Button className='action-bar-button default' onPressed={() => handleCopyToClipboard()}>
			{localize('positron.dataExplorer.positronCopyCode', "Copy Code")}
		</Button>
	);
	const cancelButton = (
		<Button className='action-bar-button' onPressed={() => props.renderer.dispose()}>
			{localize('positronCancel', "Cancel")}
		</Button>
	);
	// Render.
	return (
		<PositronModalDialog
			height={400}
			renderer={props.renderer}
			title={(() => localize(
				'positronConvertToCodeModalDialogTitle',
				"Convert to Code"
			))()}
			width={400}
		>
			<ContentArea>
				<h3 className='code-syntax-heading'>
					{localize('positron.dataExplorer.codeSyntaxHeading', "Select code syntax")}
				</h3>
				<DropDownListBox
					className='convert-to-code-syntax-dropdown'
					createItem={(item) => (
						<DropdownEntry
							title={item.options.identifier}
						/>
					)}
					entries={syntaxDropdownEntries()}
					title={syntaxDropdownTitle()}
					onSelectionChanged={onSelectionChanged}
				/>
				<div
					ref={editorContainerRef}
					className='convert-to-code-editor'
				/>
			</ContentArea>
			<div className='ok-cancel-action-bar'>
				<PlatformNativeDialogActionBar primaryButton={okButton} secondaryButton={cancelButton} />
			</div>
		</PositronModalDialog>
	);
};
