/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { decodeBase64 } from '../../../../../base/common/buffer.js';
import { Emitter } from '../../../../../base/common/event.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextKeyChangeEvent, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ErrorActionKind, IErrorActionContext, IErrorActionHandler, IErrorActionsService } from '../../common/errorActions.js';
import { getPositAssistantChatOptions, PositAssistantErrorActionsContribution } from '../../browser/positAssistantErrorActions.js';
import { NewChatOptions } from '../../browser/positAssistantChat.js';

const getPath = (uri: URI) => uri.path.split('/').at(-1)!;

/** The newChat request with its attachment decoded, for comparison. */
function getRequest(kind: ErrorActionKind, context: IErrorActionContext) {
	const { files, ...options } = getPositAssistantChatOptions(kind, context, getPath);
	return {
		...options,
		files: files?.map(file => ({ name: file.name, content: decodeBase64(file.uri.replace('data:text/plain;base64,', '')).toString() })),
	};
}

describe('getPositAssistantChatOptions', () => {
	it('attaches a notebook cell\'s code above its error', () => {
		expect(getRequest('fix', {
			error: 'NameError: x',
			location: { kind: 'notebook', uri: URI.file('/work/analysis.ipynb'), cellIndex: 2, code: 'x + 1', languageId: 'python' },
			chat: 'new',
		})).toEqual({
			prompt: 'Fix the error from cell 3 of analysis.ipynb. The failing code and its error output are attached; fix only this error.',
			target: 'new',
			behavior: 'submit',
			files: [{
				name: 'Notebook Cell Error',
				content: 'Error from cell 3 of analysis.ipynb:\n\n--- Failing code ---\nx + 1\n\n--- Error output ---\nNameError: x',
			}],
		});
	});

	it('attaches only the error once the notebook cell is removed', () => {
		expect(getRequest('fix', {
			error: 'NameError: x',
			location: { kind: 'notebook', uri: URI.file('/work/analysis.ipynb') },
			chat: 'new',
		})).toEqual({
			prompt: 'Fix this notebook cell error.',
			target: 'new',
			behavior: 'submit',
			files: [{ name: 'Notebook Cell Error', content: 'NameError: x' }],
		});
	});

	it('names a Quarto chunk and its label', () => {
		const request = getRequest('fix', {
			error: 'RuntimeError: boom',
			location: { kind: 'quarto', uri: URI.file('/work/report.qmd'), languageId: 'python', startLine: 8, endLine: 9, code: 'raise RuntimeError("boom")', label: 'setup' },
			chat: 'new',
		});
		expect({ prompt: request.prompt, files: request.files }).toEqual({
			prompt: 'Fix the error from the python code chunk at lines 8-9 of report.qmd. The failing code and its error output are attached; fix only this error.',
			files: [{
				name: 'Quarto Output Error',
				content: 'Error from the python code chunk in report.qmd, lines 8-9 (label: setup):\n\n--- Failing code ---\nraise RuntimeError("boom")\n\n--- Error output ---\nRuntimeError: boom',
			}],
		});
	});

	it('attaches only the error for the console', () => {
		const request = getRequest('fix', {
			error: 'NameError: x',
			location: { kind: 'console', sessionId: 'python-1234', sessionName: 'Python 3.12.1', languageId: 'python', code: 'print(x)' },
			chat: 'current',
		});
		expect({ prompt: request.prompt, target: request.target, files: request.files }).toEqual({
			prompt: 'Fix this console error.',
			target: 'auto',
			files: [{ name: 'Console Error', content: 'NameError: x' }],
		});
	});

	it('appends the explain-only constraint to the explain prompt', () => {
		expect(getRequest('explain', { error: 'boom', chat: 'new' }).prompt).toBe(
			'Explain this error. Do not make changes or edit any files; just explain the error.'
		);
	});

	it('omits the attachment when the error is blank', () => {
		expect(getRequest('fix', { error: '', chat: 'new' }).files).toBeUndefined();
	});
});

describe('PositAssistantErrorActionsContribution', () => {
	const onDidChangeContext = new Emitter<IContextKeyChangeEvent>();
	const onDidChangeExtensions = new Emitter<never>();
	/** The posit-assistant.hasChatModels context key's value. */
	let hasChatModels: boolean | undefined;
	let extensions: IExtensionDescription[];
	let registeredHandlers: IErrorActionHandler[];
	const executeCommand = vi.fn().mockResolvedValue(undefined);

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(ICommandService, { executeCommand })
		.stub(IContextKeyService, {
			onDidChangeContext: onDidChangeContext.event,
			getContextKeyValue: <T>() => hasChatModels as T,
		})
		.stub(IExtensionService, {
			onDidChangeExtensions: onDidChangeExtensions.event,
			get extensions() { return extensions; },
		})
		.stub(IErrorActionsService, {
			register: (handler: IErrorActionHandler) => {
				registeredHandlers.push(handler);
				return { dispose: () => registeredHandlers.splice(registeredHandlers.indexOf(handler), 1) };
			},
		})
		.stub(ILabelService, { getUriLabel: (uri: URI) => getPath(uri) })
		.build();

	beforeEach(() => {
		hasChatModels = true;
		extensions = [stubInterface<IExtensionDescription>({ identifier: new ExtensionIdentifier('posit.assistant') })];
		registeredHandlers = [];
	});

	function createContribution(): void {
		ctx.disposables.add(ctx.instantiationService.createInstance(PositAssistantErrorActionsContribution));
	}

	it('registers while Posit Assistant is installed and has a chat model', () => {
		createContribution();
		expect(registeredHandlers.map(({ id, label, canContinueChat }) => ({ id, label, canContinueChat }))).toEqual([
			{ id: 'posit-assistant', label: 'Posit Assistant', canContinueChat: true },
		]);
	});

	it('does not register while Posit Assistant is not installed', () => {
		extensions = [];
		createContribution();
		expect(registeredHandlers).toEqual([]);
	});

	it('unregisters when Posit Assistant loses its last chat model', () => {
		createContribution();
		hasChatModels = false;
		onDidChangeContext.fire({ affectsSome: () => true, allKeysContainedIn: () => true });
		expect(registeredHandlers).toEqual([]);
	});

	it('sends the error to a Posit Assistant chat', async () => {
		createContribution();
		await registeredHandlers[0].run('fix', { error: 'boom', chat: 'current' }, CancellationToken.None);

		const [command, options] = executeCommand.mock.calls[0] as [string, NewChatOptions];
		expect({ command, prompt: options.prompt, target: options.target }).toEqual({
			command: 'posit-assistant.newChat',
			prompt: 'Fix this error.',
			target: 'auto',
		});
	});
});
