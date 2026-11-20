/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChangedFile, IChunk } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { CHECKPOINT_TITLE_LIMIT } from '../../common/checkpointsLimits.js';

// The state of the checkpoint dialog before it is submitted: the chunks the person is arranging,
// the files and parts of files in each, and what is ticked. Every function returns a new draft and
// leaves its argument unchanged.
//
// The parts (hunks) of a text file can be spread over several chunks, and every hunk is in exactly
// one chunk. A file without hunks is in exactly one chunk. A chunk lists a file at most once.

/** A file in a chunk: the hunks of the file the chunk holds, and whether the chunk takes them. */
export interface IDraftFile {
	path: string;
	ticked: boolean;
	/** The hunks of this file in this chunk, in the order of the file. Empty for a file without hunks. */
	hunkIds: string[];
}

/** A chunk being arranged. `id` is stable while files move between chunks. */
export interface IDraftChunk {
	id: number;
	title: string;
	body: string;
	/** An unticked chunk makes no checkpoint, whatever it holds. */
	ticked: boolean;
	files: IDraftFile[];
}

export interface IChunkDraft {
	chunks: IDraftChunk[];
	nextId: number;
	/** The hunk ids of every changed file, in the order of the file. */
	hunksByPath: ReadonlyMap<string, readonly string[]>;
}

/** A starting chunk: a chunk for the engine, and whether it starts ticked (it does by default). */
export interface IInitialChunk extends IChunk {
	ticked?: boolean;
}

/** Why a title cannot be used. */
export type TitleProblem = 'empty' | 'too-long';

/** A file is ticked at the start unless it is over the size limit. */
function startsTicked(file: IChangedFile): boolean {
	return !file.tooLarge;
}

function hunksByPathOf(files: readonly IChangedFile[]): Map<string, readonly string[]> {
	return new Map(files.map(file => [file.path, file.hunks.map(hunk => hunk.id)]));
}

/** `ids` in the order of `order`, without repeats. */
function inOrder(ids: Iterable<string>, order: readonly string[]): string[] {
	const wanted = new Set(ids);
	return order.filter(id => wanted.has(id));
}

/** Puts `entry` into `chunk`, joining an entry for the same file, which keeps its tick. */
function addEntry(chunk: IDraftChunk, entry: IDraftFile, order: readonly string[]): IDraftChunk {
	const existing = chunk.files.find(file => file.path === entry.path);
	if (!existing) {
		return { ...chunk, files: [...chunk.files, entry] };
	}
	const joined = { ...existing, hunkIds: inOrder([...existing.hunkIds, ...entry.hunkIds], order) };
	return { ...chunk, files: chunk.files.map(file => file === existing ? joined : file) };
}

/**
 * Tracks which hunks and which files without hunks a chunk already holds, so that each is placed
 * once.
 */
class Placements {
	private readonly _hunks = new Set<string>();
	private readonly _files = new Set<string>();

	constructor(private readonly _hunksByPath: ReadonlyMap<string, readonly string[]>) { }

	/**
	 * Marks the given hunks of `path` as placed (all of them for a file without hunks), and
	 * returns those that were not placed before. A file without hunks returns an empty list the
	 * first time and undefined after that.
	 */
	place(path: string, hunkIds: readonly string[]): string[] | undefined {
		if ((this._hunksByPath.get(path) ?? []).length === 0) {
			if (this._files.has(path)) {
				return undefined;
			}
			this._files.add(path);
			return [];
		}
		const fresh = hunkIds.filter(id => !this._hunks.has(id));
		fresh.forEach(id => this._hunks.add(id));
		return fresh;
	}

	/**
	 * What no chunk holds of `path`: its unplaced hunks, an empty list for an unplaced file without
	 * hunks, or undefined when nothing is left.
	 */
	unplaced(path: string): string[] | undefined {
		const ids = this._hunksByPath.get(path) ?? [];
		if (ids.length === 0) {
			return this._files.has(path) ? undefined : [];
		}
		const left = ids.filter(id => !this._hunks.has(id));
		return left.length > 0 ? left : undefined;
	}
}

/**
 * The first draft. Without `initialChunks`, one ticked chunk holds every file. With them, each
 * chunk holds its whole files and its hunks (grouped by file), and is ticked unless it says
 * otherwise. A hunk or file named twice stays in the first chunk that names it, and unknown names
 * are left out. What no chunk names goes unticked into the first chunk, or joins the entry of its
 * file there. A file over the size limit is unticked either way.
 */
export function createDraft(files: IChangedFile[], initialChunks?: IInitialChunk[]): IChunkDraft {
	const hunksByPath = hunksByPathOf(files);
	if (!initialChunks || initialChunks.length === 0) {
		return {
			chunks: [{
				id: 1, title: '', body: '', ticked: true,
				files: files.map(file => ({ path: file.path, ticked: startsTicked(file), hunkIds: [...hunksByPath.get(file.path)!] })),
			}],
			nextId: 2,
			hunksByPath,
		};
	}

	const byPath = new Map(files.map(file => [file.path, file]));
	const pathOfHunk = new Map(files.flatMap(file => file.hunks.map(hunk => [hunk.id, file.path] as const)));
	const placements = new Placements(hunksByPath);

	let chunks = initialChunks.map((chunk, index): IDraftChunk => {
		let draftChunk: IDraftChunk = { id: index + 1, title: chunk.title, body: chunk.body, ticked: chunk.ticked ?? true, files: [] };
		const take = (path: string, ids: readonly string[]) => {
			const fresh = placements.place(path, ids);
			if (fresh !== undefined && (fresh.length > 0 || ids.length === 0)) {
				draftChunk = addEntry(draftChunk, { path, ticked: startsTicked(byPath.get(path)!), hunkIds: fresh }, hunksByPath.get(path)!);
			}
		};
		for (const path of chunk.wholeFiles) {
			const ids = hunksByPath.get(path);
			if (ids !== undefined) {
				take(path, ids);
			}
		}
		for (const id of chunk.hunkIds) {
			const path = pathOfHunk.get(id);
			if (path !== undefined) {
				take(path, [id]);
			}
		}
		return draftChunk;
	});

	for (const file of files) {
		const unplaced = placements.unplaced(file.path);
		if (unplaced !== undefined) {
			chunks = chunks.map((chunk, index) => index === 0 ? addEntry(chunk, { path: file.path, ticked: false, hunkIds: unplaced }, hunksByPath.get(file.path)!) : chunk);
		}
	}
	return { chunks, nextId: chunks.length + 1, hunksByPath };
}

/**
 * Moves what one chunk holds of a file to another chunk. It keeps its tick, unless the other chunk
 * already holds part of the file; then the parts join that entry. An unknown path or chunk
 * changes nothing.
 */
export function moveFile(draft: IChunkDraft, fromChunkId: number, path: string, toChunkId: number): IChunkDraft {
	const source = draft.chunks.find(chunk => chunk.id === fromChunkId);
	const target = draft.chunks.find(chunk => chunk.id === toChunkId);
	const moved = source?.files.find(file => file.path === path);
	if (!source || !target || !moved || source === target) {
		return draft;
	}
	const order = draft.hunksByPath.get(path) ?? [];
	return {
		...draft,
		chunks: draft.chunks.map(chunk => {
			if (chunk === source) {
				return { ...chunk, files: chunk.files.filter(file => file !== moved) };
			}
			if (chunk === target) {
				return addEntry(chunk, moved, order);
			}
			return chunk;
		}),
	};
}

/**
 * Moves one hunk to another chunk. There it joins the entry of its file, or starts one with the
 * tick of the entry it left. An entry left with no hunks goes away. An unknown hunk or chunk
 * changes nothing.
 */
export function moveHunk(draft: IChunkDraft, hunkId: string, toChunkId: number): IChunkDraft {
	const source = draft.chunks.find(chunk => chunk.files.some(file => file.hunkIds.includes(hunkId)));
	const target = draft.chunks.find(chunk => chunk.id === toChunkId);
	if (!source || !target || source === target) {
		return draft;
	}
	const from = source.files.find(file => file.hunkIds.includes(hunkId))!;
	const order = draft.hunksByPath.get(from.path) ?? [];
	const left = { ...from, hunkIds: from.hunkIds.filter(id => id !== hunkId) };
	return {
		...draft,
		chunks: draft.chunks.map(chunk => {
			if (chunk === source) {
				return {
					...chunk,
					files: left.hunkIds.length > 0 ? chunk.files.map(file => file === from ? left : file) : chunk.files.filter(file => file !== from),
				};
			}
			if (chunk === target) {
				return addEntry(chunk, { path: from.path, ticked: from.ticked, hunkIds: [hunkId] }, order);
			}
			return chunk;
		}),
	};
}

/** Adds an empty, ticked chunk after the others. */
export function addChunk(draft: IChunkDraft): IChunkDraft {
	return {
		...draft,
		chunks: [...draft.chunks, { id: draft.nextId, title: '', body: '', ticked: true, files: [] }],
		nextId: draft.nextId + 1,
	};
}

/** Ticks or unticks a chunk. */
export function setChunkTicked(draft: IChunkDraft, chunkId: number, ticked: boolean): IChunkDraft {
	return {
		...draft,
		chunks: draft.chunks.map(chunk => chunk.id === chunkId ? { ...chunk, ticked } : chunk),
	};
}

/** Ticks or unticks what one chunk holds of a file. */
export function setFileTicked(draft: IChunkDraft, chunkId: number, path: string, ticked: boolean): IChunkDraft {
	return {
		...draft,
		chunks: draft.chunks.map(chunk => chunk.id === chunkId
			? { ...chunk, files: chunk.files.map(file => file.path === path ? { ...file, ticked } : file) }
			: chunk),
	};
}

/** Replaces the title or the body of a chunk. */
export function setChunkText(draft: IChunkDraft, chunkId: number, text: { title?: string; body?: string }): IChunkDraft {
	return {
		...draft,
		chunks: draft.chunks.map(chunk => chunk.id === chunkId ? { ...chunk, ...text } : chunk),
	};
}

/**
 * Fits a draft to a newer list of changed files, for the case where files were saved after the
 * person arranged the chunks. A file or hunk that is gone leaves its chunk. A new hunk of a known
 * file joins the first chunk that holds part of the file (or held it), with that entry's tick. A
 * new file goes into the first chunk, ticked unless it is over the size limit.
 */
export function reconcileDraft(draft: IChunkDraft, files: IChangedFile[]): IChunkDraft {
	const hunksByPath = hunksByPathOf(files);
	const byPath = new Map(files.map(file => [file.path, file]));
	// The first chunk that held each file, and the tick it had there.
	const firstHolder = new Map<string, { chunkId: number; ticked: boolean }>();
	for (const chunk of draft.chunks) {
		for (const file of chunk.files) {
			if (!firstHolder.has(file.path)) {
				firstHolder.set(file.path, { chunkId: chunk.id, ticked: file.ticked });
			}
		}
	}

	const placements = new Placements(hunksByPath);
	let chunks = draft.chunks.map(chunk => ({
		...chunk,
		files: chunk.files.flatMap((file): IDraftFile[] => {
			const ids = hunksByPath.get(file.path);
			if (ids === undefined) {
				return [];
			}
			const kept = placements.place(file.path, file.hunkIds.filter(id => ids.includes(id)));
			if (kept === undefined || (ids.length > 0 && kept.length === 0)) {
				return [];
			}
			return [{ ...file, hunkIds: kept }];
		}),
	}));
	if (chunks.length === 0) {
		return { ...draft, chunks, hunksByPath };
	}

	for (const file of files) {
		const unplaced = placements.unplaced(file.path);
		if (unplaced === undefined) {
			continue;
		}
		const before = firstHolder.get(file.path);
		const holder = chunks.find(chunk => chunk.files.some(entry => entry.path === file.path))
			?? chunks.find(chunk => chunk.id === before?.chunkId)
			?? chunks[0];
		const entry: IDraftFile = { path: file.path, ticked: before?.ticked ?? startsTicked(byPath.get(file.path)!), hunkIds: unplaced };
		chunks = chunks.map(chunk => chunk === holder ? addEntry(chunk, entry, hunksByPath.get(file.path)!) : chunk);
	}
	return { ...draft, chunks, hunksByPath };
}

/** The paths of every file in the draft, ticked or not. */
export function draftPaths(draft: IChunkDraft): Set<string> {
	return new Set(draft.chunks.flatMap(chunk => chunk.files.map(file => file.path)));
}

/** The paths of the files of which the chunk holds only some hunks; other chunks hold the rest. */
export function partialPaths(draft: IChunkDraft, chunk: IDraftChunk): string[] {
	return chunk.files
		.filter(file => file.hunkIds.length > 0 && file.hunkIds.length < (draft.hunksByPath.get(file.path)?.length ?? 0))
		.map(file => file.path);
}

/** What is wrong with a title, or undefined when it can be used. The title is measured trimmed. */
export function titleProblem(title: string): TitleProblem | undefined {
	const length = title.trim().length;
	if (length === 0) {
		return 'empty';
	}
	return length > CHECKPOINT_TITLE_LIMIT ? 'too-long' : undefined;
}

/** True when the chunk is ticked and has at least one ticked file, so it makes a checkpoint. */
export function chunkIsUsed(chunk: IDraftChunk): boolean {
	return chunk.ticked && chunk.files.some(file => file.ticked);
}

/** The number of chunks that make a checkpoint. */
export function usedChunkCount(draft: IChunkDraft): number {
	return draft.chunks.filter(chunkIsUsed).length;
}

/** True when at least one chunk is used and every used chunk has a usable title. */
export function isDraftReady(draft: IChunkDraft): boolean {
	const used = draft.chunks.filter(chunkIsUsed);
	return used.length > 0 && used.every(chunk => titleProblem(chunk.title) === undefined);
}

/**
 * The chunks to send to the engine, in order. Unused chunks and unticked files are left out and
 * text is trimmed. A file whose hunks are all in the chunk, or that has no hunks, is sent in
 * `wholeFiles`; a file of which the chunk holds only some hunks is sent as those hunk ids.
 */
export function toChunks(draft: IChunkDraft): IChunk[] {
	return draft.chunks.filter(chunkIsUsed).map(chunk => {
		const partial = new Set(partialPaths(draft, chunk));
		const ticked = chunk.files.filter(file => file.ticked);
		return {
			title: chunk.title.trim(),
			body: chunk.body.trim(),
			hunkIds: ticked.filter(file => partial.has(file.path)).flatMap(file => file.hunkIds),
			wholeFiles: ticked.filter(file => !partial.has(file.path)).map(file => file.path),
		};
	});
}
