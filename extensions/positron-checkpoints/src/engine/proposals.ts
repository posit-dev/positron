/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mustGit, runGit } from './git';
import { readBranch, readConfigSection, readIndexTree, RefChange, TriState } from './journal';
import { noteNewOperation } from './operationLog';
import { EnginePorts } from './ports';
import { runOperation } from './runOperation';
import { worktreeTree } from './trees';
import { OperationResult } from './types';

/** The prefix of every proposal branch name. */
const PROPOSAL_PREFIX = 'proposal/';

/** The configuration key, under `branch.<name>`, that names the base branch of a proposal. */
const BASE_KEY = 'positronCheckpointsBase';

/** A slug has at most this many characters, before any `-2` suffix. */
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
 * `proposal/<slug>`, with `-2`, `-3`, and so on added while a local branch or a remote-tracking
 * branch has that name, or has it as a folder of its name.
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
	let name = `${PROPOSAL_PREFIX}${slug}`;
	for (let suffix = 2; used(name); suffix++) {
		name = `${PROPOSAL_PREFIX}${slug}-${suffix}`;
	}
	return name;
}

/**
 * Starts a proposal (proposals spec 5.3): the checkpoints the current branch's upstream does not
 * have move to a new branch `proposal/<slug>`, and the current branch returns to its upstream.
 * The slug comes from the title of the oldest such checkpoint (`proposalSlug`, then `freeName`).
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

/** The engine call `finishProposal`. Returns `unavailable` in every case. */
export async function finishProposal(_ports: EnginePorts, _acceptedCommit: string): Promise<OperationResult> {
	return { kind: 'unavailable', reason: 'nothing-to-do' };
}

/** The engine call `stopProposal`. Returns `unavailable` in every case. */
export async function stopProposal(_ports: EnginePorts): Promise<OperationResult> {
	return { kind: 'unavailable', reason: 'nothing-to-do' };
}
