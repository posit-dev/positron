/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkpointDialog.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { OKCancelModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKCancelModalDialog.js';
import { LabeledTextInput } from '../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { IChangedFile, IChangeSet, IChunk, OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { splitIntoChunksJob } from '../../common/agent/splitIntoChunks.js';
import { CHECKPOINT_TITLE_LIMIT, LARGE_FILE_LIMIT_MEGABYTES } from '../../common/checkpointsLimits.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsAgentService } from '../checkpointsAgentService.js';
import { openDiff } from '../openDiff.js';
import {
	addChunk, createDraft, draftPaths, IChunkDraft, IDraftChunk, isDraftReady, moveFile, moveHunk, partialPaths, reconcileDraft, setChunkText, setChunkTicked,
	setFileTicked, titleProblem, toChunks, usedChunkCount
} from './chunkDraft.js';
import { knownSizes, statusWord } from './fileStatus.js';
import { useRunAction } from './useRunAction.js';

const CHECKPOINT_DIALOG_WIDTH = 640;
const CHECKPOINT_DIALOG_HEIGHT = 600;

/** What the caller gives the dialog. */
export interface ICheckpointDialogOptions {
	/** The changes the person is checkpointing. */
	changes: IChangeSet;
	/** A starting arrangement, such as one proposed by a model. Without it, one chunk has every file. */
	initialChunks?: IChunk[];
	/**
	 * A title and description for the single chunk that holds every file, such as the agent's
	 * description of the changes. Not used with `initialChunks`.
	 */
	suggestedText?: { title: string; body: string };
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

/** The first draft: the given chunks, or one chunk with every file and the suggested text. */
function initialDraft(options: ICheckpointDialogOptions): IChunkDraft {
	const draft = createDraft(options.changes.files, options.initialChunks);
	if (options.initialChunks?.length || !options.suggestedText) {
		return draft;
	}
	return setChunkText(draft, draft.chunks[0].id, options.suggestedText);
}

/**
 * The checkpoint dialog. Each ticked chunk becomes one checkpoint with its own title and
 * description. The person ticks chunks and the files in them, moves a file or one part of a text
 * file to another chunk, and adds chunks. A chunk that holds only some parts of a file says so.
 *
 * Without `initialChunks`, the dialog shows one chunk with every file at once and, when the agent
 * is available, asks it to split the changes. The proposal replaces the single chunk only while
 * the person has not changed anything, with the chunks that look finished ticked. When the agent
 * gives no proposal, the single chunk stays.
 *
 * The dialog stays open until the action finishes, so a cancel at the unsaved-files question or a
 * failed save keeps what the person typed. When saving the files changes them in any way, the
 * dialog shows the new list for review instead of creating anything.
 */
export const CheckpointDialog = (props: ICheckpointDialogProps) => {
	const services = usePositronReactServicesContext();
	const runAction = useRunAction();
	const [draft, setDraft] = useState<IChunkDraft>(() => initialDraft(props));
	// True once the person changed the draft, or a save changed it; a proposal then arrives too late.
	const edited = useRef(false);
	const update = (next: IChunkDraft) => {
		edited.current = true;
		setDraft(next);
	};
	// The changes the draft was built from. They are replaced only after a save changed the files.
	const [changes, setChanges] = useState<IChangeSet>(props.changes);
	const [addedPaths, setAddedPaths] = useState<ReadonlySet<string>>(new Set());
	const [notice, setNotice] = useState<string>();
	const [running, setRunning] = useState(false);

	// Asks the agent for a split once, when the dialog opens without a starting arrangement.
	const [splitRequest] = useState(() => props.initialChunks?.length ? undefined : props.changes);
	useEffect(() => {
		const agentService = services.get(ICheckpointsAgentService);
		if (!splitRequest || !agentService.available) {
			return;
		}
		const source = new CancellationTokenSource();
		agentService.run(splitIntoChunksJob, splitRequest, source.token).then(outcome => {
			if (!outcome.ok || source.token.isCancellationRequested || edited.current) {
				return;
			}
			setDraft(createDraft(splitRequest.files, outcome.value.chunks.map(chunk => ({
				title: chunk.title,
				body: chunk.summary,
				hunkIds: chunk.hunkIds,
				wholeFiles: chunk.wholeFiles,
				ticked: chunk.finished,
			}))));
		});
		return () => source.dispose(true);
	}, [services, splitRequest]);

	const filesByPath = new Map(changes.files.map(file => [file.path, file]));
	const ready = isDraftReady(draft);

	const submit = async () => {
		if (!ready || running) {
			return;
		}
		const arranged = draft;
		setRunning(true);
		const result = await runAction('checkpoint', async (engine, { decision }) => {
			// Only a save made by this action can change the files the person reviewed. In every
			// other case the reviewed basis is sent, so the engine refuses with changes-moved when
			// the files changed in any other way.
			if (decision !== 'proceed-after-save') {
				return engine.createCheckpoints(changes.basis, toChunks(arranged));
			}
			const current = await engine.getChanges();
			if (current.basis === changes.basis) {
				return engine.createCheckpoints(changes.basis, toChunks(arranged));
			}
			const reconciled = reconcileDraft(arranged, current.files);
			const before = draftPaths(arranged);
			const after = draftPaths(reconciled);
			const added = [...after].filter(path => !before.has(path));
			const removed = [...before].some(path => !after.has(path));
			update(reconciled);
			setChanges(current);
			setAddedPaths(new Set(added));
			// Nothing saved by the guard enters a checkpoint without a second look.
			if (added.length > 0) {
				setNotice(Strings.changes.savedAndAdded(added.length));
			} else {
				setNotice(removed || !isDraftReady(reconciled) ? Strings.changes.savedAndChanged() : Strings.changes.savedContentChanged());
			}
			return undefined;
		});
		if (result === undefined) {
			setRunning(false);
			return;
		}
		props.renderer.dispose();
		props.onFinished?.(result);
	};

	return (
		<OKCancelModalDialog
			cancelButtonTitle={Strings.actions.cancel()}
			height={CHECKPOINT_DIALOG_HEIGHT}
			okButtonTitle={Strings.actions.createCheckpoints(Math.max(usedChunkCount(draft), 1))}
			okDisabled={!ready || running}
			renderer={props.renderer}
			title={Strings.changes.dialogTitle()}
			width={CHECKPOINT_DIALOG_WIDTH}
			onAccept={submit}
			onCancel={() => props.renderer.dispose()}
		>
			<div className='checkpoint-dialog'>
				{notice !== undefined && <p className='checkpoint-dialog-warning' role='status'>{notice}</p>}
				{draft.chunks.map((chunk, index) => (
					<ChunkEditor
						key={chunk.id}
						addedPaths={addedPaths}
						chunk={chunk}
						chunks={draft.chunks}
						filesByPath={filesByPath}
						index={index}
						partialPaths={partialPaths(draft, chunk)}
						onMove={(path, toChunkId) => update(moveFile(draft, chunk.id, path, toChunkId))}
						onMoveHunk={(hunkId, toChunkId) => update(moveHunk(draft, hunkId, toChunkId))}
						onText={text => update(setChunkText(draft, chunk.id, text))}
						onTick={(path, ticked) => update(setFileTicked(draft, chunk.id, path, ticked))}
						onTickChunk={ticked => update(setChunkTicked(draft, chunk.id, ticked))}
					/>
				))}
				<Button className='checkpoints-button' onPressed={() => update(addChunk(draft))}>
					{Strings.changes.addAnotherCheckpoint()}
				</Button>
			</div>
		</OKCancelModalDialog>
	);
};

interface IChunkEditorProps {
	/** Files that a save added after the person first arranged the chunks. */
	addedPaths: ReadonlySet<string>;
	chunk: IDraftChunk;
	chunks: IDraftChunk[];
	index: number;
	filesByPath: Map<string, IChangedFile>;
	/** The files of which this chunk holds only some parts. */
	partialPaths: string[];
	onText(text: { title?: string; body?: string }): void;
	onTick(path: string, ticked: boolean): void;
	onTickChunk(ticked: boolean): void;
	onMove(path: string, toChunkId: number): void;
	onMoveHunk(hunkId: string, toChunkId: number): void;
}

/** A menu that moves something to another chunk. */
const MoveMenu = (props: { label: string; chunkId: number; chunks: IDraftChunk[]; onMove(toChunkId: number): void }) => (
	<select aria-label={props.label} value={props.chunkId} onChange={e => props.onMove(Number(e.target.value))}>
		{props.chunks.map((candidate, candidateIndex) => (
			<option key={candidate.id} value={candidate.id}>{Strings.changes.chunkTitle(candidateIndex + 1)}</option>
		))}
	</select>
);

/**
 * One chunk: whether it is ticked, its title, its description, and its files. A text file with
 * more than one part lists the parts this chunk holds, each with its text in a block that opens
 * on a click, and a menu that moves the part to another chunk.
 */
const ChunkEditor = (props: IChunkEditorProps) => {
	const { chunk } = props;
	const services = usePositronReactServicesContext();
	const problem = titleProblem(chunk.title);

	return (
		<fieldset className={positronClassNames('checkpoint-dialog-chunk', { 'unticked': !chunk.ticked })}>
			<legend>
				<label>
					<input checked={chunk.ticked} type='checkbox' onChange={e => props.onTickChunk(e.target.checked)} />
					<span>{Strings.changes.chunkTitle(props.index + 1)}</span>
				</label>
			</legend>
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
			{props.partialPaths.length > 0 && <p className='checkpoint-dialog-empty' role='note'>{Strings.history.partialFiles(props.partialPaths)}</p>}
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
							{props.addedPaths.has(draftFile.path) && <span className='checkpoint-dialog-added'>{Strings.changes.savedAndAddedTag()}</span>}
							{props.chunks.length > 1 && (
								<MoveMenu
									chunkId={chunk.id}
									chunks={props.chunks}
									label={Strings.changes.moveFileTo(draftFile.path)}
									onMove={toChunkId => props.onMove(draftFile.path, toChunkId)}
								/>
							)}
							<Button
								ariaLabel={Strings.actions.viewDetailedDifferencesOf(draftFile.path)}
								className='checkpoints-link'
								onPressed={() => openDiff(services, { kind: 'change', path: draftFile.path }, Strings.diff.changeTitle(draftFile.path), file && knownSizes(file))}
							>
								{Strings.actions.viewDetailedDifferences()}
							</Button>
							{file?.tooLarge && (
								<p className='checkpoint-dialog-warning' role='note'>{Strings.changes.tooLarge(draftFile.path, LARGE_FILE_LIMIT_MEGABYTES)}</p>
							)}
							{file && file.hunks.length > 1 && (
								<ul aria-label={draftFile.path} className='checkpoint-dialog-parts'>
									{file.hunks.map((hunk, hunkIndex) => draftFile.hunkIds.includes(hunk.id) && (
										<li key={hunk.id} className='checkpoint-dialog-part'>
											<details>
												<summary>{Strings.changes.partLabel(hunkIndex + 1, hunk.addedLines, hunk.removedLines)}</summary>
												<pre>{hunk.patch}</pre>
											</details>
											{props.chunks.length > 1 && (
												<MoveMenu
													chunkId={chunk.id}
													chunks={props.chunks}
													label={Strings.changes.movePartTo(hunkIndex + 1, draftFile.path)}
													onMove={toChunkId => props.onMoveHunk(hunk.id, toChunkId)}
												/>
											)}
										</li>
									))}
								</ul>
							)}
						</li>
					);
				})}
			</ul>
		</fieldset>
	);
};
