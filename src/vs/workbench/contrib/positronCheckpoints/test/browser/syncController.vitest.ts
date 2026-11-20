/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { extUri } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IIncomingPreview, IOverlap } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IWorkingCopy } from '../../../../services/workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { CheckpointsMessageService, ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { OverlapEditorInput } from '../../browser/overlapEditor/overlapEditorInput.js';
import { mergeCollisionChoices } from '../../browser/runAction.js';
import { SyncController } from '../../browser/syncController.js';
import { fakeCheckpoint, FakeCheckpointsEngine } from './fakeCheckpointsEngine.js';

function overlap(id: string, overrides: Partial<IOverlap> = {}): IOverlap {
	return { id, kind: 'text', path: `${id}.R`, otherPaths: [], mine: 'x <- 1\n', theirs: 'x <- 2\n', theirAuthor: 'Maya', detail: '', ...overrides };
}

function preview(basis: string, overlaps: IOverlap[], overrides: Partial<IIncomingPreview> = {}): IIncomingPreview {
	return {
		basis,
		incoming: [fakeCheckpoint({ id: 'm1', title: 'Changed units', authorName: 'Maya', authorIsMe: false })],
		changedPaths: overlaps.map(candidate => candidate.path),
		touchesLocalWork: overlaps.length > 0,
		overlaps,
		collisions: [],
		...overrides,
	};
}

describe('SyncController', () => {
	// The editor service owns the inputs it opens, so the stub disposes each one.
	const openEditor = vi.fn(async (input: EditorInput) => { input.dispose(); return undefined; });

	const ctx = createTestContainer()
		.stub(IWorkingCopyService, { get dirtyWorkingCopies(): IWorkingCopy[] { return []; } })
		.stub(IUriIdentityService, { extUri })
		.stub(IDialogService, {})
		.stub(IEditorService, { openEditor })
		.stub(IWorkspaceContextService, {
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: URI.file('/work/dose-model'), name: 'dose-model', index: 0, toResource: path => URI.file(path) }] }),
		})
		.build();

	let engine: FakeCheckpointsEngine;
	let messageService: CheckpointsMessageService;
	let controller: SyncController;

	beforeEach(() => {
		openEditor.mockClear();
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		const checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		messageService = ctx.disposables.add(new CheckpointsMessageService());
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ICheckpointsMessageService, messageService);
		controller = ctx.disposables.add(ctx.instantiationService.createInstance(SyncController));
	});

	test('overlaps open the overlap editor', async () => {
		engine.incoming = preview('b1', []);
		const overlapping = preview('b1', [overlap('o1')]);
		engine.nextResult = { kind: 'overlaps', preview: overlapping };

		const result = await controller.getChanges();

		expect(result?.kind).toBe('overlaps');
		expect(engine.callsOf('getIncoming')).toEqual([['b1', [], []]]);
		expect(openEditor).toHaveBeenCalledTimes(1);
		expect((openEditor.mock.calls[0] as unknown[])[0]).toBeInstanceOf(OverlapEditorInput);
		expect(controller.preview).toBe(overlapping);
		expect(messageService.message).toBe('1 change overlaps with your work. Choose how to combine them. Nothing has changed in your project yet.');
	});

	test('apply sends the chosen resolutions with the basis that was reviewed', async () => {
		engine.incoming = preview('b1', [overlap('o1'), overlap('o2', { kind: 'edit-delete', deletedBy: 'them' })]);
		await controller.refreshPreview();
		controller.setChoice('o1', { type: 'take', side: 'theirs' });
		expect(controller.canApply).toBe(false);
		controller.setChoice('o2', { type: 'keep-file' });
		expect(controller.canApply).toBe(true);

		const result = await controller.apply();

		expect(result?.kind).toBe('done');
		expect(engine.callsOf('getIncoming')).toEqual([['b1', [
			{ overlapId: 'o1', choice: { type: 'take', side: 'theirs' } },
			{ overlapId: 'o2', choice: { type: 'keep-file' } },
		], []]]);
		expect(messageService.message).toBe('The changes from the shared copy are now in your project.');
		expect(controller.preview).toBeUndefined();
		expect(controller.resolutions.size).toBe(0);
	});

	test('a choice the kind does not allow is ignored', async () => {
		engine.incoming = preview('b1', [overlap('o1', { kind: 'binary' }), overlap('o2', { kind: 'unsupported' })]);
		await controller.refreshPreview();

		controller.setChoice('o1', { type: 'text', content: 'merged' });
		controller.setChoice('o2', { type: 'take', side: 'mine' });
		controller.setChoice('missing', { type: 'take', side: 'mine' });

		expect([...controller.resolutions]).toEqual([]);
		expect(controller.hasUnsupported).toBe(true);
		expect(await controller.apply()).toBeUndefined();
		expect(engine.callsOf('getIncoming')).toEqual([]);
	});

	test('inputs-changed keeps still-valid choices and names what changed', async () => {
		engine.incoming = preview('b1', [overlap('o1'), overlap('o2')]);
		await controller.refreshPreview();
		controller.setChoice('o1', { type: 'take', side: 'mine' });
		controller.setChoice('o2', { type: 'take', side: 'theirs' });
		// Maya added more changes, and o2 now has different versions, so it has a new id.
		const fresh = preview('b2', [overlap('o1'), overlap('o2b', { path: 'o2.R' })], {
			incoming: [fakeCheckpoint({ id: 'm1', authorName: 'Maya', authorIsMe: false }), fakeCheckpoint({ id: 'm2', authorName: 'Maya', authorIsMe: false })],
		});
		engine.nextResult = { kind: 'inputs-changed', changed: ['shared'], preview: fresh };

		const result = await controller.apply();

		expect(result?.kind).toBe('inputs-changed');
		expect(controller.preview).toBe(fresh);
		expect([...controller.resolutions]).toEqual([['o1', { type: 'take', side: 'mine' }]]);
		expect(controller.inputsChanged?.changed).toEqual(['shared']);
		expect(messageService.message).toBe('Maya added more changes since you reviewed this. The changes are shown again. Nothing was changed.');
		expect(controller.canApply).toBe(false);
	});

	test('a background preview does not replace the one the person is choosing for', async () => {
		engine.incoming = preview('b1', [overlap('o1')]);
		await controller.refreshPreview();
		controller.setChoice('o1', { type: 'take', side: 'mine' });
		engine.incoming = preview('b2', [overlap('o1')]);

		await controller.refreshPreview();
		await controller.apply();

		expect(engine.callsOf('getIncoming')[0][0]).toBe('b1');
	});

	test('Back out forgets the choices and calls nothing', async () => {
		engine.incoming = preview('b1', [overlap('o1')]);
		await controller.refreshPreview();
		controller.setChoice('o1', { type: 'take', side: 'mine' });
		const callsBefore = engine.calls.length;

		controller.backOut();

		expect(controller.resolutions.size).toBe(0);
		expect(engine.calls.slice(callsBefore)).toEqual([]);
	});

	test('collision choices merge by path, the later choice winning', () => {
		expect(mergeCollisionChoices(
			[{ path: 'a.csv', choice: 'use-theirs-keep-copy' }],
			[{ path: 'b.csv', choice: 'use-theirs-keep-copy' }, { path: 'a.csv', choice: 'use-theirs-keep-copy' }],
		)).toEqual([{ path: 'a.csv', choice: 'use-theirs-keep-copy' }, { path: 'b.csv', choice: 'use-theirs-keep-copy' }]);
	});
});
