/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { mustGit, runGit } from './git';
import { engineFilePath, readBranch, readConfigSection, readIndexTree, RefChange, TriState } from './journal';
import { noteNewOperation } from './operationLog';
import { EnginePorts } from './ports';
import { runOperation } from './runOperation';
import { worktreeTree } from './trees';
import { OperationResult } from './types';

/** The prefix of every proposal branch name. */
const PROPOSAL_PREFIX = 'proposal/';

/** The configuration key, under `branch.<name>`, that names the base branch of a proposal. */
const BASE_KEY = 'positronCheckpointsBase';

/** A slug has at most this many characters; the name adds `-<suffix>` (and `-2`, `-3` when that is used) after it. */
const SLUG_LIMIT = 40;

/** A proposal: its branch name, the name of its base branch, and whether an upstream is configured for it. */
export interface Proposal { branch: string; base: string; sent: boolean }

/** The value of the configuration key `key`, or undefined when it is not set. */
async function configValue(ports: EnginePorts, key: string): Promise<string | undefined> {
	const result = await runGit(ports.git, ['-C', ports.projectRoot, 'config', '--get', key]);
	return result.exitCode === 0 ? result.stdout.replace(/\r?\n$/, '') : undefined;
}

/** The short name of the branch HEAD points at, or undefined when HEAD is detached. */
async function currentBranch(ports: EnginePorts): Promise<string | undefined> {
	const symbolic = await runGit(ports.git, ['-C', ports.projectRoot, 'symbolic-ref', '-q', 'HEAD']);
	const ref = symbolic.exitCode === 0 ? symbolic.stdout.trim() : '';
	return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : undefined;
}

/**
 * The proposal `branch` is, or undefined. A branch is a proposal when its name starts with
 * `proposal/` and `branch.<name>.positronCheckpointsBase` names a base. `sent` is true when
 * `branch.<name>.merge` is set; the ref it names is not resolved, so a proposal whose remote
 * branch was deleted and pruned still counts as sent.
 */
async function proposalOf(ports: EnginePorts, branch: string): Promise<Proposal | undefined> {
	if (!branch.startsWith(PROPOSAL_PREFIX)) {
		return undefined;
	}
	const base = await configValue(ports, `branch.${branch}.${BASE_KEY}`);
	if (base === undefined || base === '') {
		return undefined;
	}
	const merge = await configValue(ports, `branch.${branch}.merge`);
	return { branch, base, sent: merge !== undefined && merge !== '' };
}

/** The proposal HEAD points at, or undefined (see `proposalOf`). */
export async function readProposal(ports: EnginePorts): Promise<Proposal | undefined> {
	const branch = await currentBranch(ports);
	return branch === undefined ? undefined : proposalOf(ports, branch);
}

/** The upstream of `branch` as git abbreviates it (for example `origin/main`) and its commit, when git can resolve it. */
async function upstreamOf(ports: EnginePorts, branch: string): Promise<{ name: string; commit: string } | undefined> {
	// `<branch>@{upstream}` needs the short name; the full ref name is not resolved.
	const commit = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', '--end-of-options', `${branch}@{upstream}^{commit}`]);
	if (commit.exitCode !== 0) {
		return undefined;
	}
	const name = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`]);
	return { name: name.exitCode === 0 ? name.stdout.trim() : '', commit: commit.stdout.trim() };
}

/**
 * What "shared" is measured against for `branch`: its upstream when git can resolve it, or for a
 * proposal with no resolvable upstream (not sent yet, or its remote branch is gone), the upstream
 * of its base branch. Undefined when there is neither.
 */
export async function sharedUpstream(ports: EnginePorts, branch: string): Promise<{ name: string; commit: string } | undefined> {
	const own = await upstreamOf(ports, branch);
	if (own !== undefined) {
		return own;
	}
	const proposal = await proposalOf(ports, branch);
	return proposal === undefined ? undefined : upstreamOf(ports, proposal.base);
}

/**
 * The commit that "shared" is measured against (see `sharedUpstream`) for `branch`, or for the
 * branch HEAD points at when `branch` is left out. Undefined when HEAD is detached or there is
 * no such commit.
 */
export async function sharedReference(ports: EnginePorts, branch?: string): Promise<string | undefined> {
	const name = branch ?? await currentBranch(ports);
	return name === undefined ? undefined : (await sharedUpstream(ports, name))?.commit;
}

/**
 * The slug of a proposal branch name for `title`: lower case, with each run of characters other
 * than ASCII letters and digits made one hyphen, no hyphen at either end, at most 40 characters,
 * and `changes` when nothing remains.
 */
export function proposalSlug(title: string): string {
	const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_LIMIT).replace(/-+$/, '');
	return slug === '' ? 'changes' : slug;
}

/**
 * The six lower-case hex characters that end a proposal name made with the id `id`: the first six
 * of the id when it is hex (hyphens left out, as in a UUID), and else the first six of its SHA-256.
 * The same id always gives the same characters.
 */
export function proposalSuffix(id: string): string {
	const hex = id.toLowerCase().replace(/-/g, '');
	return /^[0-9a-f]{6,}$/.test(hex) ? hex.slice(0, 6) : createHash('sha256').update(id).digest('hex').slice(0, 6);
}

/**
 * `proposal/<slug>-<suffix>`, where `<suffix>` comes from a new id (`proposalSuffix`), so a name
 * is never used twice: after the host deletes an accepted proposal's branch and a fetch prunes
 * it, a later proposal with the same slug still gets a name of its own, and the host's newest
 * review for that name is never the old one. While a local branch or a remote-tracking branch has
 * that name, or has it as a folder of its name, `-2`, `-3`, and so on are added.
 */
async function freeName(ports: EnginePorts, slug: string): Promise<string> {
	const refs = (await mustGit(ports.git, ['-C', ports.projectRoot, 'for-each-ref', '--format=%(refname)', 'refs/heads/', 'refs/remotes/'])).stdout
		.split('\n').filter(ref => ref !== '');
	const used = (name: string) => refs.some(ref => {
		const short = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref.slice('refs/remotes/'.length);
		const local = ref.startsWith('refs/heads/');
		return local
			? short === name || short.startsWith(`${name}/`)
			: short.endsWith(`/${name}`) || short.includes(`/${name}/`);
	});
	const unique = `${PROPOSAL_PREFIX}${slug}-${proposalSuffix(ports.newId())}`;
	let name = unique;
	for (let count = 2; used(name); count++) {
		name = `${unique}-${count}`;
	}
	return name;
}

/**
 * Starts a proposal (proposals spec 5.3): the checkpoints the current branch's upstream does not
 * have move to a new branch `proposal/<slug>-<suffix>`, and the current branch returns to its
 * upstream. The slug comes from the title of the oldest such checkpoint (`proposalSlug`), and the
 * suffix from a new id (`freeName`).
 * One `start-proposal` operation makes four ref changes, in order: create the proposal branch at
 * the current commit, write `branch.<name>.positronCheckpointsBase`, point HEAD at the proposal
 * branch, and move the base branch to its upstream commit (the commit point). The index and the
 * working files do not change. A completed start is noted in the undo list.
 *
 * Returns `unavailable unusual-state` when HEAD is detached or the index cannot be read,
 * `unavailable unusual-state proposal-exists` on a proposal, and `unavailable nothing-to-do`
 * when the branch has no resolvable upstream or no checkpoint the upstream lacks. Otherwise
 * returns the result of `runOperation`.
 */
export async function startProposal(ports: EnginePorts): Promise<OperationResult> {
	const branch = await currentBranch(ports);
	const indexTree = await readIndexTree(ports);
	if (branch === undefined || indexTree === undefined) {
		return { kind: 'unavailable', reason: 'unusual-state' };
	}
	if (await proposalOf(ports, branch) !== undefined) {
		return { kind: 'unavailable', reason: 'unusual-state', detail: 'proposal-exists' };
	}
	const upstream = await upstreamOf(ports, branch);
	const head = await readBranch(ports, branch);
	if (upstream === undefined || head === null) {
		return { kind: 'unavailable', reason: 'nothing-to-do' };
	}
	const unshared = (await mustGit(ports.git, ['-C', ports.projectRoot, 'rev-list', '--reverse', '--first-parent', head, `^${upstream.commit}`, '--'])).stdout
		.split('\n').filter(id => id !== '');
	if (unshared.length === 0) {
		return { kind: 'unavailable', reason: 'nothing-to-do' };
	}
	const message = (await mustGit(ports.git, ['-C', ports.projectRoot, 'log', '-1', '--format=%B', unshared[0], '--'])).stdout;
	const name = await freeName(ports, proposalSlug(message.split('\n')[0]));
	const section = `branch.${name}`;
	const refChanges: RefChange[] = [
		{ type: 'ref', name: `refs/heads/${name}`, after: head },
		{ type: 'config-section', section, before: await readConfigSection(ports, section), after: [[BASE_KEY, branch]] },
		{ type: 'head', before: `refs/heads/${branch}`, after: `refs/heads/${name}` },
		{ type: 'ref', name: `refs/heads/${branch}`, before: head, after: upstream.commit },
	];
	const state: TriState = { branchCommit: head, indexTree, worktreeTree: (await worktreeTree(ports)).tree };
	const result = await runOperation(ports, {
		kind: 'start-proposal', description: 'Start a proposal', expected: state, after: state, collisionChoices: [],
		refChanges, commitPoint: refChanges.length - 1,
	});
	if (result.kind === 'done') {
		await noteNewOperation(ports, 'start-proposal');
	}
	return result;
}

/** The name of the accepted record in the engine's folder. */
const ACCEPTED_FILE = 'accepted.json';

/** The accepted record: checkpoints of `branch` up to `through` are in the shared copy (proposals spec 5.5). */
interface AcceptedRecord { branch: string; through: string }

/** The text of the accepted record as `finishProposal` writes it. */
function acceptedText(record: AcceptedRecord): string {
	return `${JSON.stringify(record)}\n`;
}

/** The text of the accepted record in the engine's folder, or undefined when there is none. */
async function readAcceptedText(ports: EnginePorts): Promise<string | undefined> {
	const content = await ports.files.read(await engineFilePath(ports, ACCEPTED_FILE));
	return content === undefined ? undefined : Buffer.from(content).toString('utf8');
}

/** True when `ancestor` is `commit` or an ancestor of it. An unknown commit is no ancestor. */
async function isAncestor(ports: EnginePorts, ancestor: string, commit: string): Promise<boolean> {
	return (await runGit(ports.git, ['-C', ports.projectRoot, 'merge-base', '--is-ancestor', ancestor, commit])).exitCode === 0;
}

/**
 * The accepted point of `branch` (the branch HEAD points at when left out), from the accepted
 * record that `finishProposal` writes, or undefined. While it is defined, the checkpoints it
 * names and their ancestors count as shared: `readContext` and `basisOf` in sync, the ahead
 * count, `readCheckpoints`, `isSharedCommit`, and the undo refusal leave them out of the
 * unshared ones. A record whose checkpoint is not in its branch (a Get changes replaced the
 * branch's checkpoints, or another tool moved the branch) is removed. A record that cannot be
 * read counts as absent.
 */
export async function acceptedThrough(ports: EnginePorts, branch?: string): Promise<string | undefined> {
	const text = await readAcceptedText(ports);
	if (text === undefined) {
		return undefined;
	}
	let record: Partial<AcceptedRecord>;
	try {
		record = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof record.branch !== 'string' || typeof record.through !== 'string') {
		return undefined;
	}
	const tip = await readBranch(ports, record.branch);
	if (tip === null || !await isAncestor(ports, record.through, tip)) {
		await clearAccepted(ports);
		return undefined;
	}
	return record.branch === (branch ?? await currentBranch(ports)) ? record.through : undefined;
}

/** Removes the accepted record, when there is one. */
export async function clearAccepted(ports: EnginePorts): Promise<void> {
	const file = await engineFilePath(ports, ACCEPTED_FILE);
	if (await ports.files.lstat(file) !== undefined) {
		await ports.files.remove(file);
	}
}

/**
 * The current proposal, its tip, and the commit of its base branch, for `finishProposal` and
 * `stopProposal`, or the result that refuses them: `unavailable unusual-state` when HEAD is
 * detached or the index cannot be read, `unavailable nothing-to-do` when no proposal is current,
 * and `unavailable nothing-to-do get-changes-first` when the proposal is behind an upstream of
 * its own that git can resolve (a colleague added to it, and this computer does not have that
 * work yet).
 */
async function endingProposal(ports: EnginePorts): Promise<{ refused: false; proposal: Proposal; tip: string; state: TriState } | { refused: OperationResult }> {
	const branch = await currentBranch(ports);
	const indexTree = await readIndexTree(ports);
	if (branch === undefined || indexTree === undefined) {
		return { refused: { kind: 'unavailable', reason: 'unusual-state' } };
	}
	const proposal = await proposalOf(ports, branch);
	const tip = await readBranch(ports, branch);
	if (proposal === undefined || tip === null) {
		return { refused: { kind: 'unavailable', reason: 'nothing-to-do' } };
	}
	const own = await upstreamOf(ports, branch);
	if (own !== undefined && !await isAncestor(ports, own.commit, tip)) {
		return { refused: { kind: 'unavailable', reason: 'nothing-to-do', detail: 'get-changes-first' } };
	}
	return { refused: false, proposal, tip, state: { branchCommit: tip, indexTree, worktreeTree: (await worktreeTree(ports)).tree } };
}

/**
 * The ref changes that end `proposal` at `tip`, in order: move the base branch to the tip (a
 * compare-and-swap, the commit point, index 0), then point HEAD at the base branch, then
 * `between` (the accepted record of a finish), then remove the proposal branch and its whole
 * configuration section. The base moves while it is not checked out, so HEAD's commit never
 * differs from the index.
 */
async function endingChanges(ports: EnginePorts, proposal: Proposal, tip: string, between: RefChange[]): Promise<RefChange[]> {
	const baseRef = `refs/heads/${proposal.base}`;
	const baseCommit = await readBranch(ports, proposal.base);
	const section = `branch.${proposal.branch}`;
	return [
		baseCommit === null ? { type: 'ref', name: baseRef, after: tip } : { type: 'ref', name: baseRef, before: baseCommit, after: tip },
		{ type: 'head', before: `refs/heads/${proposal.branch}`, after: baseRef },
		...between,
		{ type: 'ref', name: `refs/heads/${proposal.branch}`, before: tip },
		{ type: 'config-section', section, before: await readConfigSection(ports, section), after: [] },
	];
}

/** Runs the operation that ends a proposal with `refChanges`, and notes it in the undo list once it is done. */
async function endProposal(ports: EnginePorts, kind: 'finish-proposal' | 'stop-proposal', description: string, state: TriState, refChanges: RefChange[]): Promise<OperationResult> {
	const result = await runOperation(ports, { kind, description, expected: state, after: state, collisionChoices: [], refChanges, commitPoint: 0 });
	if (result.kind === 'done') {
		await noteNewOperation(ports, kind);
	}
	return result;
}

/**
 * The accepted point of a finish (proposals spec 5.5, step 1): `acceptedCommit` when it exists
 * locally, is `tip` or an ancestor of it, and `upstream` has its work: it is an ancestor of
 * `upstream`, or `git merge-tree --write-tree --merge-base=<merge base of it and upstream>
 * <upstream> <it>` succeeds with exactly the tree of `upstream`. Otherwise undefined.
 */
async function acceptedPoint(ports: EnginePorts, acceptedCommit: string, tip: string, upstream: string | undefined): Promise<string | undefined> {
	if (upstream === undefined) {
		return undefined;
	}
	const resolved = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', '--end-of-options', `${acceptedCommit}^{commit}`]);
	const accepted = resolved.exitCode === 0 ? resolved.stdout.trim() : undefined;
	if (accepted === undefined || !await isAncestor(ports, accepted, tip)) {
		return undefined;
	}
	if (await isAncestor(ports, accepted, upstream)) {
		return accepted;
	}
	const base = (await runGit(ports.git, ['-C', ports.projectRoot, 'merge-base', accepted, upstream])).stdout.trim();
	if (base === '') {
		return undefined;
	}
	const merged = await runGit(ports.git, ['-C', ports.projectRoot, 'merge-tree', '--write-tree', `--merge-base=${base}`, upstream, accepted]);
	const upstreamTree = (await mustGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', `${upstream}^{tree}`])).stdout.trim();
	return merged.exitCode === 0 && merged.stdout.split('\n')[0].trim() === upstreamTree ? accepted : undefined;
}

/**
 * Finishes the current proposal after the shared copy accepted it (proposals spec 5.5). The
 * caller runs `checkShared` first; nothing is fetched here. Only refs change: the files and the
 * index stay as they are, and Get changes then does the file work. `acceptedCommit` is the last
 * checkpoint of the proposal the host accepted, as a commit id; it becomes the accepted point
 * only when `acceptedPoint` confirms it against the base's upstream.
 *
 * One `finish-proposal` operation makes these ref changes (see `endingChanges`): the base
 * branch to the proposal's tip (the commit point), HEAD to the base branch, the accepted record
 * `{ "branch": <base>, "through": <accepted point> }` in the engine's folder (`accepted.json`;
 * with no accepted point an existing record is removed, and with neither the change is left
 * out), then the proposal branch and its configuration section are removed. A failure before
 * the commit point changes nothing; each change after it is completed by `rollForward` or by
 * recovery. Undo restores the proposal, its whole configuration section, and the record as it
 * was. A completed finish is noted in the undo list.
 *
 * Refused as `endingProposal` describes. Otherwise returns the result of `runOperation`.
 */
export async function finishProposal(ports: EnginePorts, acceptedCommit: string): Promise<OperationResult> {
	const ending = await endingProposal(ports);
	if (ending.refused !== false) {
		return ending.refused;
	}
	const { proposal, tip, state } = ending;
	const through = await acceptedPoint(ports, acceptedCommit, tip, (await upstreamOf(ports, proposal.base))?.commit);
	const existing = await readAcceptedText(ports);
	const after = through === undefined ? undefined : acceptedText({ branch: proposal.base, through });
	const record: RefChange[] = existing === undefined && after === undefined ? [] : [{
		type: 'engine-file', name: ACCEPTED_FILE, ...(existing === undefined ? {} : { before: existing }), ...(after === undefined ? {} : { after }),
	}];
	return endProposal(ports, 'finish-proposal', 'Finish the proposal', state, await endingChanges(ports, proposal, tip, record));
}

/**
 * Stops the current proposal and keeps its checkpoints (proposals spec 5.7): they become
 * ordinary unshared checkpoints of the base branch. One `stop-proposal` operation makes the ref
 * changes of `endingChanges` with nothing between: the base branch to the proposal's tip (the
 * commit point), HEAD to the base branch, then the proposal branch and its configuration
 * section are removed. The files and the index do not change. A failure before the commit point
 * changes nothing; each change after it is completed by `rollForward` or by recovery. Undo
 * restores the proposal and its whole configuration section. A completed stop is noted in the
 * undo list.
 *
 * Refused as `endingProposal` describes. Otherwise returns the result of `runOperation`.
 */
export async function stopProposal(ports: EnginePorts): Promise<OperationResult> {
	const ending = await endingProposal(ports);
	if (ending.refused !== false) {
		return ending.refused;
	}
	return endProposal(ports, 'stop-proposal', 'Stop the proposal', ending.state, await endingChanges(ports, ending.proposal, ending.tip, []));
}
