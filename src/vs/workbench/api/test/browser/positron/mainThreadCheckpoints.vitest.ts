/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { SerializableObjectWithBuffers } from '../../../../services/extensions/common/proxyIdentifier.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsRequest, ICheckpointsResponse } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { ExtHostCheckpointsShape, ExtHostPositronContext } from '../../../common/positron/extHost.positron.protocol.js';
import { MainThreadCheckpoints } from '../../../browser/positron/mainThreadCheckpoints.js';

describe('MainThreadCheckpoints', () => {
	const disposables = ensureNoLeakedDisposables();

	let logService: NullLogService;
	let service: CheckpointsService;
	let mainThread: MainThreadCheckpoints;

	// The ext host end of $call. A test sets what it answers with.
	const $call = vi.fn<(handle: number, request: ICheckpointsRequest) => Promise<SerializableObjectWithBuffers<ICheckpointsResponse>>>();

	beforeEach(() => {
		logService = new NullLogService();
		service = disposables.add(new CheckpointsService(logService));
		const proxy: ExtHostCheckpointsShape = { $call };
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (<T>(id: unknown) => {
				if (id === ExtHostPositronContext.ExtHostCheckpoints) {
					return proxy as T;
				}
				throw new Error(`unexpected proxy: ${String(id)}`);
			}) as IExtHostContext['getProxy'],
		});
		mainThread = disposables.add(new MainThreadCheckpoints(extHostContext, service, logService));
	});

	it('registers the engine with the service and logs it', () => {
		const info = vi.spyOn(logService, 'info');

		mainThread.$registerEngine(0);

		expect(service.hasEngine).toBe(true);
		expect(info).toHaveBeenCalledWith('Checkpoints engine registered');
	});

	it('sends an engine call to the ext host and returns its result', async () => {
		$call.mockResolvedValue(new SerializableObjectWithBuffers<ICheckpointsResponse>({ method: 'readBlob', result: VSBuffer.fromString('data') }));
		mainThread.$registerEngine(3);

		const blob = await service.engine!.readBlob('abc');

		expect($call).toHaveBeenCalledWith(3, { method: 'readBlob', args: ['abc'] });
		expect(blob.toString()).toBe('data');
	});

	it('rejects a result for a different method', async () => {
		$call.mockResolvedValue(new SerializableObjectWithBuffers<ICheckpointsResponse>({ method: 'proposedGitignore', result: '' }));
		mainThread.$registerEngine(0);

		await expect(service.engine!.getChanges()).rejects.toThrow('proposedGitignore');
	});

	it('forwards state changes of the engine', () => {
		mainThread.$registerEngine(0);
		const onDidChangeState = vi.fn();
		disposables.add(service.onDidChangeState(onDidChangeState));

		mainThread.$onDidChangeState(0);

		expect(onDidChangeState).toHaveBeenCalledTimes(1);
	});

	it('unregistering a handle removes its engine', () => {
		mainThread.$registerEngine(0);

		mainThread.$unregisterEngine(0);

		expect(service.hasEngine).toBe(false);
	});

	it('disposing unregisters every engine it registered', () => {
		mainThread.$registerEngine(0);

		mainThread.dispose();

		expect(service.hasEngine).toBe(false);
	});
});
