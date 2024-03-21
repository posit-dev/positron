/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./newFolderModalDialog';

// React.
import * as React from 'react';
import { useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { Checkbox } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/checkbox';
import { VerticalStack } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalStack';
import { VerticalSpacer } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/verticalSpacer';
import { PositronModalReactParams } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { OKCancelModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronOKCancelModalDialog';
import { LabeledFolderInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledFolderInput';

/**
 * NewFolderResult interface.
 */
export interface NewFolderResult {
	readonly folder: string;
	readonly parentFolder: string;
	readonly newWindow: boolean;
}

/**
 * NewFolderModalDialogProps interface.
 */
interface NewFolderModalDialogProps extends PositronModalReactParams<NewFolderResult> {
	fileDialogService: IFileDialogService;
	parentFolder: string;
}

// The new folder modal dialog component.
export const NewFolderModalDialog = (props: NewFolderModalDialogProps) => {
	// Hooks.
	const [newFolderResult, setNewFolderResult, newFolderResultRef] = useStateRef<NewFolderResult>({
		folder: '',
		parentFolder: props.parentFolder,
		newWindow: false
	});
	const folderNameRef = useRef<HTMLInputElement>(undefined!);

	// The accept handler.
	const acceptHandler = () => {
		props.renderer.dispose();
		props.accepted(newFolderResultRef.current);
	};

	// The cancel handler.
	const cancelHandler = () => {
		props.renderer.dispose();
	};

	// The browse handler.
	const browseHandler = async () => {
		// Show the open dialog.
		const uri = await props.fileDialogService.showOpenDialog({
			defaultUri: newFolderResult.parentFolder ? URI.file(newFolderResult.parentFolder) : undefined,
			canSelectFiles: false,
			canSelectFolders: true
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			setNewFolderResult({ ...newFolderResult, parentFolder: uri[0].fsPath });
			folderNameRef.current.focus();
		}
	};

	// Render.
	return (
		<OKCancelModalDialog
			renderer={props.renderer}
			width={400}
			height={300}
			title={localize('positronNewFolderModalDialogTitle', "New Folder")}
			onAccept={acceptHandler}
			onCancel={cancelHandler}>
			<VerticalStack>
				<LabeledTextInput
					ref={folderNameRef}
					label='Folder name'
					autoFocus
					value={newFolderResult.folder}
					onChange={e => setNewFolderResult({ ...newFolderResult, folder: e.target.value })}
				/>
				<LabeledFolderInput
					label='Create folder as subfolder of'
					value={newFolderResult.parentFolder}
					onBrowse={browseHandler}
					onChange={e => setNewFolderResult({ ...newFolderResult, parentFolder: e.target.value })}
				/>
			</VerticalStack>
			<VerticalSpacer>
				<Checkbox label='Open in a new window' onChanged={checked => setNewFolderResult({ ...newFolderResult, newWindow: checked })} />
			</VerticalSpacer>
		</OKCancelModalDialog>
	);
};
