/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ErrorActionsService } from '../../browser/errorActionsService.js';
import { getPositAssistantChatOptions, PositAssistantErrorActionsContribution } from '../../browser/positAssistantErrorActions.js';
import { POSIT_HAS_CHAT_MODELS_KEY } from '../../browser/positAssistantChat.js';
import { ErrorActionKind, IErrorActionContext, IErrorActionsService } from '../../common/errorActions.js';

describe('PositAssistantErrorActionsContribution', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	const positAssistant = { identifier: new ExtensionIdentifier('posit.assistant') } as IExtensionDescription;

	let contextKeyService: ContextKeyService;
	let extensions: IExtensionDescription[];
	let onDidChangeExtensions: Emitter<{ readonly added: IExtensionDescription[]; readonly removed: IExtensionDescription[] }>;
	let errorActionsService: ErrorActionsService;

	beforeEach(() => {
		contextKeyService = ctx.disposables.add(new ContextKeyService(ctx.get(IConfigurationService)));
		ctx.instantiationService.stub(IContextKeyService, contextKeyService);

		extensions = [positAssistant];
		onDidChangeExtensions = ctx.disposables.add(new Emitter());
		ctx.instantiationService.stub(IExtensionService, {
			get extensions() { return extensions; },
			onDidChangeExtensions: onDidChangeExtensions.event,
		});

		errorActionsService = ctx.disposables.add(ctx.instantiationService.createInstance(ErrorActionsService));
		ctx.instantiationService.stub(IErrorActionsService, errorActionsService);
	});

	function createContribution() {
		ctx.disposables.add(ctx.instantiationService.createInstance(PositAssistantErrorActionsContribution));
	}

	it('takes errors only while Posit Assistant has a chat model', () => {
		const hasChatModels = contextKeyService.createKey<boolean>(POSIT_HAS_CHAT_MODELS_KEY, false);
		createContribution();
		expect(errorActionsService.activeHandler).toBeUndefined();

		hasChatModels.set(true);
		expect(errorActionsService.activeHandler).toBeDefined();
	});

	it('takes errors only while Posit Assistant is installed', () => {
		contextKeyService.createKey(POSIT_HAS_CHAT_MODELS_KEY, true);
		extensions = [];
		createContribution();
		expect(errorActionsService.activeHandler).toBeUndefined();

		extensions = [positAssistant];
		onDidChangeExtensions.fire({ added: [], removed: [] });
		expect(errorActionsService.activeHandler).toBeDefined();

		extensions = [];
		onDidChangeExtensions.fire({ added: [], removed: [] });
		expect(errorActionsService.activeHandler).toBeUndefined();
	});
});

describe('getPositAssistantChatOptions', () => {
	const constraint = 'Do not make changes or edit any files; just explain the error.';

	/** The newChat options for an action, with attachments decoded. */
	function getOptions(kind: ErrorActionKind, context: IErrorActionContext) {
		const options = getPositAssistantChatOptions(kind, context);
		return {
			...options,
			files: options.files?.map(file => ({ name: file.name, content: decodeBase64(file.uri.replace('data:text/plain;base64,', '')).toString() })),
		};
	}

	it('sends console errors verbatim, with no explain-only constraint', () => {
		const context: IErrorActionContext = { error: '  Error: boom\n', location: { kind: 'console' }, chat: 'current' };
		expect([getOptions('fix', context), getOptions('explain', context)]).toEqual([
			{ prompt: 'Fix this console error.', target: 'auto', behavior: 'submit', files: [{ name: 'Console Error', content: '  Error: boom\n' }] },
			{ prompt: 'Explain this console error.', target: 'auto', behavior: 'submit', files: [{ name: 'Console Error', content: '  Error: boom\n' }] },
		]);
	});

	it('strips ANSI escape codes and whitespace from notebook errors, and constrains Explain', () => {
		const context: IErrorActionContext = { error: '\n \u001b[31mValueError\u001b[0m: boom\n', location: { kind: 'notebook' }, chat: 'new' };
		expect([getOptions('fix', context), getOptions('explain', context)]).toEqual([
			{ prompt: 'Fix this notebook cell error.', target: 'new', behavior: 'submit', files: [{ name: 'Notebook Cell Error', content: 'ValueError: boom' }] },
			{ prompt: `Explain this notebook cell error. ${constraint}`, target: 'new', behavior: 'submit', files: [{ name: 'Notebook Cell Error', content: 'ValueError: boom' }] },
		]);
	});

	it('names a Quarto chunk and attaches its code above the error', () => {
		const context: IErrorActionContext = {
			error: '\u001b[31mValueError\u001b[0m: boom\n',
			location: { kind: 'quarto', chunk: { path: 'report.qmd', languageId: 'python', label: 'setup', code: 'raise ValueError("boom")', startLine: 8, endLine: 8 } },
			chat: 'new',
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
		const context: IErrorActionContext = { error: 'NameError: x', location: { kind: 'quarto' }, chat: 'current' };
		expect([getOptions('fix', context), getOptions('explain', context)]).toEqual([
			{ prompt: 'Fix this Quarto inline output error.', target: 'auto', behavior: 'submit', files: [{ name: 'Quarto Output Error', content: 'NameError: x' }] },
			{ prompt: `Explain this Quarto inline output error. ${constraint}`, target: 'auto', behavior: 'submit', files: [{ name: 'Quarto Output Error', content: 'NameError: x' }] },
		]);
	});

	it('omits the attachment when the error is blank', () => {
		expect([
			getOptions('fix', { error: '', location: { kind: 'console' }, chat: 'current' }).files,
			getOptions('fix', { error: ' \n', location: { kind: 'notebook' }, chat: 'new' }).files,
		]).toEqual([undefined, undefined]);
	});
});
