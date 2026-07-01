/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IFileContent, IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IHeadlessLanguageModelService, StreamTextResult, UnavailableReason } from '../../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { ISCMInput, ISCMProvider, ISCMRepository, ISCMResource, ISCMResourceGroup, ISCMService } from '../../../scm/common/scm.js';
import { CommitMessageMenuContribution, GenerateCommitMessageAction, GIT_SUGGESTIONS_MODEL_KEY } from '../../browser/commitMessageAction.js';

/** The title currently registered for the generate-commit-message SCM input box item. */
function menuItemTitle(): string | undefined {
	for (const item of MenuRegistry.getMenuItems(MenuId.SCMInputBox)) {
		if (isIMenuItem(item) && item.command.id === GenerateCommitMessageAction.ID) {
			const title = item.command.title;
			return typeof title === 'string' ? title : title.value;
		}
	}
	return undefined;
}

const ROOT_URI = URI.file('/repo');

/** An async iterable that yields the given chunks. */
async function* chunks(...parts: string[]): AsyncIterable<string> {
	for (const part of parts) {
		yield part;
	}
}

/** Build a repository whose groups contain a single staged, untracked file. */
function makeRepository(setValue: (value: string) => void): ISCMRepository {
	const group = stubInterface<ISCMResourceGroup>({
		id: 'index',
		label: 'Staged Changes',
		resources: [
			stubInterface<ISCMResource>({
				sourceUri: URI.file('/repo/added.ts'),
				multiDiffEditorOriginalUri: undefined,
				contextValue: 'untracked',
				decorations: {},
			}),
		],
	});
	const input = stubInterface<ISCMInput>({
		setValue: (value: string) => setValue(value),
	});
	const provider = stubInterface<ISCMProvider>({ groups: [group], rootUri: ROOT_URI });
	return stubInterface<ISCMRepository>({ provider, input });
}

describe('GenerateCommitMessageAction', () => {
	let streamResult: StreamTextResult;
	let repository: ISCMRepository | undefined;
	let inputValues: string[];

	const ctx = createTestContainer()
		.stub(ISCMService, {
			get repositories() { return repository ? [repository] : []; },
		})
		.stub(IUriIdentityService, stubInterface<IUriIdentityService>({
			extUri: stubInterface<IUriIdentityService['extUri']>({
				isEqual: (a, b) => a?.toString() === b?.toString(),
			}),
		}))
		.stub(IFileService, stubInterface<IFileService>({
			// The single resource is untracked (added), so only the modified file is read.
			readFile: async () => stubInterface<IFileContent>({ value: VSBuffer.fromString('console.log("hi");\n') }),
		}))
		.stub(IHeadlessLanguageModelService, {
			streamText: async () => streamResult,
		})
		.stub(IConfigurationService, new TestConfigurationService())
		.stub(ILogService, new NullLogService())
		.build();

	beforeEach(() => {
		inputValues = [];
		repository = makeRepository(value => inputValues.push(value));
		streamResult = {
			available: true,
			model: { id: 'haiku', name: 'Haiku' },
			usedFallback: false,
			text: chunks('Add ', 'greeting'),
		};
	});

	const run = (token: CancellationToken = CancellationToken.None) => {
		const action = new GenerateCommitMessageAction();
		return ctx.instantiationService.invokeFunction(accessor => action.run(accessor, ROOT_URI, undefined, token));
	};

	it('streams the generated message into the commit input', async () => {
		await run();
		expect(inputValues).toEqual(['', 'Add ', 'Add greeting']);
	});

	it('reads the configured model patterns and passes them to the service', async () => {
		const config = ctx.get(IConfigurationService) as TestConfigurationService;
		config.setUserConfiguration(GIT_SUGGESTIONS_MODEL_KEY, ['mini']);
		const spy = vi.spyOn(ctx.get(IHeadlessLanguageModelService), 'streamText');

		await run();

		expect(spy.mock.calls[0][0].model).toEqual({ patterns: ['mini'] });
	});

	it('does not touch the input when no repository is found', async () => {
		repository = undefined;
		await run();
		expect(inputValues).toEqual([]);
	});

	it('does not touch the input when the model is unavailable', async () => {
		streamResult = { available: false, reason: 'sign-in-required' satisfies UnavailableReason };
		await run();
		expect(inputValues).toEqual([]);
	});

	it('stops streaming when cancelled', async () => {
		const cts = new CancellationTokenSource();
		streamResult = {
			available: true,
			model: { id: 'haiku', name: 'Haiku' },
			usedFallback: false,
			text: (async function* () {
				yield 'Add ';
				cts.cancel();
				yield 'greeting';
			})(),
		};

		await run(cts.token);

		// The first delta is written, then cancellation halts before the second.
		expect(inputValues).toEqual(['', 'Add ']);
	});
});

describe('CommitMessageMenuContribution', () => {
	const ctx = createTestContainer()
		.stub(IConfigurationService, new TestConfigurationService())
		.build();

	const config = () => ctx.get(IConfigurationService) as TestConfigurationService;
	const createContribution = () =>
		ctx.disposables.add(ctx.instantiationService.createInstance(CommitMessageMenuContribution));

	beforeEach(async () => {
		// The stubbed config instance is shared across tests; reset the setting.
		await config().setUserConfiguration(GIT_SUGGESTIONS_MODEL_KEY, []);
	});

	it('labels the menu item with the default tier', () => {
		createContribution();
		expect(menuItemTitle()).toBe('Generate Commit Message (Model: default)');
	});

	it('labels with the configured model patterns', async () => {
		await config().setUserConfiguration(GIT_SUGGESTIONS_MODEL_KEY, ['haiku', 'mini']);
		createContribution();
		expect(menuItemTitle()).toBe('Generate Commit Message (Model: haiku, mini)');
	});

	it('refreshes the label when the model setting changes', async () => {
		createContribution();
		expect(menuItemTitle()).toBe('Generate Commit Message (Model: default)');

		await config().setUserConfiguration(GIT_SUGGESTIONS_MODEL_KEY, ['claude-sonnet']);
		config().onDidChangeConfigurationEmitter.fire(stubInterface<IConfigurationChangeEvent>({ affectsConfiguration: () => true }));
		expect(menuItemTitle()).toBe('Generate Commit Message (Model: claude-sonnet)');
	});
});
