/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './newFolderFromGitModalDialog.css';

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

/**
 * Shows the new folder from Git modal dialog.
 * @param commandService The command service.
 * @param configService The config service.
 * @param fileDialogService The file dialog service.
 * @param keybindingService The keybinding service.
 * @param layoutService The layout service.
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

	// Show the new folder from git modal dialog.
	renderer.render(
		<NewCopyAsCodeModalDialog
			commandService={commandService}
			dataExplorerClientInstance={dataExplorerClientInstance}
			renderer={renderer}
		/>
	);
};

/**
 * NewFolderFromGitModalDialogProps interface.
 */
interface CopyAsCodeDialogProps {
	commandService: ICommandService;
	dataExplorerClientInstance: IPositronDataExplorerInstance
	renderer: PositronModalReactRenderer;
}


/**
 * NewFolderFromGitModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const NewCopyAsCodeModalDialog = (props: CopyAsCodeDialogProps) => {
	// State hooks.
	const [codeSyntax, setcodeSyntax] = useState<string | undefined>('positron-duckdb');

	const [codeString, setCodeString] = useState<string | undefined>('1234');

	useEffect(() => {
		const getCodeString = async () => {
			const codeString = await props.commandService.executeCommand<string>(PositronDataExplorerCommandId.CopyAsCodeAction);
			setCodeString(codeString);
		}
		getCodeString();
	}, [props.commandService]);


	useEffect(() => {
		const getCodeSyntax = async () => {
			const codeSyntax = await props.commandService.executeCommand<string>(PositronDataExplorerCommandId.GetCodeSyntaxesAction);
			setcodeSyntax(codeSyntax);
		}
		getCodeSyntax();
	}, [props.commandService]);

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
				<pre>
					{codeSyntax ?? 'hello'}
				</pre>
				<pre>
					{codeString ?? 'hello'}
				</pre>
			</VerticalStack>

		</OKCancelModalDialog>
	);
};
