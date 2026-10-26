/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IConfigurationChangeEvent, IConfigurationService, IConfigurationValue } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { Extensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ErrorActionHandlerService } from '../../browser/errorActionHandlerService.js';
import { IErrorActionHandler, IErrorActionContext, IErrorActionHandlerService } from '../../common/errorAction.js';
import { AI_ENABLED_KEY } from '../../common/positronAIConfiguration.js';
import { DEFAULT_ERROR_ACTION_HANDLER_ID, ERROR_ACTIONS_AGENT_KEY } from '../../common/positronAIConfigurationKeys.js';
import { registerTestErrorActionHandler } from './errorActionTestUtils.js';

describe('ErrorActionHandlerService', () => {
	const logError = vi.fn();
	const logWarn = vi.fn();
	const notifyError = vi.fn();
	const notifyPrompt = vi.fn();
	const notifyWarn = vi.fn();
	const openUserSettings = vi.fn();
	const openWorkspaceSettings = vi.fn();
	const ctx = createTestContainer()
		.stub(ILogService, { error: logError, warn: logWarn })
		.stub(INotificationService, { error: notifyError, prompt: notifyPrompt, warn: notifyWarn })
		.stub(IPreferencesService, { openUserSettings, openWorkspaceSettings })
		.build();

	let configurationService: TestConfigurationService;

	beforeEach(() => {
		configurationService = new TestConfigurationService({ [AI_ENABLED_KEY]: true, [ERROR_ACTIONS_AGENT_KEY]: 'test-handler' });
		ctx.instantiationService.stub(IConfigurationService, configurationService);
	});

	function setConfiguration(key: string, value: unknown): void {
		configurationService.setUserConfiguration(key, value);
		configurationService.onDidChangeConfigurationEmitter.fire(
			stubInterface<IConfigurationChangeEvent>({ affectsConfiguration: (changed: string) => changed === key })
		);
	}

	function setAIEnabled(enabled: boolean): void {
		setConfiguration(AI_ENABLED_KEY, enabled);
	}

	function createService(): ErrorActionHandlerService {
		return ctx.disposables.add(ctx.instantiationService.createInstance(ErrorActionHandlerService));
	}

	/** Spy on the service's events. */
	function watchActiveHandler(service: ErrorActionHandlerService) {
		const onDidChangeActiveHandler = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveHandler(onDidChangeActiveHandler));
		return onDidChangeActiveHandler;
	}

	/** Make the setting's value come from somewhere other than user settings. */
	function setSettingSource(source: Partial<IConfigurationValue<string>>): void {
		vi.spyOn(configurationService, 'inspect').mockImplementation(<T>(key: string) => (key === ERROR_ACTIONS_AGENT_KEY ?
			{ value: configurationService.getValue(key), ...source } :
			{ value: configurationService.getValue(key) }) as IConfigurationValue<T>);
	}

	function createHandler(options: Partial<IErrorActionHandler> = {}): IErrorActionHandler {
		return { id: 'test-handler', label: 'Test Assistant', supportsChatContinuation: true, ask: async () => { }, ...options };
	}

	/** The ids and labels the setting lists. */
	function getChoices() {
		const schema = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties()[ERROR_ACTIONS_AGENT_KEY];
		return { ids: schema.enum, labels: schema.enumItemLabels };
	}

	it('makes the chosen handler active, and names it by its id while it is not registered', () => {
		const service = createService();
		const onDidChangeActiveHandler = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveHandler(onDidChangeActiveHandler));
		const handler = createHandler();
		const unavailable = { id: 'test-handler', label: 'test-handler', supportsChatContinuation: false };
		expect(service.activeHandler).toEqual(unavailable);

		const registration = service.register(handler);
		expect(service.activeHandler).toBe(handler);

		registration.dispose();
		expect(service.activeHandler).toEqual(unavailable);
		expect(onDidChangeActiveHandler.mock.calls).toEqual([[handler], [unavailable]]);
	});

	it('never makes a handler active that the user did not choose', () => {
		const service = createService();
		const onDidChangeActiveHandler = watchActiveHandler(service);
		ctx.disposables.add(service.register(createHandler({ id: 'other' })));

		expect(service.activeHandler?.id).toBe('test-handler');
		expect(onDidChangeActiveHandler).not.toHaveBeenCalled();
	});

	it('returns the same unregistered handler on each read', () => {
		const service = createService();

		expect(service.activeHandler).toBe(service.activeHandler);
	});

	it('has no active handler once AI is disabled, even while the chosen handler is not registered', () => {
		const service = createService();
		const onDidChangeActiveHandler = watchActiveHandler(service);

		setAIEnabled(false);

		expect(service.activeHandler).toBeUndefined();
		expect(onDidChangeActiveHandler.mock.calls).toEqual([[undefined]]);
	});

	it('has no active handler once the user chooses the default while it is not registered', () => {
		const service = createService();
		const onDidChangeActiveHandler = watchActiveHandler(service);

		setConfiguration(ERROR_ACTIONS_AGENT_KEY, DEFAULT_ERROR_ACTION_HANDLER_ID);

		expect(service.activeHandler).toBeUndefined();
		expect(onDidChangeActiveHandler.mock.calls).toEqual([[undefined]]);
	});

	it('follows the setting', () => {
		const service = createService();
		const first = createHandler({ id: 'first' });
		const second = createHandler({ id: 'second' });
		ctx.disposables.add(service.register(first));
		ctx.disposables.add(service.register(second));
		const onDidChangeActiveHandler = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveHandler(onDidChangeActiveHandler));

		setConfiguration(ERROR_ACTIONS_AGENT_KEY, 'first');
		expect(service.activeHandler).toBe(first);

		setConfiguration(ERROR_ACTIONS_AGENT_KEY, 'second');
		expect(service.activeHandler).toBe(second);
		expect(onDidChangeActiveHandler.mock.calls).toEqual([[first], [second]]);
	});

	it('makes the default handler active only while it is registered', () => {
		configurationService = new TestConfigurationService({ [AI_ENABLED_KEY]: true });
		ctx.instantiationService.stub(IConfigurationService, configurationService);
		const service = createService();
		expect(service.activeHandler).toBeUndefined();

		const onDidChangeActiveHandler = watchActiveHandler(service);
		const defaultHandler = createHandler({ id: DEFAULT_ERROR_ACTION_HANDLER_ID });
		const registration = service.register(defaultHandler);
		expect(service.activeHandler).toBe(defaultHandler);

		registration.dispose();
		expect(service.activeHandler).toBeUndefined();
		expect(onDidChangeActiveHandler.mock.calls).toEqual([[defaultHandler], [undefined]]);
	});

	it('lists the default handler first and once, then the registered handlers', () => {
		setConfiguration(ERROR_ACTIONS_AGENT_KEY, DEFAULT_ERROR_ACTION_HANDLER_ID);
		const service = createService();
		const registration = service.register(createHandler({ id: 'second', label: 'Second' }));
		ctx.disposables.add(service.register(createHandler({ id: DEFAULT_ERROR_ACTION_HANDLER_ID, label: 'Posit Assistant' })));
		ctx.disposables.add(service.register(createHandler({ id: 'third', label: 'Third' })));
		expect(getChoices()).toEqual({ ids: ['posit-assistant', 'second', 'third'], labels: ['Posit Assistant', 'Second', 'Third'] });

		registration.dispose();
		expect(getChoices()).toEqual({ ids: ['posit-assistant', 'third'], labels: ['Posit Assistant', 'Third'] });
	});

	it('lists the chosen handler as not available while it is not registered', () => {
		const service = createService();
		expect(getChoices()).toEqual({ ids: ['posit-assistant', 'test-handler'], labels: ['Posit Assistant', 'test-handler (not available)'] });

		const registration = service.register(createHandler());
		expect(getChoices()).toEqual({ ids: ['posit-assistant', 'test-handler'], labels: ['Posit Assistant', 'Test Assistant'] });

		registration.dispose();
		setConfiguration(ERROR_ACTIONS_AGENT_KEY, DEFAULT_ERROR_ACTION_HANDLER_ID);
		expect(getChoices()).toEqual({ ids: ['posit-assistant'], labels: ['Posit Assistant'] });
	});

	it('lists a handler chosen in another scope as not available while it is not registered', () => {
		setConfiguration(ERROR_ACTIONS_AGENT_KEY, DEFAULT_ERROR_ACTION_HANDLER_ID);
		setSettingSource({ userLocalValue: 'some-agent', workspaceValue: DEFAULT_ERROR_ACTION_HANDLER_ID });
		createService();

		expect(getChoices()).toEqual({ ids: ['posit-assistant', 'some-agent'], labels: ['Posit Assistant', 'some-agent (not available)'] });
	});

	it('updates the choices in place, and only when they change', () => {
		const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
		const ids = registry.getConfigurationProperties()[ERROR_ACTIONS_AGENT_KEY].enum;
		const onDidSchemaChange = vi.fn();
		ctx.disposables.add(registry.onDidSchemaChange(onDidSchemaChange));
		const service = createService();
		onDidSchemaChange.mockClear();

		ctx.disposables.add(service.register(createHandler({ id: 'other', label: 'Other' })));
		ctx.disposables.add(service.register(createHandler({ id: DEFAULT_ERROR_ACTION_HANDLER_ID })));

		expect(registry.getConfigurationProperties()[ERROR_ACTIONS_AGENT_KEY].enum).toBe(ids);
		expect(onDidSchemaChange).toHaveBeenCalledTimes(1);
	});

	it('keeps its default when an extension contributes another one', () => {
		const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
		const configurationDefaults = [{ overrides: { [ERROR_ACTIONS_AGENT_KEY]: 'other' }, source: { id: 'some.extension', displayName: 'Some Extension' } }];
		registry.registerDefaultConfigurations(configurationDefaults);
		try {
			expect(registry.getConfigurationProperties()[ERROR_ACTIONS_AGENT_KEY].default).toBe(DEFAULT_ERROR_ACTION_HANDLER_ID);
		} finally {
			registry.deregisterDefaultConfigurations(configurationDefaults);
		}
	});

	it('lists only the default handler once the service is disposed', () => {
		const service = createService();
		ctx.disposables.add(service.register(createHandler({ id: 'second', label: 'Second' })));

		service.dispose();

		expect(getChoices()).toEqual({ ids: ['posit-assistant'], labels: ['Posit Assistant'] });
	});

	it('has no active handler while AI is disabled', () => {
		const service = createService();
		const onDidChangeActiveHandler = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveHandler(onDidChangeActiveHandler));
		const handler = createHandler();
		ctx.disposables.add(service.register(handler));

		setAIEnabled(false);
		expect(service.activeHandler).toBeUndefined();

		setAIEnabled(true);
		expect(service.activeHandler).toBe(handler);
		expect(onDidChangeActiveHandler.mock.calls).toEqual([[handler], [undefined], [handler]]);
	});

	it('has no active handler while ai.enabled is unset', () => {
		configurationService = new TestConfigurationService({ [ERROR_ACTIONS_AGENT_KEY]: 'test-handler' });
		ctx.instantiationService.stub(IConfigurationService, configurationService);
		const service = createService();
		ctx.disposables.add(service.register(createHandler()));

		expect(service.activeHandler).toBeUndefined();
	});

	it('throws when a handler with the same id is already registered', () => {
		const service = createService();
		const handler = createHandler();
		ctx.disposables.add(service.register(handler));

		expect(() => service.register(createHandler())).toThrow(`An error action handler with the id 'test-handler' is already registered`);
		expect(service.activeHandler).toBe(handler);
	});

	const context: IErrorActionContext = { kind: 'console', error: 'boom', sessionId: 'python-1', sessionName: 'Python 3.12.1', languageId: 'python' };

	it('asks the handler to take the action', async () => {
		const service = createService();
		const ask = vi.fn().mockResolvedValue(undefined);
		ctx.disposables.add(service.register(createHandler({ ask })));

		await service.ask('test-handler', 'fix', context, { continueChat: true });

		expect(ask).toHaveBeenCalledWith('fix', context, { continueChat: true });
		expect(notifyError).not.toHaveBeenCalled();
	});

	it('strips ANSI escape codes from the error', async () => {
		const service = createService();
		const ask = vi.fn();
		ctx.disposables.add(service.register(createHandler({ ask })));

		await service.ask('test-handler', 'fix', { ...context, error: '\u001b[31mNameError\u001b[0m: x' }, {});

		expect(ask.mock.calls[0][1].error).toBe('NameError: x');
	});

	it('starts a new chat when the handler cannot continue the active one', async () => {
		const service = createService();
		const ask = vi.fn();
		ctx.disposables.add(service.register(createHandler({ ask, supportsChatContinuation: false })));

		await service.ask('test-handler', 'fix', context, { continueChat: true });

		expect(ask.mock.calls[0][2]).toEqual({ continueChat: false });
	});

	it('asks the handler the user saw named, not the active one', async () => {
		const service = createService();
		const askFirst = vi.fn();
		const askSecond = vi.fn();
		ctx.disposables.add(service.register(createHandler({ id: 'first', ask: askFirst })));
		ctx.disposables.add(service.register(createHandler({ id: 'second', ask: askSecond })));

		await service.ask('second', 'fix', context, {});

		expect([askFirst.mock.calls.length, askSecond.mock.calls.length]).toEqual([0, 1]);
	});

	it('does nothing while AI is disabled', async () => {
		const service = createService();
		const ask = vi.fn().mockResolvedValue(undefined);
		ctx.disposables.add(service.register(createHandler({ ask })));
		setAIEnabled(false);

		await service.ask('test-handler', 'fix', context, {});

		expect(ask).not.toHaveBeenCalled();
	});

	it('sends nothing and offers to select another handler when the handler is not available', async () => {
		const service = createService();

		await service.ask('some-agent', 'fix', context, {});

		expect(logWarn).toHaveBeenCalledWith(`No error action handler with the id 'some-agent' is registered`);
		const [severity, message, [choice]] = notifyPrompt.mock.calls[0];
		expect({ severity, message, choice: choice.label }).toEqual({
			severity: Severity.Warning,
			message: `The coding agent 'some-agent' isn't available, so the error wasn't sent. It may have been uninstalled or disabled.`,
			choice: 'Select Another Coding Agent',
		});

		choice.run();
		expect(openUserSettings).toHaveBeenCalledWith({ query: ERROR_ACTIONS_AGENT_KEY, revealSetting: { key: ERROR_ACTIONS_AGENT_KEY } });
	});

	it('opens the settings the unavailable handler was chosen in', async () => {
		setSettingSource({ workspaceValue: 'some-agent', workspace: { value: 'some-agent' } });
		const service = createService();

		await service.ask('some-agent', 'fix', context, {});
		notifyPrompt.mock.calls[0][2][0].run();

		expect(openWorkspaceSettings).toHaveBeenCalled();
		expect(openUserSettings).not.toHaveBeenCalled();
	});

	it('does not offer to select another handler when an administrator chose it', async () => {
		setSettingSource({ policyValue: 'some-agent' });
		const service = createService();

		await service.ask('some-agent', 'fix', context, {});

		expect(notifyPrompt).not.toHaveBeenCalled();
		expect(notifyWarn).toHaveBeenCalledWith(`The coding agent 'some-agent' isn't available, so the error wasn't sent. Your administrator manages which coding agent errors are sent to.`);
	});

	it('sends nothing to the default handler while it is not registered, and says so', async () => {
		const service = createService();

		await service.ask(DEFAULT_ERROR_ACTION_HANDLER_ID, 'fix', context, {});

		expect(notifyPrompt).not.toHaveBeenCalled();
		expect(notifyWarn).toHaveBeenCalledWith(`Posit Assistant isn't available, so the error wasn't sent.`);
	});

	it('logs and notifies, rather than throws, when the handler fails', async () => {
		const service = createService();
		const error = new Error('command not found');
		ctx.disposables.add(service.register(createHandler({ ask: () => Promise.reject(error) })));

		await service.ask('test-handler', 'explain', context, {});

		expect(logError).toHaveBeenCalledWith('Failed to send the error to Test Assistant', error);
		expect(notifyError).toHaveBeenCalledWith('Could not send the error to Test Assistant: command not found');
	});
});

describe('ErrorActionHandlerService in the workbench preset', () => {
	// Stubbed after the preset runs, so the preset's service must pick it up.
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IConfigurationService, new TestConfigurationService())
		.build();

	it('reads the configuration service a test stubs', () => {
		registerTestErrorActionHandler(ctx);

		expect(ctx.get(IErrorActionHandlerService).activeHandler?.id).toBe('test-handler');
	});
});
