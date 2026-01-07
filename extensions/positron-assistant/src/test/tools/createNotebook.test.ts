/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { createNotebookToolImpl } from '../../tools/createNotebook.js';

suite('CreateNotebook Tool', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('prepareInvocation', () => {
		test('prepares confirmation message for Python', async () => {
			const prepared = await createNotebookToolImpl.prepareInvocation(
				{ input: { language: 'python' } },
				new vscode.CancellationTokenSource().token
			);

			assert.ok(prepared.confirmationMessages?.message.includes('Python'));
			assert.ok(prepared.invocationMessage?.includes('Python'));
		});

		test('prepares confirmation message for R', async () => {
			const prepared = await createNotebookToolImpl.prepareInvocation(
				{ input: { language: 'r' } },
				new vscode.CancellationTokenSource().token
			);

			assert.ok(prepared.confirmationMessages?.message.includes('R'));
			assert.ok(prepared.invocationMessage?.includes('R'));
		});
	});

	suite('invoke', () => {
		test('rejects invalid language', async () => {
			const result = await createNotebookToolImpl.invoke(
				{ input: { language: 'javascript' as any } },
				new vscode.CancellationTokenSource().token
			);

			const textPart = result.content[0] as vscode.LanguageModelTextPart;
			assert.ok(textPart.value.includes('Invalid language'));
		});

		test('handles cancellation', async () => {
			const tokenSource = new vscode.CancellationTokenSource();
			tokenSource.cancel();

			const result = await createNotebookToolImpl.invoke(
				{ input: { language: 'python' } },
				tokenSource.token
			);

			const textPart = result.content[0] as vscode.LanguageModelTextPart;
			assert.ok(textPart.value.includes('cancelled'));
		});

		test('normalizes language to lowercase', async () => {
			const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
			executeCommandStub.resolves();

			// Mock positron.notebooks.getContext to return context after creation
			const getContextStub = sandbox.stub(positron.notebooks, 'getContext');
			getContextStub.onFirstCall().resolves(null); // Before creation
			getContextStub.onSecondCall().resolves({ uri: 'test://notebook.ipynb' } as any); // After creation

			await createNotebookToolImpl.invoke(
				{ input: { language: 'PYTHON' as any } },
				new vscode.CancellationTokenSource().token
			);

			assert.ok(executeCommandStub.calledWith('ipynb.newUntitledIpynb', 'python'));
		});

		test('includes EditNotebookCells guidance when no prior notebook exists', async () => {
			const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
			executeCommandStub.resolves();

			// Mock positron.notebooks.getContext to return null initially (no notebook),
			// then return context after creation
			const getContextStub = sandbox.stub(positron.notebooks, 'getContext');
			getContextStub.onFirstCall().resolves(null); // Before creation
			getContextStub.onSecondCall().resolves({ uri: 'test://notebook.ipynb' } as any); // After creation

			const result = await createNotebookToolImpl.invoke(
				{ input: { language: 'python' } },
				new vscode.CancellationTokenSource().token
			);

			const textPart = result.content[0] as vscode.LanguageModelTextPart;
			// Should include detailed EditNotebookCells guidance
			assert.ok(textPart.value.includes('EditNotebookCells'));
			assert.ok(textPart.value.includes('operation'));
			assert.ok(textPart.value.includes('cellType'));
		});

		test('returns simple result when prior notebook exists', async () => {
			const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
			executeCommandStub.resolves();

			// Mock positron.notebooks.getContext to return context both times
			// (notebook existed before and after creation)
			const getContextStub = sandbox.stub(positron.notebooks, 'getContext');
			getContextStub.resolves({ uri: 'test://notebook.ipynb' } as any);

			const result = await createNotebookToolImpl.invoke(
				{ input: { language: 'python' } },
				new vscode.CancellationTokenSource().token
			);

			const textPart = result.content[0] as vscode.LanguageModelTextPart;
			// Should be a simple result without detailed instructions
			assert.ok(textPart.value.includes('Created new python notebook'));
			assert.ok(!textPart.value.includes('operation'));
			assert.ok(!textPart.value.includes('cellType'));
		});

		test('handles context unavailable after creation', async () => {
			const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
			executeCommandStub.resolves();

			// Mock positron.notebooks.getContext to return null both times
			const getContextStub = sandbox.stub(positron.notebooks, 'getContext');
			getContextStub.resolves(null);

			const result = await createNotebookToolImpl.invoke(
				{ input: { language: 'python' } },
				new vscode.CancellationTokenSource().token
			);

			const textPart = result.content[0] as vscode.LanguageModelTextPart;
			assert.ok(textPart.value.includes('context unavailable'));
		});

		test('handles command execution errors', async () => {
			const executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand');
			executeCommandStub.rejects(new Error('Command failed'));

			// Mock positron.notebooks.getContext for the initial check
			const getContextStub = sandbox.stub(positron.notebooks, 'getContext');
			getContextStub.resolves(null);

			const result = await createNotebookToolImpl.invoke(
				{ input: { language: 'python' } },
				new vscode.CancellationTokenSource().token
			);

			const textPart = result.content[0] as vscode.LanguageModelTextPart;
			assert.ok(textPart.value.includes('Failed to create notebook'));
			assert.ok(textPart.value.includes('Command failed'));
		});
	});
});
