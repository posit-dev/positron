/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpointsMessageService } from '../../browser/checkpointsMessages.js';
import { IGitHubClient, parseProjectLink } from '../../browser/github/githubClient.js';
import { ProposalController } from '../../browser/proposalController.js';
import { ISyncController } from '../../browser/syncController.js';

/** GitHub calls for a project that has no pull request; a test overrides the calls it needs. */
export function fakeProposalGitHub(overrides: Partial<IGitHubClient> = {}): IGitHubClient {
	return {
		_serviceBrand: undefined,
		createRepository: async () => ({ ok: false, reason: 'unknown', detail: '' }),
		invite: async () => ({ ok: false, reason: 'unknown', detail: '' }),
		parseProjectLink,
		openProposal: async () => ({ ok: true, url: 'https://github.com/me/dose-model/pull/7', number: 7 }),
		findProposal: async () => ({ ok: true }),
		closeProposal: async () => ({ ok: true }),
		...overrides,
	};
}

/**
 * A proposal controller for view tests, made from the stubbed checkpoints service, message
 * service, and sync controller, with `github` for its GitHub calls. Stub those three services first.
 * A test that counts the engine's reads passes a `checkpointsService` without the engine, because
 * the controller reads the state too.
 */
export function createProposalController(
	instantiationService: IInstantiationService,
	disposables: Pick<DisposableStore, 'add'>,
	github: IGitHubClient = fakeProposalGitHub(),
	checkpointsService?: ICheckpointsService,
): ProposalController {
	return disposables.add(instantiationService.invokeFunction(accessor => new ProposalController(
		checkpointsService ?? accessor.get(ICheckpointsService),
		github,
		accessor.get(ISyncController),
		accessor.get(ICheckpointsMessageService),
		instantiationService,
		new NullLogService(),
		disposables.add(new MockContextKeyService()),
	)));
}
