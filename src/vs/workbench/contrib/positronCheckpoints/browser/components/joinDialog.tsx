/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkpointDialog.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { OKCancelModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { OKModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKModalDialog.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { IGitHubClient } from '../github/githubClient.js';

const JOIN_DIALOG_WIDTH = 560;
const JOIN_DIALOG_HEIGHT = 360;

/** The built-in git command that copies a project to this computer and offers to open it. */
const CLONE_COMMAND_ID = 'git.clone';

/** Opens the dialog that copies a colleague's project to this computer from its link. */
export function showJoinDialog(): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<JoinDialog renderer={renderer} />);
}

interface IJoinDialogProps {
	renderer: PositronModalReactRenderer;
}

/** Where the dialog is: asking for the link, copying the project, or finished. */
type Phase = 'link' | 'copying' | 'ready';

/**
 * Joins a project from its link. The person pastes the link, chooses the folder the project goes
 * into, and the built-in clone command copies it there and offers to open it. The dialog makes no
 * GitHub request, so a public project needs no sign-in. It never writes into a folder that
 * exists: when `parent/name` is taken, the person chooses another location. A failed copy states
 * whether a partly copied folder remains.
 */
export const JoinDialog = (props: IJoinDialogProps) => {
	const services = usePositronReactServicesContext();
	const [link, setLink] = useState('');
	const [phase, setPhase] = useState<Phase>('link');
	const [problem, setProblem] = useState<string>();
	const [progressSentence, setProgressSentence] = useState<string>();
	const [readySentence, setReadySentence] = useState<string>();

	const accept = async () => {
		if (phase !== 'link' || link.trim() === '') {
			return;
		}
		setProblem(undefined);
		const project = services.get(IGitHubClient).parseProjectLink(link);
		if (!project) {
			setProblem(Strings.join.notALink());
			return;
		}

		const fileDialogService = services.get(IFileDialogService);
		const picked = await fileDialogService.showOpenDialog({
			title: Strings.join.chooseFolderTitle(),
			openLabel: Strings.join.chooseFolderButton(),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			defaultUri: await fileDialogService.defaultFolderPath(),
		});
		const parent = picked?.[0];
		if (!parent) {
			return;
		}

		const fileService = services.get(IFileService);
		const target = joinPath(parent, project.name);
		if (await fileService.exists(target)) {
			setProblem(Strings.join.folderExists(project.name, parent.fsPath));
			return;
		}

		setPhase('copying');
		setProgressSentence(Strings.join.copying(project.name));
		let copiedTo: string | undefined;
		try {
			copiedTo = await services.get(ICommandService).executeCommand<string | undefined>(CLONE_COMMAND_ID, project.cloneUrl, parent.fsPath);
		} catch (error) {
			services.get(ILogService).error('[Checkpoints] The project could not be copied.', error);
		}
		if (copiedTo) {
			setReadySentence(Strings.join.ready(project.name));
			setPhase('ready');
			return;
		}
		// A failed copy removes its folder, and the dialog checks before it says nothing changed.
		setProblem(await fileService.exists(target)
			? Strings.join.partialFolder(target.fsPath)
			: Strings.join.copyFailed(project.owner));
		setPhase('link');
	};

	const cancel = () => {
		// A running copy cannot be taken back, so the dialog stays until it ends.
		if (phase !== 'copying') {
			props.renderer.dispose();
		}
	};

	if (phase === 'ready') {
		return (
			<OKModalDialog
				height={JOIN_DIALOG_HEIGHT}
				okButtonTitle={Strings.actions.close()}
				renderer={props.renderer}
				title={Strings.join.dialogTitle()}
				width={JOIN_DIALOG_WIDTH}
				onAccept={() => props.renderer.dispose()}
				onCancel={() => props.renderer.dispose()}
			>
				<div className='checkpoint-dialog'>
					<p role='status'>{readySentence}</p>
				</div>
			</OKModalDialog>
		);
	}

	return (
		<OKCancelModalDialog
			cancelButtonTitle={Strings.actions.cancel()}
			height={JOIN_DIALOG_HEIGHT}
			okButtonTitle={Strings.join.continueButton()}
			okDisabled={phase === 'copying' || link.trim() === ''}
			renderer={props.renderer}
			title={Strings.join.dialogTitle()}
			width={JOIN_DIALOG_WIDTH}
			onAccept={accept}
			onCancel={cancel}
		>
			<div className='checkpoint-dialog'>
				{phase === 'link' && (
					<>
						<p>{Strings.join.prompt()}</p>
						<LabeledTextInput
							autoFocus
							label={Strings.join.linkLabel()}
							value={link}
							onChange={e => setLink(e.target.value)}
						/>
						{problem && <p className='checkpoint-dialog-warning' role='alert'>{problem}</p>}
					</>
				)}
				{phase === 'copying' && (
					<p aria-live='polite' role='status'>{progressSentence}</p>
				)}
			</div>
		</OKCancelModalDialog>
	);
};
