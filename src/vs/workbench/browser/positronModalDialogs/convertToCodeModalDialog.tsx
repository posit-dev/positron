/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { useEffect, useState, useRef } from 'react';

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
import { CodeEditorWidget } from '../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { getSimpleEditorOptions } from '../../contrib/codeEditor/browser/simpleEditorOptions.js';
import { EditorExtensionsRegistry } from '../../../editor/browser/editorExtensions.js';
import { MenuPreventer } from '../../contrib/codeEditor/browser/menuPreventer.js';
import { SelectionClipboardContributionID } from '../../contrib/codeEditor/browser/selectionClipboard.js';
import { ContextMenuController } from '../../../editor/contrib/contextmenu/browser/contextmenu.js';
import { SuggestController } from '../../../editor/contrib/suggest/browser/suggestController.js';
import { SnippetController2 } from '../../../editor/contrib/snippet/browser/snippetController2.js';
import { TabCompletionController } from '../../contrib/snippets/browser/tabCompletion.js';
import { Emitter } from '../../../base/common/event.js';
import { Button } from '../../positronComponents/button/button.js';
import { PlatformNativeDialogActionBar } from '../positronComponents/positronModalDialog/components/platformNativeDialogActionBar.js';

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


	useEffect(() => {
		const disposableStore = new DisposableStore();
		const editor = disposableStore.add(services.instantiationService.createInstance(
			CodeEditorWidget,
			editorContainerRef.current,
			{
				...getSimpleEditorOptions(services.configurationService),
				readOnly: true,
			},
			{
				isSimpleWidget: true,
				contributions: EditorExtensionsRegistry.getSomeEditorContributions([
					MenuPreventer.ID,
					SelectionClipboardContributionID,
					ContextMenuController.ID,
					SuggestController.ID,
					SnippetController2.ID,
					TabCompletionController.ID,
				])
			}
		));


		const emitter = disposableStore.add(new Emitter<string>);
		const inputModel = disposableStore.add(services.modelService.createModel(
			codeString || '',
			{ languageId: language || '', onDidChange: emitter.event },
			undefined,
			true
		));

		editor.setModel(inputModel);
		editorRef.current = editor;

		return () => {
			disposableStore.dispose();
		};
	},
		[codeString, language, services.instantiationService, services.configurationService, services.modelService]);

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

	const handleCopyToClipboard = async () => {
		if (codeString) {
			await services.clipboardService.writeText(codeString);
			services.notificationService.info(localize(
				'positron.dataExplorer.codeCopiedToClipboard',
				"Code copied to clipboard"
			));
		}
	};

	const handleSendToConsole = async () => {
		if (codeString) {
			try {
				// Send code to the current console
				await services.commandService.executeCommand('workbench.action.terminal.sendSequence', {
					text: codeString + '\n'
				});
				props.renderer.dispose();
			} catch (error) {
				services.notificationService.error(localize(
					'positron.dataExplorer.failedToSendToConsole',
					"Failed to send code to console"
				));
			}
		}
	};
	const okButton = (
		<Button className='action-bar-button default' onPressed={props.onAccept}>
			{props.okButtonTitle ?? localize('positronOK', "OK")}
		</Button>
	);
	const cancelButton = (
		<Button className='action-bar-button' onPressed={() => props.renderer.dispose()}>
			{localize('positronCancel', "Cancel")}
		</Button>
	);
	// Render.
	return (
		<OKCancelModalDialog
			catchErrors
			height={400}
			renderer={props.renderer}
			title={(() => localize(
				'positronConvertToCodeModalDialogTitle',
				"Convert to Code"
			))()}
			width={400}
			onAccept={() => props.renderer.dispose()}
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
				<div style={{ display: 'flex', flexDirection: 'column', height: '350px' }}>
					<div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
						<Button
							disabled={!codeString}
							onPressed={handleCopyToClipboard}
						>
							{localize('positron.dataExplorer.copyCode', 'Copy')}
						</Button>
					</div>
					<div
						ref={editorContainerRef}
						style={{ flex: 1, width: '100%', border: '1px solid var(--vscode-widget-border)' }}
					/>
				</div>
			</VerticalStack>
			<div className='ok-cancel-action-bar top-separator'>
				<PlatformNativeDialogActionBar primaryButton={okButton} secondaryButton={cancelButton} />
			</div>
		</OKCancelModalDialog>
	);
};
