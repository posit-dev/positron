/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ShutdownReason as ProtocolShutdownReason } from '../../../common/positron/extHost.positron.protocol.js';
import { ShutdownReason as ApiShutdownReason } from '../../../common/positron/extHostTypes.positron.js';
import { ExtHostLifecycle } from '../../../common/positron/extHostLifecycle.js';

describe('ExtHostLifecycle', () => {
	const disposables = ensureNoLeakedDisposables();

	let lifecycle: ExtHostLifecycle;

	beforeEach(() => {
		lifecycle = disposables.add(new ExtHostLifecycle());
	});

	it.each([
		[ProtocolShutdownReason.Close, ApiShutdownReason.Close],
		[ProtocolShutdownReason.Quit, ApiShutdownReason.Quit],
		[ProtocolShutdownReason.Reload, ApiShutdownReason.Reload],
		[ProtocolShutdownReason.Load, ApiShutdownReason.Load],
	])('fires onWillShutdown with API reason %i for protocol reason %i', async (protocolReason, apiReason) => {
		const observed: ApiShutdownReason[] = [];
		disposables.add(lifecycle.onWillShutdown(reason => observed.push(reason)));

		await lifecycle.$onWillShutdown(protocolReason);

		expect(observed).toEqual([apiReason]);
	});
});
