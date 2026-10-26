/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { getPositAssistantChatOptions, PositAssistantErrorActionHandlerContribution } from '../../browser/positAssistantErrorActionHandler.js';
import { POSIT_HAS_CHAT_MODELS_KEY, POSIT_NEW_CHAT_COMMAND } from '../../browser/positAssistantChat.js';
import { ErrorAction, IErrorActionContext, IErrorActionOptions, IErrorActionHandlerService } from '../../common/errorAction.js';
import { AI_ENABLED_KEY } from '../../common/positronAIConfiguration.js';

describe('PositAssistantErrorActionHandlerContribution', () => {
	const executeCommand = vi.fn();
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(ICommandService, { executeCommand })
		// Relative to a workspace at the root, so a dropped `relative` option shows.
		.stub(ILabelService, { getUriLabel: (uri: URI, options?: { relative?: boolean }) => options?.relative ? uri.path.slice(1) : uri.path })
		.build();

	const positAssistant = stubInterface<IExtensionDescription>({ identifier: new ExtensionIdentifier('posit.assistant') });

	let contextKeyService: ContextKeyService;
	let extensions: IExtensionDescription[];
	let onDidChangeExtensions: Emitter<{ readonly added: IExtensionDescription[]; readonly removed: IExtensionDescription[] }>;
	let errorActionHandlerService: IErrorActionHandlerService;

	beforeEach(() => {
		executeCommand.mockResolvedValue(undefined);
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(AI_ENABLED_KEY, true);
		contextKeyService = ctx.disposables.add(new ContextKeyService(ctx.get(IConfigurationService)));
		ctx.instantiationService.stub(IContextKeyService, contextKeyService);

		extensions = [positAssistant];
		onDidChangeExtensions = ctx.disposables.add(new Emitter());
		ctx.instantiationService.stub(IExtensionService, {
			get extensions() { return extensions; },
			onDidChangeExtensions: onDidChangeExtensions.event,
		});

		errorActionHandlerService = ctx.get(IErrorActionHandlerService);
	});

	function createContribution() {
		ctx.disposables.add(ctx.instantiationService.createInstance(PositAssistantErrorActionHandlerContribution));
	}

	it('takes errors only while Posit Assistant has a chat model', () => {
		const hasChatModels = contextKeyService.createKey<boolean>(POSIT_HAS_CHAT_MODELS_KEY, false);
		createContribution();
		expect(errorActionHandlerService.activeHandler).toBeUndefined();

		hasChatModels.set(true);
		expect(errorActionHandlerService.activeHandler).toEqual(expect.objectContaining({
			id: 'posit-assistant',
			label: 'Posit Assistant',
			supportsChatContinuation: true,
		}));

		hasChatModels.set(false);
		expect(errorActionHandlerService.activeHandler).toBeUndefined();
	});

	it('takes errors only while Posit Assistant is installed', () => {
		contextKeyService.createKey(POSIT_HAS_CHAT_MODELS_KEY, true);
		extensions = [];
		createContribution();
		expect(errorActionHandlerService.activeHandler).toBeUndefined();

		extensions = [positAssistant];
		onDidChangeExtensions.fire({ added: [], removed: [] });
		expect(errorActionHandlerService.activeHandler).toBeDefined();

		extensions = [];
		onDidChangeExtensions.fire({ added: [], removed: [] });
		expect(errorActionHandlerService.activeHandler).toBeUndefined();
	});

	it('opens a Posit Assistant chat, naming documents relative to the workspace', async () => {
		contextKeyService.createKey(POSIT_HAS_CHAT_MODELS_KEY, true);
		createContribution();
		const cell = { languageId: 'python', code: 'x', startLine: 1, endLine: 1 };

		await errorActionHandlerService.ask('posit-assistant', 'fix', { kind: 'quarto', error: 'boom', uri: URI.file('/report.qmd'), cell }, { continueChat: true });

		expect(executeCommand).toHaveBeenCalledWith(POSIT_NEW_CHAT_COMMAND, expect.objectContaining({
			prompt: 'Fix the error from the python code chunk at lines 1-1 of report.qmd. The failing code and its error output are attached; fix only this error.',
			target: 'auto',
		}));
	});
});

describe('getPositAssistantChatOptions', () => {
	const constraint = 'Do not make changes or edit any files; just explain the error.';

	/** The newChat options for an action, with attachments decoded. */
	function getOptions(action: ErrorAction, context: IErrorActionContext, options: IErrorActionOptions = {}) {
		const chatOptions = getPositAssistantChatOptions(action, context, options, uri => uri.path.slice(1));
		return {
			...chatOptions,
			files: chatOptions.files?.map(file => ({ name: file.name, content: decodeBase64(file.uri.replace('data:text/plain;base64,', '')).toString() })),
		};
	}

	it('sends console errors verbatim, and constrains Explain', () => {
		const context: IErrorActionContext = { kind: 'console', error: '  Error: boom\n', sessionId: 'python-1', sessionName: 'Python 3.12.1', languageId: 'python' };
		expect([getOptions('fix', context, { continueChat: true }), getOptions('explain', context, { continueChat: true })]).toEqual([
			{ prompt: 'Fix this console error.', target: 'auto', behavior: 'submit', files: [{ name: 'Console Error', content: '  Error: boom\n' }] },
			{ prompt: `Explain this console error. ${constraint}`, target: 'auto', behavior: 'submit', files: [{ name: 'Console Error', content: '  Error: boom\n' }] },
		]);
	});

	it('trims whitespace from notebook errors, and constrains Explain', () => {
		const context: IErrorActionContext = { kind: 'notebook', error: '\n ValueError: boom\n', uri: URI.file('/analysis.ipynb') };
		expect([getOptions('fix', context), getOptions('explain', context)]).toEqual([
			{ prompt: 'Fix this notebook cell error.', target: 'new', behavior: 'submit', files: [{ name: 'Notebook Cell Error', content: 'ValueError: boom' }] },
			{ prompt: `Explain this notebook cell error. ${constraint}`, target: 'new', behavior: 'submit', files: [{ name: 'Notebook Cell Error', content: 'ValueError: boom' }] },
		]);
	});

	it('names a Quarto cell and attaches its code above the error', () => {
		const context: IErrorActionContext = {
			kind: 'quarto',
			error: 'ValueError: boom\n',
			uri: URI.file('/report.qmd'),
			cell: { languageId: 'python', label: 'setup', code: 'raise ValueError("boom")', startLine: 8, endLine: 8 },
		};
		const content = [
			'Error from the python code chunk in report.qmd, lines 8-8 (label: setup):',
			'',
			'--- Failing code ---',
			'raise ValueError("boom")',
			'',
			'--- Error output ---',
			'ValueError: boom',
		].join('\n');
		expect([getOptions('fix', context), getOptions('explain', context)]).toEqual([
			{ prompt: 'Fix the error from the python code chunk at lines 8-8 of report.qmd. The failing code and its error output are attached; fix only this error.', target: 'new', behavior: 'submit', files: [{ name: 'Quarto Output Error', content }] },
			{ prompt: `Explain the error from the python code chunk at lines 8-8 of report.qmd. The failing code and its error output are attached. ${constraint}`, target: 'new', behavior: 'submit', files: [{ name: 'Quarto Output Error', content }] },
		]);
	});

	it('attaches only the error when the Quarto cell is not known', () => {
		const context: IErrorActionContext = { kind: 'quarto', error: 'NameError: x', uri: URI.file('/report.qmd') };
		expect([getOptions('fix', context, { continueChat: true }), getOptions('explain', context, { continueChat: true })]).toEqual([
			{ prompt: 'Fix this Quarto inline output error.', target: 'auto', behavior: 'submit', files: [{ name: 'Quarto Output Error', content: 'NameError: x' }] },
			{ prompt: `Explain this Quarto inline output error. ${constraint}`, target: 'auto', behavior: 'submit', files: [{ name: 'Quarto Output Error', content: 'NameError: x' }] },
		]);
	});

	it('omits the attachment when the error is blank', () => {
		expect([
			getOptions('fix', { kind: 'console', error: '', sessionId: 'python-1', sessionName: 'Python 3.12.1', languageId: 'python' }).files,
			getOptions('fix', { kind: 'notebook', error: ' \n', uri: URI.file('/analysis.ipynb') }).files,
		]).toEqual([undefined, undefined]);
	});
});
