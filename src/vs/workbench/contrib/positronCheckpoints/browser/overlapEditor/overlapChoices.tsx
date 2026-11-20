/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useRef, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { IOverlap, OverlapChoice } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { CombinationProposalState, useCombinationProposal } from './useCombinationProposal.js';

/** The command that opens the Source Control view. */
const OPEN_SOURCE_CONTROL_COMMAND_ID = 'workbench.view.scm';

/** What every overlap section receives. */
export interface IOverlapChoicesProps {
	overlap: IOverlap;
	/** The current choice for this overlap, if any. */
	choice: OverlapChoice | undefined;
	/** Sets the choice. Undefined clears it, for example while a new name is not usable. */
	onChoose(choice: OverlapChoice | undefined): void;
}

/** "Keep both" of a text overlap: my text followed by theirs, on a new line. */
export function keepBothText(mine: string, theirs: string): string {
	return mine === '' || mine.endsWith('\n') ? mine + theirs : `${mine}\n${theirs}`;
}

/**
 * The characters that cannot be part of a single file name on some system: path separators, the
 * characters Windows reserves, Unicode control characters, and the marks that change the
 * direction of text (which can make a name read differently from what it is).
 */
const UNSAFE_NAME_CHARACTERS = /[\/\\:*?"<>|\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Removes what cannot be part of a single name from `name`: see `UNSAFE_NAME_CHARACTERS`.
 * Returns the localized fallback label when nothing is left.
 */
export function sanitizeNameLabel(name: string): string {
	const cleaned = name.replace(UNSAFE_NAME_CHARACTERS, '').trim();
	return cleaned === '' ? Strings.overlaps.copyNameLabel() : cleaned;
}

/**
 * The name proposed for the renamed side of "Keep both": `<name> (<label>).<ext>` in the same
 * folder. A name that starts with a dot, or has none, keeps no extension apart. The label is
 * cleaned by `sanitizeNameLabel`.
 */
export function proposedName(path: string, rawLabel: string): string {
	const label = sanitizeNameLabel(rawLabel);
	const slash = path.lastIndexOf('/');
	const folder = path.slice(0, slash + 1);
	const base = path.slice(slash + 1);
	const dot = base.lastIndexOf('.');
	return dot > 0
		? `${folder}${base.slice(0, dot)} (${label})${base.slice(dot)}`
		: `${folder}${base} (${label})`;
}

/**
 * Which person has the file in a file-and-folder overlap. The side with content or a size is the
 * file; when that cannot be told, it is mine.
 */
function fileSideOf(overlap: IOverlap): 'me' | 'them' {
	const mineIsFile = overlap.mine !== undefined || overlap.mineSizeBytes !== undefined;
	const theirsIsFile = overlap.theirs !== undefined || overlap.theirsSizeBytes !== undefined;
	return theirsIsFile && !mineIsFile ? 'them' : 'me';
}

/** The plain explanation of an overlap. */
function explain(overlap: IOverlap): string {
	const { theirAuthor: author, path } = overlap;
	switch (overlap.kind) {
		case 'text':
			return Strings.overlaps.textExplain(author, path);
		case 'binary':
			return Strings.overlaps.binaryExplain(author, path);
		case 'edit-delete':
			return Strings.overlaps.editDeleteExplain(author, path, overlap.deletedBy ?? 'them');
		case 'rename':
			return Strings.overlaps.renameExplain(author, path);
		case 'file-folder':
			return Strings.overlaps.fileFolderExplain(author, path, fileSideOf(overlap));
		case 'unsupported':
			return Strings.overlaps.unsupportedExplain(path);
	}
}

/**
 * One overlap in the overlap editor: its title, its explanation, and its choices. A text overlap
 * also gets a combined text proposed by the agent while the agent is available.
 */
export const OverlapSection = ({ readChoice, ...props }: IOverlapChoicesProps & { readChoice(): OverlapChoice | undefined }) => {
	const headingId = `checkpoints-overlap-${props.overlap.id}`;
	const proposal = useCombinationProposal(props.overlap, readChoice, props.onChoose);
	return (
		<section aria-labelledby={headingId} className='checkpoints-overlap'>
			<h3 className='checkpoints-heading' id={headingId}>{Strings.overlaps.title(props.overlap.path)}</h3>
			<p>{explain(props.overlap)}</p>
			<OverlapChoices {...props} proposal={proposal} />
		</section>
	);
};

/** The choices the kind of an overlap allows (spec 6.4), with the same labels for every kind. */
export const OverlapChoices = (props: IOverlapChoicesProps & { proposal?: CombinationProposalState }) => {
	switch (props.overlap.kind) {
		case 'text':
			return <TextOverlapChoices {...props} />;
		case 'binary':
			return <SideChoices {...props} keepBothSide='me' />;
		case 'edit-delete':
			return <EditDeleteChoices {...props} />;
		case 'rename':
			return <RenameChoices {...props} />;
		case 'file-folder':
			return <SideChoices {...props} keepBothSide={fileSideOf(props.overlap)} />;
		case 'unsupported':
			return <UnsupportedOverlap />;
	}
};

/** A radio button in the choices of one overlap. */
const Choice = (props: { overlapId: string; label: string; checked: boolean; onSelect(): void }) => (
	<label className='checkpoints-overlap-choice'>
		<input checked={props.checked} name={`checkpoints-overlap-${props.overlapId}`} type='radio' onChange={props.onSelect} />
		<span>{props.label}</span>
	</label>
);

interface ITextOverlapChoicesProps extends IOverlapChoicesProps {
	/** The combined text proposed by the agent, if one is requested. */
	proposal?: CombinationProposalState;
}

/**
 * A text overlap: mine and theirs side by side, "Keep mine", "Keep theirs", "Keep both", and the
 * resulting text, which the person can edit.
 *
 * With a proposal from the agent, the section also shows what each person did and the proposed
 * text beside both versions, with Accept, Edit, and "Choose myself". A proposal that became the
 * choice as it arrived (high confidence, no choice yet) hides the manual choices and says that it
 * is selected; "Choose myself" discards it and opens them. A low confidence proposal, or one that
 * arrived after the person chose, shows beside the manual choices and selects nothing. Apply in
 * the editor stays a separate click in every case.
 */
const TextOverlapChoices = ({ overlap, choice, onChoose, proposal }: ITextOverlapChoicesProps) => {
	const mine = overlap.mine ?? '';
	const theirs = overlap.theirs ?? '';
	const both = keepBothText(mine, theirs);
	const [emptied, setEmptied] = useState(false);
	const [discarded, setDiscarded] = useState(false);
	const resultRef = useRef<HTMLTextAreaElement>(null);

	const ready = proposal?.status === 'ready' && !discarded ? proposal : undefined;
	const proposalIsChoice = ready !== undefined && choice?.type === 'text' && choice.content === ready.proposal.combined;
	const showManual = ready === undefined || ready.proposal.confidence === 'low' || !ready.preselected;

	const acceptProposal = () => {
		if (ready) {
			setEmptied(false);
			onChoose({ type: 'text', content: ready.proposal.combined });
		}
	};
	const editProposal = () => {
		acceptProposal();
		resultRef.current?.focus();
	};
	const chooseMyself = () => {
		setDiscarded(true);
		if (proposalIsChoice) {
			onChoose(undefined);
		}
	};

	let proposalNote: string | undefined;
	if (proposalIsChoice) {
		proposalNote = Strings.overlaps.proposalSelected();
	} else if (choice !== undefined) {
		proposalNote = Strings.overlaps.proposalBesideChoice();
	} else if (ready?.proposal.confidence === 'low') {
		proposalNote = Strings.overlaps.proposalUncertain();
	}
	// An empty result is a real answer only when one of the three versions is empty too.
	const emptyAllowed = (overlap.base ?? '') === '' || mine === '' || theirs === '';

	const editResult = (text: string) => {
		const refused = text === '' && !emptyAllowed;
		setEmptied(refused);
		onChoose(refused ? undefined : { type: 'text', content: text });
	};

	let result = '';
	if (choice?.type === 'take') {
		result = choice.side === 'mine' ? mine : theirs;
	} else if (choice?.type === 'text') {
		result = choice.content;
	}

	return (
		<div className='checkpoints-overlap-text'>
			<div className='checkpoints-overlap-sides'>
				<figure>
					<figcaption>{Strings.overlaps.mineLabel()}</figcaption>
					<pre>{mine}</pre>
				</figure>
				<figure>
					<figcaption>{Strings.overlaps.theirsLabel(overlap.theirAuthor)}</figcaption>
					<pre>{theirs}</pre>
				</figure>
				{ready && (
					<figure className='checkpoints-overlap-proposed'>
						<figcaption>{Strings.overlaps.proposalLabel()}</figcaption>
						<pre>{ready.proposal.combined}</pre>
					</figure>
				)}
			</div>
			{proposal?.status === 'loading' && <p className='checkpoints-note' role='status'>{Strings.overlaps.proposalLoading()}</p>}
			{ready && (
				<div className='checkpoints-overlap-proposal'>
					<p>{Strings.overlaps.youDid(ready.proposal.mineDid)}</p>
					<p>{Strings.overlaps.authorDid(overlap.theirAuthor, ready.proposal.theirsDid)}</p>
					{proposalNote !== undefined && <p className='checkpoints-note' role='status'>{proposalNote}</p>}
					{ready.proposal.confidence === 'low' && <p className='checkpoints-file-note'>{ready.proposal.reason}</p>}
					<div className='checkpoints-overlap-proposal-actions'>
						<Button className='checkpoints-button' onPressed={acceptProposal}>{Strings.overlaps.accept()}</Button>
						<Button className='checkpoints-button' onPressed={editProposal}>{Strings.overlaps.edit()}</Button>
						<Button className='checkpoints-button' onPressed={chooseMyself}>{Strings.overlaps.chooseMyself()}</Button>
					</div>
				</div>
			)}
			{showManual && (
				<div aria-label={Strings.overlaps.choicesFor(overlap.path)} className='checkpoints-overlap-choices' role='radiogroup'>
					<Choice checked={choice?.type === 'take' && choice.side === 'mine'} label={Strings.overlaps.keepMine()} overlapId={overlap.id} onSelect={() => onChoose({ type: 'take', side: 'mine' })} />
					<Choice checked={choice?.type === 'take' && choice.side === 'theirs'} label={Strings.overlaps.keepTheirs(overlap.theirAuthor)} overlapId={overlap.id} onSelect={() => onChoose({ type: 'take', side: 'theirs' })} />
					<Choice checked={choice?.type === 'text' && choice.content === both} label={Strings.overlaps.keepBoth()} overlapId={overlap.id} onSelect={() => onChoose({ type: 'text', content: both })} />
				</div>
			)}
			<label className='checkpoints-overlap-result'>
				<span>{Strings.overlaps.combinedText()}</span>
				<textarea ref={resultRef} rows={8} value={result} onChange={e => editResult(e.target.value)} />
			</label>
			{emptied && choice === undefined && <p className='checkpoints-overlap-error' role='alert'>{Strings.overlaps.combinedTextEmpty()}</p>}
		</div>
	);
};

/**
 * A binary or file-and-folder overlap: "Keep mine", "Keep theirs", and "Keep both", which gives
 * one side a new name. `keepBothSide` is the side that is renamed.
 */
const SideChoices = ({ overlap, choice, onChoose, keepBothSide }: IOverlapChoicesProps & { keepBothSide: 'me' | 'them' }) => {
	const label = keepBothSide === 'me' ? Strings.overlaps.mineNameLabel() : overlap.theirAuthor;
	const [keepBoth, setKeepBoth] = useState(choice?.type === 'keep-both');
	const [newName, setNewName] = useState(choice?.type === 'keep-both' ? choice.newPath : proposedName(overlap.path, label));
	const nameUsable = (name: string) => name.trim() !== '' && name.trim() !== overlap.path;

	const chooseKeepBoth = (name: string) => {
		onChoose(nameUsable(name)
			? { type: 'keep-both', renamedSide: keepBothSide === 'me' ? 'mine' : 'theirs', newPath: name.trim() }
			: undefined);
	};
	const take = (side: 'mine' | 'theirs') => {
		setKeepBoth(false);
		onChoose({ type: 'take', side });
	};
	const keepBothChecked = keepBoth && (choice === undefined || choice.type === 'keep-both');

	return (
		<div className='checkpoints-overlap-binary'>
			{overlap.kind === 'binary' && (
				<p className='checkpoints-file-note'>
					{Strings.overlaps.sizes(ByteSize.formatSize(overlap.mineSizeBytes ?? 0), overlap.theirAuthor, ByteSize.formatSize(overlap.theirsSizeBytes ?? 0))}
				</p>
			)}
			<div aria-label={Strings.overlaps.choicesFor(overlap.path)} className='checkpoints-overlap-choices' role='radiogroup'>
				<Choice checked={!keepBothChecked && choice?.type === 'take' && choice.side === 'mine'} label={Strings.overlaps.keepMine()} overlapId={overlap.id} onSelect={() => take('mine')} />
				<Choice checked={!keepBothChecked && choice?.type === 'take' && choice.side === 'theirs'} label={Strings.overlaps.keepTheirs(overlap.theirAuthor)} overlapId={overlap.id} onSelect={() => take('theirs')} />
				<Choice checked={keepBothChecked} label={Strings.overlaps.keepBoth()} overlapId={overlap.id} onSelect={() => { setKeepBoth(true); chooseKeepBoth(newName); }} />
			</div>
			{keepBothChecked && (
				<label className='checkpoints-overlap-new-name'>
					<span>{Strings.overlaps.newNameFor(overlap.path)}</span>
					<input type='text' value={newName} onChange={e => { setNewName(e.target.value); chooseKeepBoth(e.target.value); }} />
					{!nameUsable(newName) && <span className='checkpoints-overlap-error' role='alert'>{Strings.overlaps.newNameInvalid(overlap.path)}</span>}
				</label>
			)}
		</div>
	);
};

/** An edit-and-delete overlap: keep the edited file, or accept the deletion. */
const EditDeleteChoices = ({ overlap, choice, onChoose }: IOverlapChoicesProps) => (
	<div aria-label={Strings.overlaps.choicesFor(overlap.path)} className='checkpoints-overlap-choices' role='radiogroup'>
		<Choice checked={choice?.type === 'keep-file'} label={Strings.overlaps.keepEditedFile()} overlapId={overlap.id} onSelect={() => onChoose({ type: 'keep-file' })} />
		<Choice checked={choice?.type === 'accept-deletion'} label={Strings.overlaps.acceptDeletion()} overlapId={overlap.id} onSelect={() => onChoose({ type: 'accept-deletion' })} />
	</div>
);

/** A rename overlap: choose the name to keep. */
const RenameChoices = ({ overlap, choice, onChoose }: IOverlapChoicesProps) => {
	const names = [...new Set([overlap.path, ...overlap.otherPaths])];
	return (
		<div aria-label={Strings.overlaps.choicesFor(overlap.path)} className='checkpoints-overlap-choices' role='radiogroup'>
			{names.map(name => (
				<Choice key={name} checked={choice?.type === 'path' && choice.keepPath === name} label={Strings.overlaps.keepName(name)} overlapId={overlap.id} onSelect={() => onChoose({ type: 'path', keepPath: name })} />
			))}
		</div>
	);
};

/** An overlap only a git tool can resolve: no choices, and a link to the Source Control view. */
const UnsupportedOverlap = () => {
	const services = usePositronReactServicesContext();
	return (
		<div className='checkpoints-overlap-unsupported'>
			<p>{Strings.status.needsGitTool()}</p>
			<Button className='checkpoints-link' onPressed={() => services.commandService.executeCommand(OPEN_SOURCE_CONTROL_COMMAND_ID)}>
				{Strings.actions.openSourceControl()}
			</Button>
		</div>
	);
};
