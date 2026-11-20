/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { DiffTarget } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { messageResource } from '../../browser/checkpointsContentProvider.js';
import { openDiff } from '../../browser/openDiff.js';
import { IRichDiffProvider, IRichDiffSides, richDiffRegistry } from '../../browser/richDiff/richDiffRegistry.js';
import { FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

const MEGABYTE = 1024 * 1024;

describe('openDiff', () => {
	const openEditor = vi.fn(async () => undefined);
	/** The size and the leading bytes of each file on disk, by path. */
	let disk: Record<string, { size: number; head: Uint8Array }> = {};

	const ctx = createTestContainer()
		.stub(IEditorService, { openEditor })
		.stub(IFileService, {
			stat: async (resource: URI) => {
				const entry = disk[resource.path];
				if (!entry) {
					throw new Error('missing');
				}
				return { size: entry.size };
			},
			readFile: async (resource: URI) => ({ value: VSBuffer.wrap(disk[resource.path].head) }),
		})
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.build();

	let engine: FakeCheckpointsEngine;
	const text = (content: string) => new TextEncoder().encode(content);
	const target: DiffTarget = { kind: 'change', path: 'analysis/dose.R' };

	beforeEach(() => {
		openEditor.mockClear();
		disk = { '/work/dose-model/analysis/dose.R': { size: 12, head: text('x <- 1\n') } };
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
	});

	function open(diffTarget: DiffTarget = target) {
		return ctx.instantiationService.invokeFunction(accessor => openDiff(accessor, diffTarget, 'dose.R (changes)'));
	}

	test('openDiff opens blob against file for a modified file', async () => {
		engine.diff = { left: { kind: 'blob', oid: 'abc123' }, right: { kind: 'file', path: 'analysis/dose.R' } };
		engine.blobs.set('abc123', VSBuffer.fromString('x <- 0\n'));

		await open();

		expect(openEditor).toHaveBeenCalledTimes(1);
		const [input] = openEditor.mock.calls[0] as unknown as [{ original: { resource: URI }; modified: { resource: URI }; label: string }];
		expect({
			original: input.original.resource.toString(),
			modified: input.modified.resource.toString(),
			label: input.label,
		}).toEqual({
			original: 'positron-checkpoints:/analysis/dose.R?abc123',
			modified: URI.file('/work/dose-model/analysis/dose.R').toString(),
			label: 'dose.R (changes)',
		});
	});

	test('a new file compares an empty text against the file', async () => {
		engine.diff = { left: { kind: 'empty' }, right: { kind: 'file', path: 'analysis/dose.R' } };

		await open();

		const [input] = openEditor.mock.calls[0] as unknown as [{ original: { resource: URI } }];
		expect(input.original.resource.toString()).toBe('positron-checkpoints:/analysis/dose.R');
	});

	test('a binary file opens a message with both sizes', async () => {
		engine.diff = { left: { kind: 'blob', oid: 'abc123' }, right: { kind: 'file', path: 'analysis/dose.R' } };
		engine.blobs.set('abc123', VSBuffer.wrap(new Uint8Array(2048)));
		disk['/work/dose-model/analysis/dose.R'] = { size: 4096, head: new Uint8Array([1, 0, 2]) };

		await open();

		const [input] = openEditor.mock.calls[0] as unknown as [{ resource: URI; label: string }];
		expect(input.resource.toString()).toBe(messageResource('analysis/dose.R', 'analysis/dose.R is a data file, so there is no line-by-line comparison. Before: 2.00KB. Now: 4.00KB.').toString());
		expect(input.label).toBe('dose.R (changes)');
	});

	test('a file over 50 MB opens a message and the stored side is not read', async () => {
		engine.diff = { left: { kind: 'blob', oid: 'abc123' }, right: { kind: 'file', path: 'analysis/dose.R' } };
		disk['/work/dose-model/analysis/dose.R'] = { size: 80 * MEGABYTE, head: new Uint8Array() };

		await open();

		const [input] = openEditor.mock.calls[0] as unknown as [{ resource: URI }];
		expect(input.resource.toString()).toBe(messageResource('analysis/dose.R', 'analysis/dose.R is over 50 MB, so there is no line-by-line comparison. Now: 80.00MB.').toString());
		expect(engine.callsOf('readBlob')).toEqual([]);
	});

	test('a removed file known to be over 50 MB opens a message without reading the stored side', async () => {
		engine.diff = { left: { kind: 'blob', oid: 'huge' }, right: { kind: 'empty' } };
		const removed: DiffTarget = { kind: 'change', path: 'data/huge.csv' };

		await ctx.instantiationService.invokeFunction(accessor => openDiff(accessor, removed, 'huge.csv (changes)', { tooLarge: true }));

		const [input] = openEditor.mock.calls[0] as unknown as [{ resource: URI }];
		expect(input.resource.toString()).toBe(messageResource('data/huge.csv', 'data/huge.csv is over 50 MB, so there is no line-by-line comparison.').toString());
		expect(engine.callsOf('readBlob')).toEqual([]);
		expect(engine.callsOf('getDiff')).toEqual([]);
	});

	test('a known size over 50 MB is stated in the message', async () => {
		await ctx.instantiationService.invokeFunction(accessor => openDiff(accessor, target, 'dose.R (changes)', { before: 60 * MEGABYTE, after: 10 }));

		const [input] = openEditor.mock.calls[0] as unknown as [{ resource: URI }];
		expect(input.resource.toString()).toBe(messageResource('analysis/dose.R', 'analysis/dose.R is over 50 MB, so there is no line-by-line comparison. Before: 60.00MB. Now: 10B.').toString());
		expect(engine.callsOf('getDiff')).toEqual([]);
	});

	test('without an engine nothing opens', async () => {
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);

		await open();

		expect(openEditor).not.toHaveBeenCalled();
	});

	describe('with a registered provider', () => {
		const providerOpen = vi.fn(async (_accessor: unknown, _sides: IRichDiffSides) => { });
		const provider: IRichDiffProvider = { id: 'fake-image', extensions: ['png'], maxSideBytes: 20 * MEGABYTE, open: providerOpen };
		const image: DiffTarget = { kind: 'change', path: 'figures/Plot.PNG' };

		beforeEach(() => {
			providerOpen.mockClear();
			providerOpen.mockImplementation(async () => { });
			ctx.disposables.add(richDiffRegistry.register(provider));
			engine.diff = { left: { kind: 'blob', oid: 'old' }, right: { kind: 'file', path: 'figures/Plot.PNG' } };
			engine.blobs.set('old', VSBuffer.wrap(new Uint8Array([137, 80, 0, 1])));
			disk['/work/dose-model/figures/Plot.PNG'] = { size: 5, head: new Uint8Array([137, 80, 0, 2, 3]) };
		});

		test('hands both sides to the provider by lower-cased extension and opens no text comparison', async () => {
			await open(image);

			const [, sides] = providerOpen.mock.calls[0];
			expect({
				left: sides.left && { bytes: [...sides.left.bytes.buffer], label: sides.left.label },
				right: sides.right && { bytes: [...sides.right.bytes.buffer], label: sides.right.label },
				path: sides.path,
				title: sides.title,
				opened: openEditor.mock.calls.length,
			}).toEqual({
				left: { bytes: [137, 80, 0, 1], label: 'Before' },
				right: { bytes: [137, 80, 0, 2, 3], label: 'After' },
				path: 'figures/Plot.PNG',
				title: 'dose.R (changes)',
				opened: 0,
			});
		});

		test('an added file has no left side', async () => {
			engine.diff = { left: { kind: 'empty' }, right: { kind: 'file', path: 'figures/Plot.PNG' } };

			await open(image);

			const [, sides] = providerOpen.mock.calls[0];
			expect({ left: sides.left, right: sides.right?.label }).toEqual({ left: undefined, right: 'After' });
		});

		test('a removed file has no right side', async () => {
			engine.diff = { left: { kind: 'blob', oid: 'old' }, right: { kind: 'empty' } };

			await open(image);

			const [, sides] = providerOpen.mock.calls[0];
			expect({ left: sides.left?.label, right: sides.right }).toEqual({ left: 'Before', right: undefined });
		});

		test('a side over the provider limit opens the size message with that limit and skips the provider', async () => {
			disk['/work/dose-model/figures/Plot.PNG'] = { size: 30 * MEGABYTE, head: new Uint8Array() };

			await open(image);

			const [input] = openEditor.mock.calls[0] as unknown as [{ resource: URI }];
			expect(providerOpen).not.toHaveBeenCalled();
			expect(input.resource.toString()).toBe(messageResource('figures/Plot.PNG', 'figures/Plot.PNG is over 20 MB, so there is no line-by-line comparison. Now: 30.00MB.').toString());
			expect(engine.callsOf('readBlob')).toEqual([]);
		});

		test('a stored side of 30 MB is not given to the provider either', async () => {
			engine.blobs.set('old', VSBuffer.wrap(new Uint8Array(30 * MEGABYTE)));

			await open(image);

			expect(providerOpen).not.toHaveBeenCalled();
			expect(openEditor).toHaveBeenCalledTimes(1);
		});

		test('a provider that fails lets the data file message open', async () => {
			providerOpen.mockRejectedValue(new Error('cannot decode'));

			await open(image);

			const [input] = openEditor.mock.calls[0] as unknown as [{ resource: URI }];
			expect(input.resource.toString()).toBe(messageResource('figures/Plot.PNG', 'figures/Plot.PNG is a data file, so there is no line-by-line comparison. Before: 4B. Now: 5B.').toString());
		});

		test('a file with no provider still opens the text comparison', async () => {
			engine.diff = { left: { kind: 'blob', oid: 'abc123' }, right: { kind: 'file', path: 'analysis/dose.R' } };
			engine.blobs.set('abc123', VSBuffer.fromString('x <- 0\n'));

			await open();

			expect(providerOpen).not.toHaveBeenCalled();
			const [input] = openEditor.mock.calls[0] as unknown as [{ original: { resource: URI } }];
			expect(input.original.resource.toString()).toBe('positron-checkpoints:/analysis/dose.R?abc123');
		});
	});
});
