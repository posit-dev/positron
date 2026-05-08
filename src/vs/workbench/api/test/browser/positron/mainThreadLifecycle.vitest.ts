/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILifecycleService, ShutdownReason as WorkbenchShutdownReason, WillShutdownEvent } from '../../../../services/lifecycle/common/lifecycle.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { ExtHostLifecycleShape, ExtHostPositronContext, ShutdownReason } from '../../../common/positron/extHost.positron.protocol.js';
import { MainThreadLifecycle } from '../../../browser/positron/mainThreadLifecycle.js';

describe('MainThreadLifecycle', () => {
	const disposables = ensureNoLeakedDisposables();

	let willShutdown: Emitter<WillShutdownEvent>;
	let proxyOnWillShutdown: ReturnType<typeof vi.fn>;
	let lifecycleService: ILifecycleService;
	let extHostContext: IExtHostContext;

	beforeEach(() => {
		willShutdown = disposables.add(new Emitter<WillShutdownEvent>());
		proxyOnWillShutdown = vi.fn(async () => { });
		const proxy: ExtHostLifecycleShape = {
			$onWillShutdown: proxyOnWillShutdown as ExtHostLifecycleShape['$onWillShutdown'],
		};
		lifecycleService = stubInterface<ILifecycleService>({
			onWillShutdown: willShutdown.event,
		});
		extHostContext = stubInterface<IExtHostContext>({
			getProxy: (<T>(id: unknown) => {
				if (id === ExtHostPositronContext.ExtHostLifecycle) {
					return proxy as T;
				}
				throw new Error(`unexpected proxy: ${String(id)}`);
			}) as IExtHostContext['getProxy'],
		});
		disposables.add(new MainThreadLifecycle(extHostContext, lifecycleService));
	});

	function fireShutdown(reason: WorkbenchShutdownReason): Promise<void>[] {
		const joined: Promise<void>[] = [];
		const event: WillShutdownEvent = {
			reason,
			token: CancellationToken.None,
			join: ((promiseOrFn: Promise<void> | (() => Promise<void>)) => {
				joined.push(typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
			}) as WillShutdownEvent['join'],
			joiners: () => [],
			force: () => { },
		};
		willShutdown.fire(event);
		return joined;
	}

	it.each([
		[WorkbenchShutdownReason.CLOSE, ShutdownReason.Close],
		[WorkbenchShutdownReason.QUIT, ShutdownReason.Quit],
		[WorkbenchShutdownReason.RELOAD, ShutdownReason.Reload],
		[WorkbenchShutdownReason.LOAD, ShutdownReason.Load],
	])('forwards reason %i to ext host as %i', async (workbenchReason, apiReason) => {
		const joined = fireShutdown(workbenchReason);

		expect(proxyOnWillShutdown).toHaveBeenCalledWith(apiReason);
		expect(joined).toHaveLength(1);
		await Promise.all(joined);
	});
});
