/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { PositronAssistantChatParticipant } from '../participants.js';
import { mock } from './utils.js';

class TestLanguageModelChatResponse implements vscode.LanguageModelChatResponse {
	stream: AsyncIterable<string> = {
		[Symbol.asyncIterator]: async function* () {
			yield "This is a test response from the language model.";
		}
	};
	text: AsyncIterable<string> = this.stream;
}

class TestLanguageModelChat implements vscode.LanguageModelChat {
	id = 'test-language-model-chat';
	name = 'TestLanguageModelChat';
	vendor = 'TestVendor';
	family = 'TestFamily';
	version = '1.0.0';
	maxInputTokens = 2048;
	async sendRequest(
		messages: (vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
		options?: vscode.LanguageModelChatRequestOptions,
		token?: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatResponse> {
		return new TestLanguageModelChatResponse();
	}
	async countTokens(
		text: string | vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2,
		token?: vscode.CancellationToken,
	): Promise<number> {
		const textString = typeof text === 'string' ? text : JSON.stringify(text);
		return Promise.resolve(textString.length);
	}
}

class TestChatResponseStream implements vscode.ChatResponseStream {
	progress(value: unknown, task?: unknown): void {
	}
	textEdit(target: unknown, isDone: unknown): void {
	}
	notebookEdit(target: unknown, isDone: unknown): void {
	}
	markdownWithVulnerabilities(value: string | vscode.MarkdownString, vulnerabilities: vscode.ChatVulnerability[]): void {
	}
	codeblockUri(uri: vscode.Uri, isEdit?: boolean): void {
	}
	push(part: unknown): void {
	}
	confirmation(title: string, message: string, data: any, buttons?: string[]): void {
	}
	warning(message: string | vscode.MarkdownString): void {
	}
	reference(value: unknown, iconPath?: unknown): void {
	}
	reference2(value: vscode.Uri | vscode.Location | string | { variableName: string; value?: vscode.Uri | vscode.Location }, iconPath?: vscode.Uri | vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri }, options?: { status?: { description: string; kind: vscode.ChatResponseReferencePartStatusKind } }): void {
	}
	codeCitation(value: vscode.Uri, license: string, snippet: string): void {
	}
	markdown(value: string | vscode.MarkdownString): void {
	}
	anchor(value: vscode.Uri | vscode.Location, title?: string): void {
	}
	button(command: vscode.Command): void {
	}
	filetree(value: vscode.ChatResponseFileTree[], baseUri: vscode.Uri): void {
	}
}

suite('PositronAssistantParticipant', () => {
	let model: TestLanguageModelChat;
	let response: TestChatResponseStream;
	let tokenSource: vscode.CancellationTokenSource;
	let token: vscode.CancellationToken;
	let referenceUri: vscode.Uri;
	let participant: PositronAssistantChatParticipant;
	setup(() => {
		model = new TestLanguageModelChat();
		response = new TestChatResponseStream();
		tokenSource = new vscode.CancellationTokenSource();
		token = tokenSource.token;

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspaceFolder, 'This test should be run from the ../test-workspace workspace');
		referenceUri = vscode.Uri.joinPath(workspaceFolder.uri, 'reference.ts');

		const extensionContext = mock<vscode.ExtensionContext>({});
		participant = new PositronAssistantChatParticipant(extensionContext);
	});

	teardown(() => {
		sinon.restore();
	});

	test('should not send context if none is available', async () => {
		// Setup test inputs.
		const request = makeChatRequest({ model, references: [] });
		const context: vscode.ChatContext = { history: [] };
		const sendRequestSpy = sinon.spy(model, 'sendRequest');
		sinon.stub(positron.ai, 'getPositronChatContext').resolves({});

		// Call the method under test.
		await participant.requestHandler(request, context, response, token);

		// There should be only one user message with the user's prompt,
		// since there is no available context.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		assert.strictEqual(messages.length, 1, `Unexpected messages: ${JSON.stringify(messages)}`);
		assert.strictEqual(messages[0].role, vscode.LanguageModelChatMessageRole.User);
		assertMessageTextEqual(messages[0], request.prompt);
	});

	test('should include positron session context', async () => {
		// Setup test inputs.
		const request = makeChatRequest({ model, references: [] });
		const context: vscode.ChatContext = { history: [] };
		const sendRequestSpy = sinon.spy(model, 'sendRequest');
		const positronChatContext: positron.ai.ChatContext = {
			console: {
				language: 'python',
				version: '3.12.0',
				executions: [
					{
						input: 'x = 1',
						output: '',
						error: undefined,
					},
				],
			},
			plots: {
				hasPlots: true,
			},
			variables: [
				{
					name: 'x',
					value: '1',
					type: 'number',
				},
			],
			shell: 'bash',
		};
		sinon.stub(positron.ai, 'getPositronChatContext').resolves(positronChatContext);

		// Call the method under test.
		await participant.requestHandler(request, context, response, token);

		// The first user message should contain the formatted context.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		assert.ok(messages.length > 0, `Unexpected messages: ${JSON.stringify(messages)}`);
		const message = messages[0];
		assert.strictEqual(message.role, vscode.LanguageModelChatMessageRole.User);
		const c = positronChatContext;
		assertMessageTextEqual(message,
			`<context>
<console>
<executions description="Current active console" language="${c.console!.language}" version="${c.console!.version}">
<execution>
${JSON.stringify(c.console!.executions[0])}
</execution>
</executions>
</console>

<variables description="Variables defined in the current session">
<variable>
${JSON.stringify(c.variables![0])}
</variable>
</variables>

<shell description="Current active shell">
${c.shell}
</shell>

<plots>
${c.plots!.hasPlots ? 'A plot is visible.' : ''}
</plots>
</context>`);
	});

	test('should include file reference', async () => {
		// Setup test inputs.
		const references: vscode.ChatPromptReference[] = [{
			id: 'test-file-reference',
			name: 'Test File',
			value: referenceUri,
			modelDescription: 'Test file description',
		}];
		const request = makeChatRequest({ model, references });
		const context: vscode.ChatContext = { history: [] };
		sinon.stub(positron.ai, 'getPositronChatContext').resolves({});
		const sendRequestSpy = sinon.spy(model, 'sendRequest');

		// Call the method under test.
		await participant.requestHandler(request, context, response, token);

		// The first user message should contain the formatted context.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		assert.ok(messages.length > 0, `Unexpected messages: ${JSON.stringify(messages)}`);
		const message = messages[0];
		assert.strictEqual(message.role, vscode.LanguageModelChatMessageRole.User);
		const document = await vscode.workspace.openTextDocument(referenceUri);
		const filePath = vscode.workspace.asRelativePath(referenceUri);
		assertMessageTextEqual(message,
			`<references>
<reference filePath="${filePath}" description="Full contents of the file" language="${document.languageId}">
${document.getText()}
</reference>
</references>`);
	});

	test('should include file range reference', async () => {
		// Setup test inputs.
		const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0));
		const location = new vscode.Location(referenceUri, range);
		const references: vscode.ChatPromptReference[] = [{
			id: 'test-file-reference',
			name: 'Test File',
			value: location,
			modelDescription: 'Test file description',
		}];
		const request = makeChatRequest({ model, references });
		const context: vscode.ChatContext = { history: [] };
		sinon.stub(positron.ai, 'getPositronChatContext').resolves({});
		const sendRequestSpy = sinon.spy(model, 'sendRequest');

		// Call the method under test.
		await participant.requestHandler(request, context, response, token);

		// The first user message should contain the formatted context.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		assert.ok(messages.length > 0, `Unexpected messages: ${JSON.stringify(messages)}`);
		const message = messages[0];
		assert.strictEqual(message.role, vscode.LanguageModelChatMessageRole.User);
		const document = await vscode.workspace.openTextDocument(referenceUri);
		const filePath = vscode.workspace.asRelativePath(referenceUri);
		assertMessageTextEqual(message,
			`<references>
<reference filePath="${filePath}" description="Visible region of the active file" language="${document.languageId}" startLine="${range.start.line + 1}" endLine="${range.end.line + 1}">
${document.getText(range)}
</reference>
<reference filePath="${filePath}" description="Full contents of the active file" language="${document.languageId}">
${document.getText()}
</reference>
</references>`);
	});

	// TODO: Continue here...
	test('should include llms.txt instructions', async () => {
	});

	test('should include image reference', async () => {
	});

	test('should include editor information', async () => {
	});
});

function makeChatRequest(
	options: {
		model: vscode.LanguageModelChat;
		references: vscode.ChatPromptReference[];
	},
): vscode.ChatRequest {
	return {
		id: 'test-request-id',
		prompt: 'Hello, world!',
		command: undefined,
		references: options.references,
		tools: [],
		toolReferences: [],
		toolInvocationToken: undefined as vscode.ChatParticipantToolToken,
		model: options.model,
		attempt: 0,
		location: vscode.ChatLocation.Panel,
		location2: undefined,
		enableCommandDetection: false,
		isParticipantDetected: false,
	};
}

function assertMessageTextEqual(
	message: vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2,
	expected: string,
): void {
	assert.strictEqual(message.content.length, 1);
	assert.ok(message.content[0] instanceof vscode.LanguageModelTextPart);
	assert.strictEqual(message.content[0].value, expected);
}
