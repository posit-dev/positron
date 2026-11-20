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
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { OKCancelModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { IChangedFile, IChangeSet, IChunk, OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { CHECKPOINT_TITLE_LIMIT, LARGE_FILE_LIMIT_MEGABYTES } from '../../common/checkpointsLimits.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { openDiff } from '../openDiff.js';
import { addChunk, createDraft, IChunkDraft, IDraftChunk, isDraftReady, moveFile, reconcileDraft, setChunkText, setFileTicked, titleProblem, toChunks, usedChunkCount } from './chunkDraft.js';
import { statusWord } from './fileStatus.js';
import { useRunAction } from './useRunAction.js';

const CHECKPOINT_DIALOG_WIDTH = 640;
const CHECKPOINT_DIALOG_HEIGHT = 600;

/** What the caller gives the dialog. */
export interface ICheckpointDialogOptions {
	/** The changes the person is checkpointing. */
	changes: IChangeSet;
	/** A starting arrangement, such as one proposed by a model. Without it, one chunk has every file. */
	initialChunks?: IChunk[];
	/** Called after the action ran, with its result (undefined when it did not run). */
	onFinished?: (result: OperationResult | undefined) => void;
}

/** Opens the checkpoint dialog. */
export function showCheckpointDialog(options: ICheckpointDialogOptions): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<CheckpointDialog {...options} renderer={renderer} />);
}

interface ICheckpointDialogProps extends ICheckpointDialogOptions {
	renderer: PositronModalReactRenderer;
}

/**
 * The checkpoint dialog. Each chunk becomes one checkpoint with its own title and description.
 * The person ticks the files that belong in a chunk, moves a file to another chunk, and adds
 * chunks. Chunks hold whole files.
 */
export const CheckpointDialog = (props: ICheckpointDialogProps) => {
	const runAction = useRunAction();
	const [draft, setDraft] = useState<IChunkDraft>(() => createDraft(props.changes.files, props.initialChunks));

	const filesByPath = new Map(props.changes.files.map(file => [file.path, file]));
	const ready = isDraftReady(draft);

	const submit = async () => {
		const arranged = draft;
		props.renderer.dispose();
		const result = await runAction('checkpoint', async (engine, decision) => {
			let basis = props.changes.basis;
			let chunks = toChunks(arranged);
			// A save can change the files, so the chunks are fitted to the files as they are now.
			if (decision === 'proceed') {
				const current = await engine.getChanges();
				if (current.basis !== basis) {
					basis = current.basis;
					chunks = toChunks(reconcileDraft(arranged, current.files));
				}
			}
			return engine.createCheckpoints(basis, chunks);
		});
		props.onFinished?.(result);
	};

	return (
		<OKCancelModalDialog
			cancelButtonTitle={Strings.actions.cancel()}
			height={CHECKPOINT_DIALOG_HEIGHT}
			okButtonTitle={Strings.actions.createCheckpoints(Math.max(usedChunkCount(draft), 1))}
			okDisabled={!ready}
			renderer={props.renderer}
			title={Strings.changes.dialogTitle()}
			width={CHECKPOINT_DIALOG_WIDTH}
			onAccept={submit}
			onCancel={() => props.renderer.dispose()}
		>
			<div className='checkpoint-dialog'>
				{draft.chunks.map((chunk, index) => (
					<ChunkEditor
						key={chunk.id}
						chunk={chunk}
						chunks={draft.chunks}
						filesByPath={filesByPath}
						index={index}
						onMove={(path, toChunkId) => setDraft(moveFile(draft, path, toChunkId))}
						onText={text => setDraft(setChunkText(draft, chunk.id, text))}
						onTick={(path, ticked) => setDraft(setFileTicked(draft, path, ticked))}
					/>
				))}
				<Button className='checkpoints-button' onPressed={() => setDraft(addChunk(draft))}>
					{Strings.changes.addAnotherCheckpoint()}
				</Button>
			</div>
		</OKCancelModalDialog>
	);
};

interface IChunkEditorProps {
	chunk: IDraftChunk;
	chunks: IDraftChunk[];
	index: number;
	filesByPath: Map<string, IChangedFile>;
	onText(text: { title?: string; body?: string }): void;
	onTick(path: string, ticked: boolean): void;
	onMove(path: string, toChunkId: number): void;
}

/** One chunk: its title, its description, and its files. */
const ChunkEditor = (props: IChunkEditorProps) => {
	const { chunk } = props;
	const services = usePositronReactServicesContext();
	const problem = titleProblem(chunk.title);

	return (
		<fieldset className='checkpoint-dialog-chunk'>
			<legend>{Strings.changes.chunkTitle(props.index + 1)}</legend>
			<LabeledTextInput
				errorMsg={problem === 'too-long' ? Strings.changes.titleTooLong(CHECKPOINT_TITLE_LIMIT) : undefined}
				label={Strings.changes.titleLabel()}
				value={chunk.title}
				onChange={e => props.onText({ title: e.target.value })}
			/>
			<label className='checkpoint-dialog-body'>
				<span>{Strings.changes.bodyLabel()}</span>
				<textarea rows={2} value={chunk.body} onChange={e => props.onText({ body: e.target.value })} />
			</label>
			{chunk.files.length === 0 && <p className='checkpoint-dialog-empty'>{Strings.changes.noFilesInChunk()}</p>}
			<ul className='checkpoint-dialog-files'>
				{chunk.files.map(draftFile => {
					const file = props.filesByPath.get(draftFile.path);
					return (
						<li key={draftFile.path} className={positronClassNames('checkpoint-dialog-file', { 'unticked': !draftFile.ticked })}>
							<label>
								<input
									checked={draftFile.ticked}
									type='checkbox'
									onChange={e => props.onTick(draftFile.path, e.target.checked)}
								/>
								<span className='checkpoint-dialog-path'>{draftFile.path}</span>
							</label>
							{file && <span className='checkpoints-file-status'>{statusWord(file)}</span>}
							{props.chunks.length > 1 && (
								<select
									aria-label={Strings.changes.moveFileTo(draftFile.path)}
									value={chunk.id}
									onChange={e => props.onMove(draftFile.path, Number(e.target.value))}
								>
									{props.chunks.map((candidate, candidateIndex) => (
										<option key={candidate.id} value={candidate.id}>{Strings.changes.chunkTitle(candidateIndex + 1)}</option>
									))}
								</select>
							)}
							<Button
								ariaLabel={`${Strings.actions.viewDetailedDifferences()}: ${draftFile.path}`}
								className='checkpoints-link'
								onPressed={() => openDiff(services, { kind: 'change', path: draftFile.path }, Strings.diff.changeTitle(draftFile.path))}
							>
								{Strings.actions.viewDetailedDifferences()}
							</Button>
							{file?.tooLarge && (
								<p className='checkpoint-dialog-warning' role='note'>{Strings.changes.tooLarge(draftFile.path, LARGE_FILE_LIMIT_MEGABYTES)}</p>
							)}
						</li>
					);
				})}
			</ul>
		</fieldset>
	);
};
