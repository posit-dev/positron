/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { RuntimeState, LanguageRuntimeSessionMode } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronAssistantService, IPositronAssistantConfigurationService, IPositronChatContext, IChatRequestData, IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { PositronAssistantService } from '../../browser/positronAssistantService.js';
import { INotificationService, IPromptChoice, Severity } from '../../../../../platform/notification/common/notification.js';
import { ChatAgentLocation } from '../../../chat/common/constants.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { IPositronVariablesService } from '../../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { TestPositronVariablesService } from '../../../../services/positronVariables/test/common/testPositronVariablesService.js';
import { IPositronPlotsService } from '../../../../services/positronPlots/common/positronPlots.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { TestRuntimeStartupService } from '../../../../services/runtimeStartup/test/common/testRuntimeStartupService.js';
import { createTestPlotsServiceWithPlots } from '../../../../services/positronPlots/test/common/testPlotsServiceHelper.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IAiProviderService } from '../../../../services/positronAiProvider/common/aiProviderService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IProviderCatalogChangeData } from '../../../../../platform/positronAiProvider/common/aiProviderCatalog.js';

const { mockShowDialog } = vi.hoisted(() => ({ mockShowDialog: vi.fn() }));
vi.mock('../../browser/languageModelModalDialog.js', () => ({ showLanguageModelModalDialog: mockShowDialog }));

const { mockShowNewModal } = vi.hoisted(() => ({ mockShowNewModal: vi.fn() }));
vi.mock('../../browser/configureLLMProvidersModal.js', () => ({
	NEW_PROVIDER_MODAL_KEY: 'assistant.newProviderModal',
	showConfigureLLMProvidersModal: mockShowNewModal,
}));

// `areCompletionsEnabled` reads the completions enablement setting name from
// product configuration. The vitest web fallback leaves that name empty, so
// override only this one field (preserving the rest of the product config) to
// match the shipped `github.copilot.enable` value.
vi.mock('../../../../../platform/product/common/product.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../../platform/product/common/product.js')>();
	return {
		...actual,
		default: {
			...actual.default,
			defaultChatAgent: {
				...actual.default.defaultChatAgent,
				completionsEnablementSetting: 'github.copilot.enable',
			},
		},
	};
});

describe('PositronAssistantService', () => {
	const ctx = createTestContainer()
		.withRuntimeServices()
		.build();

	let testVariablesService: TestPositronVariablesService;
	let positronAssistantService: IPositronAssistantService;
	let testConsoleSession: TestLanguageRuntimeSession;
	let testNotebookSession: TestLanguageRuntimeSession;

	beforeEach(async () => {
		// Create fresh mutable stubs per test to avoid state leakage
		ctx.instantiationService.stub(IRuntimeStartupService, new TestRuntimeStartupService());
		testVariablesService = new TestPositronVariablesService();

		// Stub services that need disposables or createInstance
		ctx.instantiationService.stub(IPositronVariablesService, ctx.disposables.add(testVariablesService));
		ctx.instantiationService.stub(IPositronPlotsService, ctx.disposables.add(createTestPlotsServiceWithPlots()));

		// Create test runtime sessions
		const runtime = await createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		testConsoleSession = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{
				runtime,
				sessionName: "Test Session",
				sessionMode: LanguageRuntimeSessionMode.Console,
				startReason: "Test"
			}
		);
		testNotebookSession = await startTestLanguageRuntimeSession(
			ctx.instantiationService,
			ctx.disposables,
			{
				runtime,
				sessionName: "Test Notebook Session",
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				startReason: "Test",
				notebookUri: URI.file('/path/to/notebook.ipynb')
			}
		);

		// Wait for the sessions to be ready
		await Promise.all([
			waitForRuntimeState(testConsoleSession, RuntimeState.Ready),
			waitForRuntimeState(testNotebookSession, RuntimeState.Ready),
		]);

		// Create variables instances for each session and set the active session
		testVariablesService.createPositronVariablesInstance(testConsoleSession, true);
		testVariablesService.createPositronVariablesInstance(testNotebookSession);

		// Create the service under test with all required services
		positronAssistantService = ctx.disposables.add(ctx.instantiationService.createInstance(PositronAssistantService));
	});

	it('getPositronChatContext returns the global context properties', async () => {
		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Chat
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify the global context properties are present
		expect(context.currentDate, 'Current date should be present').toBeDefined();
		expect(context.plots, 'Plots information should be present').toBeDefined();
		expect(context.positronVersion, 'Positron version should be present').toBeDefined();
	});

	it('getPositronChatContext handles plot information', async () => {
		// Create a chat request
		const chatRequest: IChatRequestData = {
			location: ChatAgentLocation.Chat
		};

		// Get the chat context
		const context: IPositronChatContext = positronAssistantService.getPositronChatContext(chatRequest);

		// Verify plot information is included
		expect(context.plots, 'Plot information should be present').toBeDefined();
		expect(typeof context.plots.hasPlots, 'hasPlots should be a boolean').toBe('boolean');
	});

});

describe('PositronAssistantService showLanguageModelModalDialog', () => {
	const prompt = vi.fn();
	const openEditor = vi.fn();
	const getRegisteredSources = vi.fn<() => IPositronLanguageModelSource[]>();
	const getConfigFileUri = vi.fn<() => Promise<URI>>();
	let whenInitializedDeferred: DeferredPromise<void>;
	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(INotificationService, { prompt })
		.stub(IEditorService, { openEditor })
		.stub(IPositronAssistantConfigurationService, { getRegisteredSources })
		.stub(IAiProviderService, {
			getConfigFileUri,
			get whenInitialized() { return whenInitializedDeferred.p; },
		})
		.build();

	let service: PositronAssistantService;

	beforeEach(() => {
		whenInitializedDeferred = new DeferredPromise<void>();
		getConfigFileUri.mockResolvedValue(URI.file('/home/u/.posit/ai/providers.json'));
		service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronAssistantService));
	});

	function makeSource(id: string): IPositronLanguageModelSource {
		return {
			type: PositronLanguageModelType.Chat,
			provider: { id, displayName: `Display ${id}`, settingName: id },
			supportedOptions: [],
			defaults: {},
		};
	}

	it('defers the dialog until the provider service initializes, then shows it', async () => {
		const sources = [makeSource('prov-a')];
		getRegisteredSources.mockReturnValue(sources);
		const onAction = vi.fn();
		const onClose = vi.fn();

		service.showLanguageModelModalDialog(onAction, onClose);

		// Nothing shown yet: whenInitialized has not resolved.
		expect(prompt).not.toHaveBeenCalled();
		expect(mockShowDialog).not.toHaveBeenCalled();

		whenInitializedDeferred.complete();
		await whenInitializedDeferred.p;
		// Allow the .then() continuation to run.
		await Promise.resolve();

		expect(mockShowDialog).toHaveBeenCalledTimes(1);
		expect(mockShowDialog.mock.calls[0][0]).toBe(sources);
	});

	it('invokes onClose (never hangs) when initialization ends in error status', async () => {
		getRegisteredSources.mockReturnValue([]);
		const onClose = vi.fn();

		service.showLanguageModelModalDialog(vi.fn(), onClose);

		// whenInitialized never rejects, even when the catalog fetch failed;
		// it resolves once the fetch attempt has completed.
		whenInitializedDeferred.complete();
		await whenInitializedDeferred.p;
		await Promise.resolve();

		expect(prompt).toHaveBeenCalledTimes(1);
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(mockShowDialog).not.toHaveBeenCalled();
	});

	it('notifies and closes without rendering when no providers are enabled', async () => {
		getRegisteredSources.mockReturnValue([]);
		const onAction = vi.fn();
		const onClose = vi.fn();

		service.showLanguageModelModalDialog(onAction, onClose);
		whenInitializedDeferred.complete();
		await whenInitializedDeferred.p;
		await Promise.resolve();

		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0]).toBe(Severity.Info);
		expect(prompt.mock.calls[0][1]).toBe('No language model providers are enabled. Enable at least one provider in providers.json.');
		expect(onClose).toHaveBeenCalledTimes(1);
		expect(mockShowDialog).not.toHaveBeenCalled();
	});

	it('the no-providers prompt opens providers.json in an editor', async () => {
		getRegisteredSources.mockReturnValue([]);

		service.showLanguageModelModalDialog(vi.fn(), vi.fn());
		whenInitializedDeferred.complete();
		await whenInitializedDeferred.p;
		await Promise.resolve();

		const choices = prompt.mock.calls[0][2] as IPromptChoice[];
		await choices[0].run();

		expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({
			resource: expect.objectContaining({ path: '/home/u/.posit/ai/providers.json' }),
		}));
	});

	it('renders the dialog with the registered sources when providers are enabled', async () => {
		const sources = [makeSource('prov-a')];
		getRegisteredSources.mockReturnValue(sources);
		const onAction = vi.fn();
		const onClose = vi.fn();

		service.showLanguageModelModalDialog(onAction, onClose);
		whenInitializedDeferred.complete();
		await whenInitializedDeferred.p;
		await Promise.resolve();

		expect(prompt).not.toHaveBeenCalled();
		expect(mockShowDialog).toHaveBeenCalledTimes(1);
		expect(mockShowDialog.mock.calls[0][0]).toBe(sources);
		expect(mockShowNewModal).not.toHaveBeenCalled();
	});

	it('renders the new provider modal when the feature switch is enabled', () => {
		const sources = [makeSource('prov-a')];
		getRegisteredSources.mockReturnValue(sources);
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration('assistant.newProviderModal', true);

		service.showLanguageModelModalDialog(vi.fn(), vi.fn());

		expect(mockShowNewModal).toHaveBeenCalledTimes(1);
		expect(mockShowNewModal.mock.calls[0][0]).toBe(sources);
		expect(mockShowDialog).not.toHaveBeenCalled();
	});
});

describe('PositronAssistantService areCompletionsEnabled', () => {
	// Controllable per-test catalog enablement map, read synchronously by the
	// stubbed IAiProviderService.isEnabled, mirroring the real service's contract.
	let enabledCatalogIds: Set<string>;
	const onDidChangeProvidersEmitter = new Emitter<IProviderCatalogChangeData>();

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IAiProviderService, {
			isEnabled: (id: string) => enabledCatalogIds.has(id),
			onDidChangeProviders: onDidChangeProvidersEmitter.event,
			whenInitialized: Promise.resolve(),
		})
		.build();

	let service: PositronAssistantService;
	let configurationService: TestConfigurationService;
	let languageService: ILanguageService;

	beforeEach(() => {
		// Default to the catalog's copilot entry enabled; tests that need it
		// disabled override this set explicitly.
		enabledCatalogIds = new Set(['copilot']);
		configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		languageService = ctx.get(ILanguageService);
		service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronAssistantService));
	});

	/** Force the language guessed for a file so the enablement check is deterministic. */
	function guessLanguage(languageId: string | null): void {
		vi.spyOn(languageService, 'guessLanguageIdByFilepathOrFirstLine').mockReturnValue(languageId);
	}

	it('enables completions when the global setting is on and the language is not overridden', () => {
		configurationService.setUserConfiguration('github.copilot.enable', { '*': true });
		guessLanguage('python');

		expect(service.areCompletionsEnabled(URI.file('/path/to/file.py'))).toBe(true);
	});

	it('disables completions when the file language is explicitly turned off', () => {
		configurationService.setUserConfiguration('github.copilot.enable', { '*': true, r: false });
		guessLanguage('r');

		expect(service.areCompletionsEnabled(URI.file('/path/to/file.R'))).toBe(false);
	});

	it('disables completions when the enablement setting is absent', () => {
		// Regression guard for the default flip: the old inline-completions logic
		// defaulted to enabled when nothing was set, whereas delegating to
		// `github.copilot.enable` defaults to disabled for an absent setting.
		guessLanguage('python');

		expect(service.areCompletionsEnabled(URI.file('/path/to/file.py'))).toBe(false);
	});

	it('disables completions for files matching an AI exclusion pattern', () => {
		configurationService.setUserConfiguration('github.copilot.enable', { '*': true });
		configurationService.setUserConfiguration('positron.assistant.aiExcludes', ['*.py']);
		guessLanguage('python');

		expect(service.areCompletionsEnabled(URI.file('/path/to/file.py'))).toBe(false);
	});

	it('disables completions when the catalog copilot provider is disabled, even with the per-language setting on', () => {
		enabledCatalogIds.delete('copilot');
		configurationService.setUserConfiguration('github.copilot.enable', { '*': true });
		guessLanguage('python');

		expect(service.areCompletionsEnabled(URI.file('/path/to/file.py'))).toBe(false);
	});

	it('enables completions when the catalog copilot provider is enabled and the per-language setting is on', () => {
		configurationService.setUserConfiguration('github.copilot.enable', { '*': true });
		guessLanguage('python');

		expect(service.areCompletionsEnabled(URI.file('/path/to/file.py'))).toBe(true);
	});

	it('ignores the deprecated provider enable setting: catalog copilot enabled still wins', () => {
		configurationService.setUserConfiguration('github.copilot.enable', { '*': true });
		configurationService.setUserConfiguration('positron.assistant.provider.githubCopilot.enable', false);
		guessLanguage('python');

		expect(service.areCompletionsEnabled(URI.file('/path/to/file.py'))).toBe(true);
	});
});
