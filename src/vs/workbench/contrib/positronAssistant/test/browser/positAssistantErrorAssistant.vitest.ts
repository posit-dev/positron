/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

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
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ErrorAssistantService } from '../../browser/errorAssistantService.js';
import { getPositAssistantChatOptions, PositAssistantErrorAssistantContribution } from '../../browser/positAssistantErrorAssistant.js';
import { POSIT_HAS_CHAT_MODELS_KEY, POSIT_NEW_CHAT_COMMAND } from '../../browser/positAssistantChat.js';
import { ErrorAssistantAction, IErrorAssistantContext, IErrorAssistantOptions, IErrorAssistantService } from '../../common/errorAssistant.js';
import { AI_ENABLED_KEY } from '../../common/positronAIConfiguration.js';

describe('PositAssistantErrorAssistantContribution', () => {
	const executeCommand = vi.fn();
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(ICommandService, { executeCommand })
		.stub(ILabelService, { getUriLabel: (uri: URI) => uri.path.slice(1) })
		.build();

	const positAssistant = { identifier: new ExtensionIdentifier('posit.assistant') } as IExtensionDescription;

	let contextKeyService: ContextKeyService;
	let extensions: IExtensionDescription[];
	let onDidChangeExtensions: Emitter<{ readonly added: IExtensionDescription[]; readonly removed: IExtensionDescription[] }>;
	let errorAssistantService: ErrorAssistantService;

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

		errorAssistantService = ctx.disposables.add(ctx.instantiationService.createInstance(ErrorAssistantService));
		ctx.instantiationService.stub(IErrorAssistantService, errorAssistantService);
	});

	function createContribution() {
		ctx.disposables.add(ctx.instantiationService.createInstance(PositAssistantErrorAssistantContribution));
	}

	it('takes errors only while Posit Assistant has a chat model', () => {
		const hasChatModels = contextKeyService.createKey<boolean>(POSIT_HAS_CHAT_MODELS_KEY, false);
		createContribution();
		expect(errorAssistantService.activeAssistant).toBeUndefined();

		hasChatModels.set(true);
		expect(errorAssistantService.activeAssistant).toBeDefined();

		hasChatModels.set(false);
		expect(errorAssistantService.activeAssistant).toBeUndefined();
	});

	it('takes errors only while Posit Assistant is installed', () => {
		contextKeyService.createKey(POSIT_HAS_CHAT_MODELS_KEY, true);
		extensions = [];
		createContribution();
		expect(errorAssistantService.activeAssistant).toBeUndefined();

		extensions = [positAssistant];
		onDidChangeExtensions.fire({ added: [], removed: [] });
		expect(errorAssistantService.activeAssistant).toBeDefined();

		extensions = [];
		onDidChangeExtensions.fire({ added: [], removed: [] });
		expect(errorAssistantService.activeAssistant).toBeUndefined();
	});

	it('opens a Posit Assistant chat, naming documents relative to the workspace', async () => {
		contextKeyService.createKey(POSIT_HAS_CHAT_MODELS_KEY, true);
		createContribution();
		const chunk = { uri: URI.file('/report.qmd'), languageId: 'python', code: 'x', startLine: 1, endLine: 1 };

		await errorAssistantService.run('posit-assistant', 'fix', { error: 'boom', location: { kind: 'quarto', chunk } }, {});

		expect(executeCommand).toHaveBeenCalledWith(POSIT_NEW_CHAT_COMMAND, expect.objectContaining({
			prompt: 'Fix the error from the python code chunk at lines 1-1 of report.qmd. The failing code and its error output are attached; fix only this error.',
			target: 'new',
		}));
	});
});

describe('getPositAssistantChatOptions', () => {
	const constraint = 'Do not make changes or edit any files; just explain the error.';

	/** The newChat options for an action, with attachments decoded. */
	function getOptions(action: ErrorAssistantAction, context: IErrorAssistantContext, options: IErrorAssistantOptions = {}) {
		const chatOptions = getPositAssistantChatOptions(action, context, options, uri => uri.path.slice(1));
		return {
			...chatOptions,
			files: chatOptions.files?.map(file => ({ name: file.name, content: decodeBase64(file.uri.replace('data:text/plain;base64,', '')).toString() })),
		};
	}

	it('sends console errors verbatim, with no explain-only constraint', () => {
		const context: IErrorAssistantContext = { error: '  Error: boom\n', location: { kind: 'console' } };
		expect([getOptions('fix', context, { continueChat: true }), getOptions('explain', context, { continueChat: true })]).toEqual([
			{ prompt: 'Fix this console error.', target: 'auto', behavior: 'submit', files: [{ name: 'Console Error', content: '  Error: boom\n' }] },
			{ prompt: 'Explain this console error.', target: 'auto', behavior: 'submit', files: [{ name: 'Console Error', content: '  Error: boom\n' }] },
		]);
	});

	it('trims whitespace from notebook errors, and constrains Explain', () => {
		const context: IErrorAssistantContext = { error: '\n ValueError: boom\n', location: { kind: 'notebook' } };
		expect([getOptions('fix', context), getOptions('explain', context)]).toEqual([
			{ prompt: 'Fix this notebook cell error.', target: 'new', behavior: 'submit', files: [{ name: 'Notebook Cell Error', content: 'ValueError: boom' }] },
			{ prompt: `Explain this notebook cell error. ${constraint}`, target: 'new', behavior: 'submit', files: [{ name: 'Notebook Cell Error', content: 'ValueError: boom' }] },
		]);
	});

	it('names a Quarto chunk and attaches its code above the error', () => {
		const context: IErrorAssistantContext = {
			error: 'ValueError: boom\n',
			location: { kind: 'quarto', chunk: { uri: URI.file('/report.qmd'), languageId: 'python', label: 'setup', code: 'raise ValueError("boom")', startLine: 8, endLine: 8 } },
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

	it('attaches only the error when the Quarto chunk is not known', () => {
		const context: IErrorAssistantContext = { error: 'NameError: x', location: { kind: 'quarto' } };
		expect([getOptions('fix', context, { continueChat: true }), getOptions('explain', context, { continueChat: true })]).toEqual([
			{ prompt: 'Fix this Quarto inline output error.', target: 'auto', behavior: 'submit', files: [{ name: 'Quarto Output Error', content: 'NameError: x' }] },
			{ prompt: `Explain this Quarto inline output error. ${constraint}`, target: 'auto', behavior: 'submit', files: [{ name: 'Quarto Output Error', content: 'NameError: x' }] },
		]);
	});

	it('omits the attachment when the error is blank', () => {
		expect([
			getOptions('fix', { error: '', location: { kind: 'console' } }).files,
			getOptions('fix', { error: ' \n', location: { kind: 'notebook' } }).files,
		]).toEqual([undefined, undefined]);
	});
});
