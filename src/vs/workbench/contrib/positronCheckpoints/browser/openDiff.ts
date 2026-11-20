/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ByteSize, IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { ContentRef, DiffTarget } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { LARGE_FILE_LIMIT_BYTES, LARGE_FILE_LIMIT_MEGABYTES } from '../common/checkpointsLimits.js';
import { Strings } from '../common/checkpointsStrings.js';
import { blobResource, messageResource } from './checkpointsContentProvider.js';
import { projectRootUri } from './projectRoot.js';

/** The number of leading bytes that are searched for a zero byte, which marks a data file. */
const BINARY_SNIFF_BYTES = 8000;

/** What opens: the two sides in the diff editor, or a message that says why they are not compared. */
type IComparison = { kind: 'sides'; left: IDiffSide; right: IDiffSide } | { kind: 'message'; message: string };

/** One side of a comparison: where the editor reads it, and what the content is like. */
interface IDiffSide {
	resource: URI;
	sizeBytes: number;
	binary: boolean;
}

/**
 * What the caller already knows about the two sides, in bytes. When either side is known to be
 * over the size limit, the comparison is not read at all.
 */
export interface IKnownSizes {
	/** True when the engine reported the file as over the size limit. */
	tooLarge?: boolean;
	before?: number;
	after?: number;
}

function looksBinary(bytes: VSBuffer): boolean {
	return bytes.slice(0, BINARY_SNIFF_BYTES).buffer.includes(0);
}

/**
 * Opens the line-by-line comparison of one file in the diff editor. The stored side is a
 * `positron-checkpoints` resource and the side on disk is the real file. A file that is a data
 * file, or is over the size limit, opens a text that states the sizes instead.
 *
 * `known` gives sizes the caller already has, such as those of a changed file, so that a side
 * over the size limit is never read just to measure it.
 *
 * Every service is read before the first await, because an accessor is valid only until then.
 */
export async function openDiff(accessor: ServicesAccessor, target: DiffTarget, title: string, known?: IKnownSizes): Promise<void> {
	const checkpointsService = accessor.get(ICheckpointsService);
	const editorService = accessor.get(IEditorService);
	const fileService = accessor.get(IFileService);
	const workspaceContextService = accessor.get(IWorkspaceContextService);

	const engine = checkpointsService.engine;
	if (!engine) {
		return;
	}

	const openComparison = async (): Promise<IComparison> => {
		const knownTooLarge = known !== undefined && (known.tooLarge === true
			|| [known.before, known.after].some(size => size !== undefined && size > LARGE_FILE_LIMIT_BYTES));
		if (knownTooLarge) {
			const formatKnown = (size: number | undefined) => size === undefined ? undefined : ByteSize.formatSize(size);
			const sizes = known.before === undefined && known.after === undefined
				? ''
				: Strings.diff.sizes(formatKnown(known.before), formatKnown(known.after));
			return { kind: 'message', message: Strings.diff.tooLargeMessage(target.path, LARGE_FILE_LIMIT_MEGABYTES, sizes).trim() };
		}

		const state = await engine.getState();
		const root = projectRootUri(workspaceContextService, state.projectRoot);
		const { left, right } = await engine.getDiff(target);

		const measureFile = async (ref: ContentRef & { kind: 'file' }): Promise<IDiffSide> => {
			const resource = joinPath(root, ref.path);
			try {
				const stat = await fileService.stat(resource);
				const head = stat.size > LARGE_FILE_LIMIT_BYTES ? VSBuffer.alloc(0) : (await fileService.readFile(resource, { length: BINARY_SNIFF_BYTES })).value;
				return { resource, sizeBytes: stat.size, binary: looksBinary(head) };
			} catch {
				return { resource, sizeBytes: 0, binary: false };
			}
		};
		const measureStored = async (ref: ContentRef & { kind: 'blob' | 'empty' }): Promise<IDiffSide> => {
			if (ref.kind === 'empty') {
				return { resource: blobResource(target.path, ''), sizeBytes: 0, binary: false };
			}
			const bytes = await engine.readBlob(ref.oid);
			return { resource: blobResource(target.path, ref.oid), sizeBytes: bytes.byteLength, binary: looksBinary(bytes) };
		};
		const tooLarge = (...measured: (IDiffSide | undefined)[]) => measured.some(side => side !== undefined && side.sizeBytes > LARGE_FILE_LIMIT_BYTES);
		const sizeOf = (side: IDiffSide | undefined) => side ? ByteSize.formatSize(side.sizeBytes) : undefined;

		// Files on disk are measured first, so that a file that is too large stops the comparison
		// before the stored side is read.
		const leftFile = left.kind === 'file' ? await measureFile(left) : undefined;
		const rightFile = right.kind === 'file' ? await measureFile(right) : undefined;
		if (tooLarge(leftFile, rightFile)) {
			return { kind: 'message', message: Strings.diff.tooLargeMessage(target.path, LARGE_FILE_LIMIT_MEGABYTES, Strings.diff.sizes(sizeOf(leftFile), sizeOf(rightFile))) };
		}

		const leftSide = leftFile ?? await measureStored(left as ContentRef & { kind: 'blob' | 'empty' });
		const rightSide = rightFile ?? await measureStored(right as ContentRef & { kind: 'blob' | 'empty' });
		const sizes = Strings.diff.sizes(sizeOf(leftSide), sizeOf(rightSide));
		if (tooLarge(leftSide, rightSide)) {
			return { kind: 'message', message: Strings.diff.tooLargeMessage(target.path, LARGE_FILE_LIMIT_MEGABYTES, sizes) };
		}
		if (leftSide.binary || rightSide.binary) {
			return { kind: 'message', message: Strings.diff.binaryMessage(target.path, sizes) };
		}
		return { kind: 'sides', left: leftSide, right: rightSide };
	};

	let sides: IComparison;
	try {
		sides = await openComparison();
	} catch {
		sides = { kind: 'message', message: Strings.diff.unavailable(target.path) };
	}

	if (sides.kind === 'message') {
		await editorService.openEditor({ resource: messageResource(target.path, sides.message), label: title, options: { pinned: true } });
		return;
	}
	await editorService.openEditor({
		original: { resource: sides.left.resource },
		modified: { resource: sides.right.resource },
		label: title,
	});
}
