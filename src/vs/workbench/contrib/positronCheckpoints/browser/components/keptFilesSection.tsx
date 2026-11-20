/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { IDialogService, IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IKeptFile, OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsMessageService } from '../checkpointsMessages.js';
import { projectRootUri } from '../projectRoot.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';
import { useRunAction } from './useRunAction.js';

/** True for the result that says something is already at the place a kept file would go. */
function isOccupied(result: OperationResult | undefined): boolean {
	return result?.kind === 'unavailable' && result.reason === 'occupied';
}

/**
 * Files kept aside (spec 6.2): files an action moved out of the way because they were in no
 * checkpoint. The section shows while any exist, with their total size. Each file can be
 * restored, moved to another place in the project, or deleted after a confirmation.
 */
export const KeptFilesSection = ({ view }: { view: ICheckpointsViewState }) => {
	const services = usePositronReactServicesContext();
	const runAction = useRunAction();
	// Undefined until the list is read, and 'failed' when reading it failed.
	const [files, setFiles] = useState<IKeptFile[] | 'failed'>();
	// Incremented by Try Again, so the list is read once more.
	const [attempt, setAttempt] = useState(0);
	const keptCount = view.state?.keptFileCount ?? 0;

	// The list is read again whenever the view loads, because the engine reports only the count.
	useEffect(() => {
		if (keptCount === 0) {
			setFiles([]);
			return undefined;
		}
		let current = true;
		const engine = services.get(ICheckpointsService).engine;
		engine?.getKeptFiles().then(
			list => { if (current) { setFiles(list); } },
			error => {
				if (current) {
					services.get(ILogService).error('The files kept aside could not be read.', error);
					setFiles('failed');
				}
			}
		);
		return () => { current = false; };
	}, [services, view.state, keptCount, attempt]);

	if (keptCount === 0) {
		return null;
	}

	/**
	 * Asks where a kept file should go, and returns the path relative to the project. A place
	 * outside the project is refused with a sentence, because the engine moves files within it.
	 */
	const chooseDestination = async (file: IKeptFile): Promise<string | undefined> => {
		const root = projectRootUri(services.get(IWorkspaceContextService), view.state?.projectRoot ?? '');
		const chosen = await services.get(IFileDialogService).showSaveDialog({
			title: Strings.kept.chooseNewPlace(file.originalPath),
			defaultUri: joinPath(root, file.originalPath),
			saveLabel: Strings.kept.moveHere(),
		});
		if (!chosen) {
			return undefined;
		}
		const { extUri } = services.get(IUriIdentityService);
		const relative = extUri.isEqualOrParent(chosen, root) ? extUri.relativePath(root, chosen) : undefined;
		if (!relative) {
			services.get(ICheckpointsMessageService).show(Strings.kept.outsideProject());
			return undefined;
		}
		return relative;
	};

	/**
	 * Restores to the original place, or to `destination`. While the target is occupied, asks for
	 * a new name and tries again, until the person cancels.
	 */
	const restore = async (file: IKeptFile, destination?: string) => {
		let target = destination;
		for (; ;) {
			const result = await runAction('no-guard', engine => engine.restoreKeptFile(file.id, target));
			if (!isOccupied(result)) {
				break;
			}
			target = await chooseDestination(file);
			if (target === undefined) {
				break;
			}
		}
		view.refresh();
	};

	const move = async (file: IKeptFile) => {
		const destination = await chooseDestination(file);
		if (destination !== undefined) {
			await restore(file, destination);
		}
	};

	const remove = async (file: IKeptFile) => {
		const { confirmed } = await services.get(IDialogService).confirm({
			type: 'warning',
			message: Strings.kept.deleteConfirm(file.originalPath),
			detail: Strings.kept.deleteDetail(),
			primaryButton: Strings.kept.delete(),
		});
		if (!confirmed) {
			return;
		}
		await runAction('no-guard', engine => engine.deleteKeptFile(file.id));
		view.refresh();
	};

	const heading = <h3 className='checkpoints-heading' id='checkpoints-kept-heading'>{Strings.kept.heading()}</h3>;

	if (files === 'failed') {
		const retry = () => {
			setFiles(undefined);
			setAttempt(current => current + 1);
		};
		return (
			<section aria-labelledby='checkpoints-kept-heading' className='checkpoints-section checkpoints-kept'>
				{heading}
				<p className='checkpoints-note'>{Strings.kept.couldNotLoad()}</p>
				<Button className='checkpoints-link' onPressed={retry}>{Strings.kept.tryAgain()}</Button>
			</section>
		);
	}

	// No total is shown until the list is read.
	if (files === undefined) {
		return (
			<section aria-labelledby='checkpoints-kept-heading' className='checkpoints-section checkpoints-kept'>
				{heading}
			</section>
		);
	}

	const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);

	return (
		<section aria-labelledby='checkpoints-kept-heading' className='checkpoints-section checkpoints-kept'>
			{heading}
			<p className='checkpoints-note'>{Strings.kept.totalSize(ByteSize.formatSize(totalBytes))}</p>
			<ul className='checkpoints-file-list'>
				{files.map(file => (
					<li key={file.id} className='checkpoints-file-row'>
						<span className='checkpoints-file-path'>{file.originalPath}</span>
						<span className='checkpoints-file-note'>{ByteSize.formatSize(file.sizeBytes)}</span>
						<span className='checkpoints-file-note'>{Strings.kept.keptBy(file.action)}</span>
						<Button ariaLabel={Strings.kept.restoreOf(file.originalPath)} className='checkpoints-link' onPressed={() => restore(file)}>
							{Strings.kept.restore()}
						</Button>
						<Button ariaLabel={Strings.kept.moveOf(file.originalPath)} className='checkpoints-link' onPressed={() => move(file)}>
							{Strings.kept.moveToAnotherPlace()}
						</Button>
						<Button ariaLabel={Strings.kept.deleteOf(file.originalPath)} className='checkpoints-link' onPressed={() => remove(file)}>
							{Strings.kept.delete()}
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
};
