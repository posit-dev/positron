/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IActivity, IActivityService, NumberBadge } from '../../../../services/activity/common/activity.js';
import { CheckpointsService } from '../../../../services/positronCheckpoints/browser/checkpointsService.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IncomingChangesBadge } from '../../browser/incomingChangesBadge.js';
import { FakeCheckpointsEngine, fakeEngineState } from './fakeCheckpointsEngine.js';

describe('IncomingChangesBadge', () => {
	/** The badges on the icon now: the container id and the number of each. */
	let shown: { containerId: string; count: number }[];
	let engine: FakeCheckpointsEngine;
	let checkpointsService: CheckpointsService;

	const ctx = createTestContainer().build();

	beforeEach(() => {
		shown = [];
		engine = ctx.disposables.add(new FakeCheckpointsEngine());
		checkpointsService = ctx.disposables.add(new CheckpointsService(new NullLogService()));
		ctx.instantiationService.stub(ICheckpointsService, checkpointsService);
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(IActivityService, {
			showViewContainerActivity: (containerId: string, activity: IActivity) => {
				const entry = { containerId, count: (activity.badge as NumberBadge).number };
				shown.push(entry);
				return toDisposable(() => shown.splice(shown.indexOf(entry), 1));
			},
		});
	});

	function behind(count: number) {
		engine.state = fakeEngineState({ shared: { exists: true, ahead: 0, behind: count } });
	}

	test('shows the number of new versions, follows it, and clears when there are none', async () => {
		behind(2);
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		ctx.disposables.add(ctx.instantiationService.createInstance(IncomingChangesBadge));
		await vi.waitFor(() => expect(shown).toEqual([{ containerId: 'workbench.view.positronCheckpoints', count: 2 }]));

		behind(3);
		engine.fireChange();
		await vi.waitFor(() => expect(shown).toEqual([{ containerId: 'workbench.view.positronCheckpoints', count: 3 }]));

		behind(0);
		engine.fireChange();
		await vi.waitFor(() => expect(shown).toEqual([]));
	});

	test('shows nothing for a project without a shared copy', async () => {
		engine.state = fakeEngineState({ shared: { exists: false, ahead: 0, behind: 0 } });
		ctx.disposables.add(checkpointsService.registerEngine(engine));
		ctx.disposables.add(ctx.instantiationService.createInstance(IncomingChangesBadge));
		await vi.waitFor(() => expect(engine.callsOf('getState').length).toBeGreaterThan(0));

		expect(shown).toEqual([]);
	});
});
