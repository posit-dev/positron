/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ByteSize, IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ICheckpointsService } from '../../../services/positronCheckpoints/common/checkpointsService.js';
import { ContentRef, DiffTarget } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { LARGE_FILE_LIMIT_BYTES, STORED_SIDE_READ_LIMIT_BYTES } from '../common/checkpointsLimits.js';
import { Strings } from '../common/checkpointsStrings.js';
import { readFailureKind } from '../common/readFailure.js';
import { blobResource, messageResource } from './checkpointsContentProvider.js';
import { ICheckpointsMessageService } from './checkpointsMessages.js';
import { projectRootUri } from './projectRoot.js';
import { IRichDiffProvider, IRichDiffSides, richDiffRegistry } from './richDiff/richDiffRegistry.js';

/**
 * What `openDiff` compares. An overlap target names its overlap and not its file, so the caller
 * adds the path of the overlap's file, which names the comparison and chooses its editor.
 */
export type DiffRequest =
	| Exclude<DiffTarget, { kind: 'overlap' }>
	| (Extract<DiffTarget, { kind: 'overlap' }> & { path: string });

/** The engine's target of a request, without the path an overlap request adds. */
function engineTarget(request: DiffRequest): DiffTarget {
	return request.kind === 'overlap' ? { kind: 'overlap', overlapId: request.overlapId, side: request.side } : request;
}

/** The number of leading bytes that are searched for a zero byte, which marks a data file. */
const BINARY_SNIFF_BYTES = 8000;

/** What opens: the two sides in the diff editor, or a message that says why they are not compared. */
type IComparison =
	| { kind: 'sides'; left: IDiffSide; right: IDiffSide }
	| { kind: 'provider'; provider: IRichDiffProvider; sides: IRichDiffSides }
	| { kind: 'message'; message: string };

/** One side of a comparison: where the editor reads it, and what the content is like. */
interface IDiffSide {
	resource: URI;
	sizeBytes: number;
	binary: boolean;
	/** The whole content of a stored side. A side on disk is read only when a provider needs it. */
	bytes?: VSBuffer;
	/** Absent for an empty side (a new or removed file). */
	present: boolean;
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
	/**
	 * The most bytes a stored side may have. A stored side has no size before it is read, so it is
	 * read once and the comparison does not open when the content is larger. Defaults to
	 * `STORED_SIDE_READ_LIMIT_BYTES`.
	 */
	maxBytes?: number;
}

function looksBinary(bytes: VSBuffer): boolean {
	return bytes.slice(0, BINARY_SNIFF_BYTES).buffer.includes(0);
}

/**
 * Opens the comparison of one file. A file whose extension has a provider in `richDiffRegistry`
 * opens in the provider's editor. Any other file opens the line-by-line comparison in the diff
 * editor. The stored side is a
 * `positron-checkpoints` resource and the side on disk is the real file. A file that is a data
 * file, or is over the size limit, opens a text that states the sizes instead.
 *
 * `known` gives sizes the caller already has, such as those of a changed file, so that a side
 * over the size limit is never read just to measure it.
 *
 * Every service is read before the first await, because an accessor is valid only until then.
 */
export async function openDiff(accessor: ServicesAccessor, target: DiffRequest, title: string, known?: IKnownSizes): Promise<void> {
	const checkpointsService = accessor.get(ICheckpointsService);
	const editorService = accessor.get(IEditorService);
	const fileService = accessor.get(IFileService);
	const workspaceContextService = accessor.get(IWorkspaceContextService);
	const instantiationService = accessor.get(IInstantiationService);
	const logService = accessor.get(ILogService);
	const messageService = accessor.get(ICheckpointsMessageService);

	/** Logs a failure and shows the could-not-load sentence on the status line of the view. */
	const reportFailure = (what: string, error: unknown) => {
		logService.error(`[Checkpoints] ${what}`, error);
		messageService.show(Strings.status.couldNotLoad(readFailureKind(error)));
	};

	const engine = checkpointsService.engine;
	if (!engine) {
		reportFailure(`The differences of ${target.path} could not be opened.`, new Error('There is no checkpoints engine.'));
		return;
	}

	// Each stored version is read once, even when a second attempt needs it again.
	const storedReads = new Map<string, Promise<VSBuffer>>();
	const readStored = (oid: string): Promise<VSBuffer> => {
		let read = storedReads.get(oid);
		if (!read) {
			read = engine.readBlob(oid);
			storedReads.set(oid, read);
		}
		return read;
	};
	const storedLimitBytes = known?.maxBytes ?? STORED_SIDE_READ_LIMIT_BYTES;

	const openComparison = async (provider: IRichDiffProvider | undefined): Promise<IComparison> => {
		const limitBytes = provider?.maxSideBytes ?? LARGE_FILE_LIMIT_BYTES;
		const limitMegabytes = limitBytes / ByteSize.MB;
		const knownTooLarge = known !== undefined && (known.tooLarge === true
			|| [known.before, known.after].some(size => size !== undefined && size > limitBytes));
		if (knownTooLarge) {
			const formatKnown = (size: number | undefined) => size === undefined ? undefined : ByteSize.formatSize(size);
			const sizes = known.before === undefined && known.after === undefined
				? ''
				: Strings.diff.sizes(formatKnown(known.before), formatKnown(known.after));
			return { kind: 'message', message: Strings.diff.tooLargeMessage(target.path, limitMegabytes, sizes).trim() };
		}

		const state = await engine.getState();
		const root = projectRootUri(workspaceContextService, state.projectRoot);
		const { left, right } = await engine.getDiff(engineTarget(target));

		const measureFile = async (ref: ContentRef & { kind: 'file' }): Promise<IDiffSide> => {
			const resource = joinPath(root, ref.path);
			try {
				const stat = await fileService.stat(resource);
				const head = stat.size > limitBytes ? VSBuffer.alloc(0) : (await fileService.readFile(resource, { length: BINARY_SNIFF_BYTES })).value;
				return { resource, sizeBytes: stat.size, binary: looksBinary(head), present: true };
			} catch (error) {
				logService.warn(`[Checkpoints] The size of ${ref.path} could not be read.`, error instanceof Error ? error.message : String(error));
				return { resource, sizeBytes: 0, binary: false, present: true };
			}
		};
		const measureStored = async (ref: ContentRef & { kind: 'blob' | 'empty' }): Promise<IDiffSide> => {
			if (ref.kind === 'empty') {
				return { resource: blobResource(target.path, ''), sizeBytes: 0, binary: false, present: false };
			}
			const bytes = await readStored(ref.oid);
			return { resource: blobResource(target.path, ref.oid), sizeBytes: bytes.byteLength, binary: looksBinary(bytes), bytes, present: true };
		};
		// A stored side has no size before it is read, so its limit applies to the content read.
		const limitOf = (side: IDiffSide) => side.bytes ? Math.min(limitBytes, storedLimitBytes) : limitBytes;
		const tooLarge = (...measured: (IDiffSide | undefined)[]) => measured.some(side => side !== undefined && side.sizeBytes > limitOf(side));
		const sizeOf = (side: IDiffSide | undefined) => side ? ByteSize.formatSize(side.sizeBytes) : undefined;

		// Files on disk are measured first, so that a file that is too large stops the comparison
		// before the stored side is read.
		const leftFile = left.kind === 'file' ? await measureFile(left) : undefined;
		const rightFile = right.kind === 'file' ? await measureFile(right) : undefined;
		if (tooLarge(leftFile, rightFile)) {
			return { kind: 'message', message: Strings.diff.tooLargeMessage(target.path, limitMegabytes, Strings.diff.sizes(sizeOf(leftFile), sizeOf(rightFile))) };
		}

		const leftSide = leftFile ?? await measureStored(left as ContentRef & { kind: 'blob' | 'empty' });
		const rightSide = rightFile ?? await measureStored(right as ContentRef & { kind: 'blob' | 'empty' });
		const sizes = Strings.diff.sizes(sizeOf(leftSide), sizeOf(rightSide));
		if (tooLarge(leftSide, rightSide)) {
			const exceeded = [leftSide, rightSide].find(side => side.sizeBytes > limitOf(side)) ?? leftSide;
			return { kind: 'message', message: Strings.diff.tooLargeMessage(target.path, limitOf(exceeded) / ByteSize.MB, sizes) };
		}
		if (provider) {
			const sideContent = async (side: IDiffSide, label: string) => side.present
				? { bytes: side.bytes ?? (await fileService.readFile(side.resource)).value, label }
				: undefined;
			return {
				kind: 'provider',
				provider,
				sides: {
					left: await sideContent(leftSide, Strings.imageDiff.before()),
					right: await sideContent(rightSide, Strings.imageDiff.after()),
					path: target.path,
					title,
				},
			};
		}
		if (leftSide.binary || rightSide.binary) {
			return { kind: 'message', message: Strings.diff.binaryMessage(target.path, sizes) };
		}
		return { kind: 'sides', left: leftSide, right: rightSide };
	};

	// A provider that cannot open its comparison leaves the file to the text and data file handling.
	const provider = richDiffRegistry.find(target.path);
	let sides: IComparison | undefined;
	if (provider) {
		try {
			sides = await openComparison(provider);
			if (sides.kind === 'provider') {
				const { provider: found, sides: richSides } = sides;
				await instantiationService.invokeFunction(providerAccessor => found.open(providerAccessor, richSides));
				return;
			}
		} catch (error) {
			logService.warn(`[Checkpoints] The comparison of ${target.path} could not open in its own editor.`, error instanceof Error ? error.message : String(error));
			sides = undefined;
		}
	}
	if (!sides) {
		try {
			sides = await openComparison(undefined);
		} catch (error) {
			logService.error(`[Checkpoints] The differences of ${target.path} could not be read.`, error);
			sides = { kind: 'message', message: Strings.diff.unavailable(target.path) };
		}
	}

	if (sides.kind === 'provider') {
		return;
	}
	try {
		if (sides.kind === 'message') {
			await editorService.openEditor({ resource: messageResource(target.path, sides.message), label: title, options: { pinned: true } });
			return;
		}
		await editorService.openEditor({
			original: { resource: sides.left.resource },
			modified: { resource: sides.right.resource },
			label: title,
		});
	} catch (error) {
		reportFailure(`The differences of ${target.path} could not be opened.`, error);
	}
}
