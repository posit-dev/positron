/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChangedFile, IChunk } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { CHECKPOINT_TITLE_LIMIT } from '../../common/checkpointsLimits.js';

// The state of the checkpoint dialog before it is submitted: the chunks the person is arranging,
// the files in each, and which files are ticked. Every function returns a new draft and leaves
// its argument unchanged. A chunk holds whole files and, for moves of part of a file, hunk ids
// that pass through unchanged.

/** A file in a chunk, and whether the chunk takes it. */
export interface IDraftFile {
	path: string;
	ticked: boolean;
}

/** A chunk being arranged. `id` is stable while files move between chunks. */
export interface IDraftChunk {
	id: number;
	title: string;
	body: string;
	files: IDraftFile[];
	hunkIds: string[];
}

export interface IChunkDraft {
	chunks: IDraftChunk[];
	nextId: number;
}

/** Why a title cannot be used. */
export type TitleProblem = 'empty' | 'too-long';

/** A file is ticked at the start unless it is over the size limit. */
function startsTicked(file: IChangedFile): boolean {
	return !file.tooLarge;
}

/**
 * The first draft. Without `initialChunks`, one chunk holds every file. With them, each chunk
 * holds its whole files ticked, and a file that no chunk names goes into the first chunk unticked.
 * A file over the size limit is unticked either way.
 */
export function createDraft(files: IChangedFile[], initialChunks?: IChunk[]): IChunkDraft {
	if (!initialChunks || initialChunks.length === 0) {
		return {
			chunks: [{ id: 1, title: '', body: '', files: files.map(file => ({ path: file.path, ticked: startsTicked(file) })), hunkIds: [] }],
			nextId: 2,
		};
	}

	const byPath = new Map(files.map(file => [file.path, file]));
	const named = new Set<string>();
	const chunks = initialChunks.map((chunk, index): IDraftChunk => {
		for (const path of chunk.wholeFiles) {
			named.add(path);
		}
		return {
			id: index + 1,
			title: chunk.title,
			body: chunk.body,
			files: chunk.wholeFiles.map(path => {
				const file = byPath.get(path);
				return { path, ticked: file ? startsTicked(file) : true };
			}),
			hunkIds: [...chunk.hunkIds],
		};
	});
	for (const file of files) {
		if (!named.has(file.path)) {
			chunks[0].files.push({ path: file.path, ticked: false });
		}
	}
	return { chunks, nextId: chunks.length + 1 };
}

/** Moves a file to another chunk. It keeps its tick. An unknown path or chunk changes nothing. */
export function moveFile(draft: IChunkDraft, path: string, toChunkId: number): IChunkDraft {
	const source = draft.chunks.find(chunk => chunk.files.some(file => file.path === path));
	const target = draft.chunks.find(chunk => chunk.id === toChunkId);
	if (!source || !target || source === target) {
		return draft;
	}
	const moved = source.files.find(file => file.path === path)!;
	return {
		...draft,
		chunks: draft.chunks.map(chunk => {
			if (chunk === source) {
				return { ...chunk, files: chunk.files.filter(file => file.path !== path) };
			}
			if (chunk === target) {
				return { ...chunk, files: [...chunk.files, moved] };
			}
			return chunk;
		}),
	};
}

/** Adds an empty chunk after the others. */
export function addChunk(draft: IChunkDraft): IChunkDraft {
	return {
		chunks: [...draft.chunks, { id: draft.nextId, title: '', body: '', files: [], hunkIds: [] }],
		nextId: draft.nextId + 1,
	};
}

/** Ticks or unticks a file in whichever chunk holds it. */
export function setFileTicked(draft: IChunkDraft, path: string, ticked: boolean): IChunkDraft {
	return {
		...draft,
		chunks: draft.chunks.map(chunk => chunk.files.some(file => file.path === path)
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
 * person arranged the chunks. A file that is gone leaves its chunk. A file that is new goes into
 * the first chunk, ticked unless it is over the size limit.
 */
export function reconcileDraft(draft: IChunkDraft, files: IChangedFile[]): IChunkDraft {
	const current = new Set(files.map(file => file.path));
	const known = new Set(draft.chunks.flatMap(chunk => chunk.files.map(file => file.path)));
	const chunks = draft.chunks.map(chunk => ({ ...chunk, files: chunk.files.filter(file => current.has(file.path)) }));
	if (chunks.length > 0) {
		for (const file of files) {
			if (!known.has(file.path)) {
				chunks[0] = { ...chunks[0], files: [...chunks[0].files, { path: file.path, ticked: startsTicked(file) }] };
			}
		}
	}
	return { ...draft, chunks };
}

/** What is wrong with a title, or undefined when it can be used. The title is measured trimmed. */
export function titleProblem(title: string): TitleProblem | undefined {
	const length = title.trim().length;
	if (length === 0) {
		return 'empty';
	}
	return length > CHECKPOINT_TITLE_LIMIT ? 'too-long' : undefined;
}

/** True when the chunk has at least one ticked file or any hunk, so it makes a checkpoint. */
export function chunkIsUsed(chunk: IDraftChunk): boolean {
	return chunk.hunkIds.length > 0 || chunk.files.some(file => file.ticked);
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

/** The chunks to send to the engine, in order. Unused chunks are left out and text is trimmed. */
export function toChunks(draft: IChunkDraft): IChunk[] {
	return draft.chunks.filter(chunkIsUsed).map(chunk => ({
		title: chunk.title.trim(),
		body: chunk.body.trim(),
		hunkIds: [...chunk.hunkIds],
		wholeFiles: chunk.files.filter(file => file.ticked).map(file => file.path),
	}));
}
