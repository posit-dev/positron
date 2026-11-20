/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { MAX_PATCH_FILE_BYTES } from './changes';
import { GitFailedError, mustGit, runGit, splitZ } from './git';
import { EnginePorts } from './ports';
import { STAGING_TIMEOUT_MS, withTempIndex } from './trees';
import { Overlap, OverlapChoice, OverlapKind, Resolution } from './types';

/** Git keeps reading a file as text when its first this many bytes have no NUL byte. */
const BINARY_PROBE_BYTES = 8000;

/** The identity of commits that exist only in the object database, as inputs to `git merge-tree`. */
export const TEMPORARY_IDENTITY = {
	GIT_AUTHOR_NAME: 'Positron Checkpoints',
	GIT_AUTHOR_EMAIL: 'checkpoints@positron.invalid',
	GIT_COMMITTER_NAME: 'Positron Checkpoints',
	GIT_COMMITTER_EMAIL: 'checkpoints@positron.invalid',
};

/** The resolutions each kind of overlap allows (spec 6.4). */
export const ALLOWED_CHOICES: Record<OverlapKind, OverlapChoice['type'][]> = {
	'text': ['text', 'take'],
	'binary': ['take', 'keep-both'],
	'edit-delete': ['keep-file', 'accept-deletion'],
	'rename': ['path'],
	'file-folder': ['keep-both', 'take'],
	'unsupported': [],
};

/** The conflict types of `git merge-tree` messages the engine recognizes, by how they group the paths of one overlap. */
const FILE_FOLDER = 'CONFLICT (file/directory)';
const RENAME_RENAME = 'CONFLICT (rename/rename)';
const RENAME_DELETE = 'CONFLICT (rename/delete)';
const MODIFY_DELETE = 'CONFLICT (modify/delete)';
const CONTENTS = 'CONFLICT (contents)';
const BINARY = 'CONFLICT (binary)';

/**
 * The order in which messages claim paths: a message that names several paths comes first, so a
 * message about one of those paths joins its overlap.
 */
const PRIORITY = [FILE_FOLDER, RENAME_RENAME, RENAME_DELETE, MODIFY_DELETE, CONTENTS, BINARY];

/** Message types that may join an overlap started by each type, with no change of kind. */
const JOINS: Record<string, string[]> = {
	[FILE_FOLDER]: [MODIFY_DELETE],
	[RENAME_RENAME]: [],
	[RENAME_DELETE]: [],
	[MODIFY_DELETE]: [],
	[CONTENTS]: [CONTENTS, BINARY],
	[BINARY]: [CONTENTS, BINARY],
};

/** Which side of a merge `ours` (stage 2) is: the person's own work, or the incoming work. */
export type Side = 'mine' | 'theirs';

export interface StageEntry { mode: string; oid: string }
export interface MergeMessage { paths: string[]; type: string; text: string }

/** The output of `git merge-tree --write-tree -z`: the result tree, the stages of each conflicted path, and the messages. */
export interface ParsedMerge {
	tree: string;
	stages: Map<string, Map<number, StageEntry>>;
	messages: MergeMessage[];
}

/** One side of an overlap: the path, mode, and blob git recorded for it. */
export interface SideEntry { path: string; mode: string; oid: string }

/** An overlap with what applying a resolution needs. */
export interface OverlapPlan {
	overlap: Overlap;
	base?: SideEntry;
	mine?: SideEntry;
	theirs?: SideEntry;
	/** The mode a combined file gets, for `text`, `binary`, and `edit-delete`. */
	mode?: string;
	/** For `file-folder`: where git put the file, beside the folder. */
	movedPath?: string;
}

export interface MergeResult { tree: string; plans: OverlapPlan[] }

/** A resolution that cannot be applied to its overlap (a choice the kind does not allow, or a path that cannot be used). */
export class ResolutionRefused extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ResolutionRefused';
	}
}

/** Runs git in the project root and throws when it exits with an error. */
async function git(ports: EnginePorts, args: string[], options?: Parameters<EnginePorts['git']>[1]): Promise<string> {
	return (await mustGit(ports.git, ['-C', ports.projectRoot, ...args], options)).stdout;
}

/** A commit that exists only in the object database, as an input to `git merge-tree`. */
export async function temporaryCommit(ports: EnginePorts, tree: string, parents: string[]): Promise<string> {
	const date = ports.now().toISOString();
	return (await git(ports, ['commit-tree', '--no-gpg-sign', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', 'Positron Checkpoints input'], {
		env: { ...TEMPORARY_IDENTITY, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
	})).trim();
}

/**
 * Parses the `-z` output of `git merge-tree --write-tree`: the tree id; then, when there are
 * conflicts, one field per conflicted entry (`<mode> <oid> <stage>\t<path>`) and an empty field;
 * then one record per message (`<count>`, that many paths, the conflict type, the text), and a
 * final empty field.
 */
export function parseMergeOutput(stdout: string): ParsedMerge {
	const fields = stdout.split('\0');
	const parsed: ParsedMerge = { tree: fields[0].trim(), stages: new Map(), messages: [] };
	let index = 1;
	for (; index < fields.length && fields[index] !== ''; index++) {
		const match = /^(?<mode>\d+) (?<oid>[0-9a-f]+) (?<stage>[123])\t(?<path>[\s\S]*)$/.exec(fields[index]);
		if (match?.groups === undefined) {
			throw new Error(`unreadable conflicted entry from git merge-tree: ${fields[index]}`);
		}
		const entry = parsed.stages.get(match.groups.path) ?? new Map<number, StageEntry>();
		entry.set(Number(match.groups.stage), { mode: match.groups.mode, oid: match.groups.oid });
		parsed.stages.set(match.groups.path, entry);
	}
	for (index++; index < fields.length && fields[index] !== '';) {
		const count = Number(fields[index++]);
		if (!Number.isInteger(count) || count < 0) {
			throw new Error(`unreadable message from git merge-tree: ${fields[index - 1]}`);
		}
		const paths = fields.slice(index, index + count);
		index += count;
		parsed.messages.push({ paths, type: fields[index++] ?? '', text: (fields[index++] ?? '').trim() });
	}
	return parsed;
}

/**
 * Runs `git merge-tree --write-tree -z --merge-base=<base> <ours> <theirs>` in the object
 * database and describes each overlap (spec 6.4). `oursSide` says whose work `ours` is.
 * `authorOf` names the incoming author of the given paths, for `theirAuthor`. A failure of git
 * (any exit code other than 0 or 1) throws.
 */
export async function mergeTrees(
	ports: EnginePorts,
	input: { base: string; ours: string; theirs: string; oursSide: Side; authorOf: (paths: string[]) => Promise<string> },
): Promise<MergeResult> {
	const args = ['-C', ports.projectRoot, 'merge-tree', '--write-tree', '-z', `--merge-base=${input.base}`, input.ours, input.theirs];
	const result = await runGit(ports.git, args, { timeoutMs: STAGING_TIMEOUT_MS });
	if (result.exitCode !== 0 && result.exitCode !== 1) {
		throw new GitFailedError(args, result.exitCode, result.stderr);
	}
	const parsed = parseMergeOutput(result.stdout);
	if (result.exitCode === 0) {
		return { tree: parsed.tree, plans: [] };
	}
	const plans: OverlapPlan[] = [];
	const commits = { ours: input.ours, theirs: input.theirs };
	for (const group of groupMessages(parsed)) {
		plans.push(await describeGroup(ports, parsed, group, input.oursSide, commits, input.authorOf));
	}
	return { tree: parsed.tree, plans };
}

interface Group { paths: string[]; messages: MergeMessage[]; mixed: boolean }

/**
 * Groups the conflict messages into overlaps. Messages claim paths in `PRIORITY` order (other
 * types last); a message that names a claimed path joins that group, and one that names paths of
 * two groups joins them into one group that is `mixed`. A conflicted path no message names is a
 * group of its own.
 */
function groupMessages(parsed: ParsedMerge): Group[] {
	const rank = (type: string) => {
		const position = PRIORITY.indexOf(type);
		return position === -1 ? PRIORITY.length : position;
	};
	const conflicts = parsed.messages.filter(message => message.type.startsWith('CONFLICT')).sort((left, right) => rank(left.type) - rank(right.type));
	const groups: Group[] = [];
	for (const message of conflicts) {
		const touched = groups.filter(group => message.paths.some(file => group.paths.includes(file)));
		if (touched.length === 0) {
			groups.push({ paths: [...message.paths], messages: [message], mixed: false });
			continue;
		}
		const [first, ...others] = touched;
		for (const other of others) {
			first.paths.push(...other.paths.filter(file => !first.paths.includes(file)));
			first.messages.push(...other.messages);
			first.mixed = true;
			groups.splice(groups.indexOf(other), 1);
		}
		first.paths.push(...message.paths.filter(file => !first.paths.includes(file)));
		first.messages.push(message);
	}
	for (const file of parsed.stages.keys()) {
		if (!groups.some(group => group.paths.includes(file))) {
			groups.push({ paths: [file], messages: [], mixed: false });
		}
	}
	return groups;
}

/** The mode git gives a file both sides changed: the side that changed it, or the shared one. Undefined when the two changed it differently. */
function mergedMode(base: string | undefined, mine: string | undefined, theirs: string | undefined): string | undefined {
	if (mine === undefined || theirs === undefined || mine === theirs) {
		return mine ?? theirs;
	}
	if (base === mine) {
		return theirs;
	}
	return base === theirs ? mine : undefined;
}

/** Describes one group as an overlap of the kind its first message gives (spec 6.4), or `unsupported`. */
async function describeGroup(
	ports: EnginePorts, parsed: ParsedMerge, group: Group, oursSide: Side, commits: { ours: string; theirs: string },
	authorOf: (paths: string[]) => Promise<string>,
): Promise<OverlapPlan> {
	const sideOf = (stage: number): 'base' | Side => stage === 1 ? 'base' : (stage === 2) === (oursSide === 'mine') ? 'mine' : 'theirs';
	const entryAt = (file: string, side: 'base' | Side): SideEntry | undefined => {
		for (const [stage, entry] of parsed.stages.get(file) ?? []) {
			if (sideOf(stage) === side) {
				return { path: file, ...entry };
			}
		}
		return undefined;
	};
	const primary = group.messages[0];
	const regular = group.paths.every(file => [...(parsed.stages.get(file)?.values() ?? [])].every(entry => entry.mode === '100644' || entry.mode === '100755'));
	const joinsCleanly = primary !== undefined && group.messages.slice(1).every(message => (JOINS[primary.type] ?? []).includes(message.type));
	const detail = group.messages.map(message => message.text).join('\n');

	let plan: Omit<OverlapPlan, 'overlap'> & { kind: OverlapKind; path: string; otherPaths: string[]; deletedBy?: 'me' | 'them'; fileSide?: Side } | undefined;
	if (primary !== undefined && regular && joinsCleanly && !group.mixed) {
		plan = classify(primary, entryAt, parsed);
	}
	if (plan === undefined) {
		const [path, ...otherPaths] = group.paths;
		plan = { kind: 'unsupported', path, otherPaths, base: entryAt(path, 'base'), mine: entryAt(path, 'mine'), theirs: entryAt(path, 'theirs') };
	}

	const { kind, path, otherPaths, deletedBy, fileSide, ...sides } = plan;
	const overlap: Overlap = { id: '', kind, path, otherPaths, theirAuthor: await authorOf([path, ...otherPaths]), detail };
	if (deletedBy !== undefined) {
		overlap.deletedBy = deletedBy;
	}
	if (fileSide !== undefined) {
		overlap.fileSide = fileSide;
	}
	if (kind !== 'unsupported') {
		await describeContent(ports, overlap, sides);
	}
	let folderTree: string | undefined;
	if (kind === 'file-folder') {
		const folderSide: Side = fileSide === 'mine' ? 'theirs' : 'mine';
		folderTree = await treeAt(ports, folderSide === oursSide ? commits.ours : commits.theirs, path);
	}
	// The kind, the three blobs, and a file-folder overlap's folder identify what the person reviewed (spec 6.4).
	overlap.id = createHash('sha256')
		.update(`${overlap.kind}\0${path}\0${sides.base?.oid ?? ''}\0${sides.mine?.oid ?? ''}\0${sides.theirs?.oid ?? ''}\0${folderTree ?? ''}`)
		.digest('hex').slice(0, 16);
	return { overlap, ...sides };
}

/** The id of the tree at `folder` in `commit`, or an empty string when `commit` has no folder there. */
async function treeAt(ports: EnginePorts, commit: string, folder: string): Promise<string> {
	const output = await git(ports, ['--literal-pathspecs', 'ls-tree', '-z', commit, '--', folder]);
	for (const line of splitZ(output)) {
		const match = /^\d+ tree (?<oid>\w+)\t(?<file>[\s\S]*)$/.exec(line);
		if (match?.groups !== undefined && match.groups.file === folder) {
			return match.groups.oid;
		}
	}
	return '';
}

/** The kind and sides of a group whose first message is `primary`, or undefined when the engine does not recognize it. */
function classify(
	primary: MergeMessage,
	entryAt: (file: string, side: 'base' | Side) => SideEntry | undefined,
	parsed: ParsedMerge,
): (Omit<OverlapPlan, 'overlap'> & { kind: OverlapKind; path: string; otherPaths: string[]; deletedBy?: 'me' | 'them'; fileSide?: Side }) | undefined {
	const present = (file: string) => ({ base: entryAt(file, 'base'), mine: entryAt(file, 'mine'), theirs: entryAt(file, 'theirs') });
	switch (primary.type) {
		case FILE_FOLDER: {
			// `<where git put the file>`, `<the path both use>`.
			const [movedPath, path] = primary.paths;
			const { base, mine, theirs } = present(movedPath);
			if (path === undefined || (mine === undefined) === (theirs === undefined)) {
				return undefined;
			}
			return { kind: 'file-folder', path, otherPaths: [], base, mine, theirs, movedPath, fileSide: mine !== undefined ? 'mine' : 'theirs' };
		}
		case RENAME_RENAME: {
			// `<original>`, `<name on stage 2>`, `<name on stage 3>`.
			const [original, ...renamed] = primary.paths;
			const base = entryAt(original, 'base');
			const mine = renamed.map(file => entryAt(file, 'mine')).find(entry => entry !== undefined);
			const theirs = renamed.map(file => entryAt(file, 'theirs')).find(entry => entry !== undefined);
			if (base === undefined || mine === undefined || theirs === undefined) {
				return undefined;
			}
			return { kind: 'rename', path: original, otherPaths: [mine.path, theirs.path], base, mine, theirs };
		}
		case RENAME_DELETE: {
			// `<new name>`, `<original>`.
			const [renamedPath, original] = primary.paths;
			const { base, mine, theirs } = present(renamedPath);
			if (original === undefined || (mine === undefined) === (theirs === undefined)) {
				return undefined;
			}
			return { kind: 'rename', path: original, otherPaths: [renamedPath], base, mine, theirs, deletedBy: mine === undefined ? 'me' : 'them' };
		}
		case MODIFY_DELETE: {
			const [path] = primary.paths;
			const { base, mine, theirs } = present(path);
			if (base === undefined || (mine === undefined) === (theirs === undefined)) {
				return undefined;
			}
			return { kind: 'edit-delete', path, otherPaths: [], base, mine, theirs, mode: (mine ?? theirs)!.mode, deletedBy: mine === undefined ? 'me' : 'them' };
		}
		case CONTENTS:
		case BINARY: {
			const [path] = primary.paths;
			const { base, mine, theirs } = present(path);
			const mode = mergedMode(base?.mode, mine?.mode, theirs?.mode);
			if (mine === undefined || theirs === undefined || mode === undefined) {
				return undefined;
			}
			// `describeContent` decides between text and binary.
			return { kind: 'text', path, otherPaths: [], base, mine, theirs, mode };
		}
		default:
			return undefined;
	}
}

/**
 * Fills the content of an overlap: when every side is text, `base` (empty for a `text` overlap
 * with no base), `mine`, and `theirs` as text; otherwise the sizes of mine and theirs. A `text`
 * overlap with a side that is not text becomes `binary`. A blob over `MAX_PATCH_FILE_BYTES`
 * counts as not text and is never read.
 */
async function describeContent(ports: EnginePorts, overlap: Overlap, sides: { base?: SideEntry; mine?: SideEntry; theirs?: SideEntry }): Promise<void> {
	const read = async (entry: SideEntry | undefined) => {
		if (entry === undefined) {
			return undefined;
		}
		const sizeBytes = Number((await git(ports, ['cat-file', '-s', entry.oid])).trim());
		if (sizeBytes > MAX_PATCH_FILE_BYTES) {
			return { sizeBytes, text: undefined };
		}
		const bytes = Buffer.from(await git(ports, ['cat-file', 'blob', entry.oid], { binary: true }), 'latin1');
		return { sizeBytes, text: bytes.subarray(0, BINARY_PROBE_BYTES).includes(0) ? undefined : bytes.toString('utf8') };
	};
	const [base, mine, theirs] = [await read(sides.base), await read(sides.mine), await read(sides.theirs)];
	const allText = [base, mine, theirs].every(side => side === undefined || side.text !== undefined);
	if (overlap.kind === 'text' && !allText) {
		overlap.kind = 'binary';
	}
	if (allText) {
		if (base !== undefined || overlap.kind === 'text') {
			overlap.base = base?.text ?? '';
		}
		if (mine !== undefined) {
			overlap.mine = mine.text;
		}
		if (theirs !== undefined) {
			overlap.theirs = theirs.text;
		}
		return;
	}
	if (mine !== undefined) {
		overlap.mineSizeBytes = mine.sizeBytes;
	}
	if (theirs !== undefined) {
		overlap.theirsSizeBytes = theirs.sizeBytes;
	}
}

/**
 * Applies `resolutions` to a merge result. A resolution whose `overlapId` matches no overlap is
 * ignored. Every resolution that matches an overlap is checked first: a choice the kind does not
 * allow (`ALLOWED_CHOICES`), a path to keep that is not one of the overlap's paths, a file-folder
 * file renamed on the side that has the folder, and a new name that is unsafe or already used
 * (see `checkNewPath`; `sideTrees` are the trees of both inputs), and a new name that another
 * choice also uses or that is a path of an overlap (`checkNewPathsDistinct`) throw `ResolutionRefused`. When
 * an overlap has no resolution, the result is undefined. Otherwise the conflicted entries are
 * replaced in a temporary index that starts from the merge result, and the written tree is
 * returned. Replacement text is stored exactly as given, with no filter.
 */
export async function resolveMerge(ports: EnginePorts, merge: MergeResult, resolutions: Resolution[], sideTrees: string[]): Promise<string | undefined> {
	if (merge.plans.length === 0) {
		return merge.tree;
	}
	const chosen = merge.plans.map(plan => ({ plan, choice: resolutions.find(resolution => resolution.overlapId === plan.overlap.id)?.choice }));
	for (const { plan, choice } of chosen) {
		if (choice !== undefined) {
			await checkChoice(ports, plan, choice, [merge.tree, ...sideTrees]);
		}
	}
	await checkNewPathsDistinct(ports, merge.plans, chosen.map(({ choice }) => choice));
	if (chosen.some(({ choice }) => choice === undefined)) {
		return undefined;
	}

	const removals: string[] = [];
	const folders: string[] = [];
	const additions: SideEntry[] = [];
	for (const { plan, choice } of chosen) {
		await planChoice(ports, plan, choice!, { removals, folders, additions });
	}
	const zero = '0'.repeat(merge.tree.length);
	return withTempIndex(ports, async env => {
		await git(ports, ['read-tree', merge.tree], { env });
		for (const folder of folders) {
			removals.push(...splitZ(await git(ports, ['ls-files', '-z', '--cached', '--', `:(literal)${folder}/`], { env })));
		}
		if (removals.length > 0) {
			await git(ports, ['update-index', '-z', '--index-info'], { env, stdin: removals.map(file => `0 ${zero}\t${file}\0`).join('') });
		}
		if (additions.length > 0) {
			await git(ports, ['update-index', '-z', '--index-info'], { env, stdin: additions.map(entry => `${entry.mode} ${entry.oid}\t${entry.path}\0`).join('') });
		}
		return (await git(ports, ['write-tree'], { env })).trim();
	});
}

/** Throws `ResolutionRefused` when `choice` cannot resolve `plan` (see `resolveMerge`). */
async function checkChoice(ports: EnginePorts, plan: OverlapPlan, choice: OverlapChoice, trees: string[]): Promise<void> {
	const { overlap } = plan;
	if (!ALLOWED_CHOICES[overlap.kind].includes(choice.type)) {
		throw new ResolutionRefused(`a ${overlap.kind} overlap cannot be resolved with ${choice.type}`);
	}
	// Taking the folder side of a file-folder overlap keeps the folder, which has no entry here.
	if (choice.type === 'take' && overlap.kind !== 'file-folder' && plan[choice.side] === undefined) {
		throw new ResolutionRefused(`${overlap.path} has no ${choice.side} side to take`);
	}
	if (choice.type === 'path') {
		if (![overlap.path, ...overlap.otherPaths].includes(choice.keepPath)) {
			throw new ResolutionRefused(`${choice.keepPath} is not a path of the overlap at ${overlap.path}`);
		}
		if (contentAt(plan, choice.keepPath) === undefined) {
			throw new ResolutionRefused(`the two versions of ${overlap.path} differ, so the original path cannot be kept`);
		}
	}
	if (choice.type === 'keep-both') {
		if (overlap.kind === 'file-folder' && choice.renamedSide !== overlap.fileSide) {
			throw new ResolutionRefused(`the ${choice.renamedSide} side of ${overlap.path} is a folder`);
		}
		if (plan[choice.renamedSide] === undefined) {
			throw new ResolutionRefused(`${overlap.path} has no ${choice.renamedSide} side`);
		}
		await checkNewPath(ports, choice.newPath, trees);
	}
}

/**
 * Throws `ResolutionRefused` when `newPath` is empty, absolute, has a backslash, an empty, `.`,
 * or `..` segment, or a `.git` segment (in any letter case), or when any of `trees` has something
 * at `newPath` or a file at a folder above it.
 */
async function checkNewPath(ports: EnginePorts, newPath: string, trees: string[]): Promise<void> {
	const segments = newPath.split('/');
	if (newPath === '' || newPath.startsWith('/') || newPath.includes('\\') || /^[A-Za-z]:/.test(newPath)
		|| segments.some(segment => segment === '' || segment === '.' || segment === '..' || segment.toLowerCase() === '.git')) {
		throw new ResolutionRefused(`${newPath} cannot be used as a new name`);
	}
	const prefixes = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
	for (const tree of trees) {
		const output = await git(ports, ['--literal-pathspecs', 'ls-tree', '-z', tree, '--', ...prefixes]);
		for (const line of splitZ(output)) {
			const match = /^\d+ (?<type>\w+) \w+\t(?<file>[\s\S]*)$/.exec(line);
			if (match?.groups !== undefined && (match.groups.file === newPath || (match.groups.type !== 'tree' && prefixes.includes(match.groups.file)))) {
				throw new ResolutionRefused(`${newPath} is already used`);
			}
		}
	}
}

/**
 * Throws `ResolutionRefused` when two `keep-both` choices use one new name, or a new name is a
 * path of any overlap of `plans`. On a file system that ignores letter case, names that differ
 * only in case count as one.
 */
async function checkNewPathsDistinct(ports: EnginePorts, plans: OverlapPlan[], choices: (OverlapChoice | undefined)[]): Promise<void> {
	const newPaths = choices.flatMap(choice => choice?.type === 'keep-both' ? [choice.newPath] : []);
	if (newPaths.length === 0) {
		return;
	}
	const key = await ports.files.caseInsensitive() ? (file: string) => file.toLowerCase() : (file: string) => file;
	const overlapPaths = new Set(plans.flatMap(plan => [plan.overlap.path, ...plan.overlap.otherPaths]).map(key));
	const seen = new Set<string>();
	for (const newPath of newPaths) {
		if (seen.has(key(newPath)) || overlapPaths.has(key(newPath))) {
			throw new ResolutionRefused(`${newPath} is used by another overlap`);
		}
		seen.add(key(newPath));
	}
}

/** The content a `rename` overlap gets at `keepPath`: the side named there, or at the original path the one version both sides have. */
function contentAt(plan: OverlapPlan, keepPath: string): SideEntry | undefined {
	if (plan.mine?.path === keepPath && plan.mine.path !== plan.overlap.path) {
		return plan.mine;
	}
	if (plan.theirs?.path === keepPath && plan.theirs.path !== plan.overlap.path) {
		return plan.theirs;
	}
	if (plan.mine === undefined || plan.theirs === undefined) {
		return plan.mine ?? plan.theirs;
	}
	return plan.mine.oid === plan.theirs.oid && plan.mine.mode === plan.theirs.mode ? plan.mine : undefined;
}

/** Adds the index changes of one checked choice to `changes`. */
async function planChoice(
	ports: EnginePorts, plan: OverlapPlan, choice: OverlapChoice, changes: { removals: string[]; folders: string[]; additions: SideEntry[] },
): Promise<void> {
	const { overlap } = plan;
	const at = (entry: SideEntry, file: string, mode = entry.mode): SideEntry => ({ path: file, mode, oid: entry.oid });
	switch (choice.type) {
		case 'text': {
			const oid = (await git(ports, ['hash-object', '-w', '--no-filters', '--stdin'], { stdin: Buffer.from(choice.content, 'utf8') })).trim();
			changes.additions.push({ path: overlap.path, mode: plan.mode!, oid });
			return;
		}
		case 'take': {
			if (overlap.kind === 'file-folder') {
				changes.removals.push(plan.movedPath!);
				if (choice.side === overlap.fileSide) {
					changes.folders.push(overlap.path);
					changes.additions.push(at(plan[choice.side]!, overlap.path));
				}
				return;
			}
			changes.additions.push(at(plan[choice.side]!, overlap.path));
			return;
		}
		case 'keep-both': {
			const renamed = plan[choice.renamedSide]!;
			if (overlap.kind === 'file-folder') {
				changes.removals.push(plan.movedPath!);
			} else {
				const kept = plan[choice.renamedSide === 'mine' ? 'theirs' : 'mine']!;
				changes.additions.push(at(kept, overlap.path));
			}
			changes.additions.push(at(renamed, choice.newPath));
			return;
		}
		case 'keep-file':
			changes.additions.push(at((plan.mine ?? plan.theirs)!, overlap.path, plan.mode));
			return;
		case 'accept-deletion':
			changes.removals.push(overlap.path);
			return;
		case 'path': {
			const content = contentAt(plan, choice.keepPath)!;
			changes.removals.push(...[overlap.path, ...overlap.otherPaths].filter(file => file !== choice.keepPath));
			changes.additions.push(at(content, choice.keepPath));
			return;
		}
	}
}
