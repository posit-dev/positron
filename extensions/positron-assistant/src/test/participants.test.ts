/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { PositronAssistantChatParticipant, PositronAssistantEditorParticipant, ParticipantService } from '../participants.js';
import { mock } from './utils.js';
import { readFile } from 'fs/promises';
import { MARKDOWN_DIR } from '../constants.js';
import path = require('path');

/** We expect 2 messages by default: 1 for the user's prompt, and 1 containing at least the default context */
const DEFAULT_EXPECTED_MESSAGE_COUNT = 2;

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
	prepareToolInvocation(toolName: string): void {
	}
}

suite('PositronAssistantParticipant', () => {
	let disposables: vscode.Disposable[];
	let model: TestLanguageModelChat;
	let response: TestChatResponseStream;
	let tokenSource: vscode.CancellationTokenSource;
	let token: vscode.CancellationToken;
	let fileReferenceUri: vscode.Uri;
	let folderReferenceUri: vscode.Uri;
	let llmsTxtUri: vscode.Uri;
	let chatParticipant: PositronAssistantChatParticipant;
	let editorParticipant: PositronAssistantEditorParticipant;
	setup(() => {
		disposables = [];

		model = new TestLanguageModelChat();
		response = new TestChatResponseStream();
		tokenSource = new vscode.CancellationTokenSource();
		token = tokenSource.token;

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		assert.ok(workspaceFolder, 'This test should be run from the ../test-workspace workspace');
		fileReferenceUri = vscode.Uri.joinPath(workspaceFolder.uri, 'reference.ts');
		folderReferenceUri = vscode.Uri.joinPath(workspaceFolder.uri, 'folder');
		llmsTxtUri = vscode.Uri.joinPath(workspaceFolder.uri, 'llms.txt');

		const extensionContext = mock<vscode.ExtensionContext>({});
		const participantService = new ParticipantService();
		disposables.push(participantService);
		chatParticipant = new PositronAssistantChatParticipant(extensionContext, participantService);
		editorParticipant = new PositronAssistantEditorParticipant(extensionContext, participantService);
	});

	teardown(() => {
		sinon.restore();
		disposables.forEach((d) => d.dispose());
	});

	test('should include positron session context', async () => {
		// Setup test inputs.
		const request = makeChatRequest({ model, references: [] });
		const context: vscode.ChatContext = { history: [] };
		const sendRequestSpy = sinon.spy(model, 'sendRequest');
		const positronVersion = `${positron.version}-${positron.buildNumber}`;
		const positronChatContext: positron.ai.ChatContext = {
			plots: {
				hasPlots: true,
			},
			positronVersion,
			currentDate: 'Wednesday 11 June 2025 at 13:30:00 BST',
			shell: 'bash',
		};
		sinon.stub(positron.ai, 'getPositronChatContext').resolves(positronChatContext);

		// Call the method under test.
		await chatParticipant.requestHandler(request, context, response, token);

		// Check the context message.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		const c = positronChatContext;
		assert.strictEqual(messages.length, DEFAULT_EXPECTED_MESSAGE_COUNT, `Unexpected messages: ${JSON.stringify(messages)}`);
		assertContextMessage(messages.at(-1)!,
			`<context>
<shell description="Current active shell">
${c.shell}
</shell>

<plots>
${c.plots!.hasPlots ? 'A plot is visible.' : ''}
</plots>

<version>
Positron version: ${positronVersion}
</version>

<date>
Today's date is: Wednesday 11 June 2025 at 13:30:00 BST
</date>
</context>`);
	});

	test('should include file attachment', async () => {
		// Setup test inputs.
		const references: vscode.ChatPromptReference[] = [{
			id: 'test-file-reference',
			name: 'Test File',
			value: fileReferenceUri,
			modelDescription: 'Test file description',
		}];
		const request = makeChatRequest({ model, references });
		const context: vscode.ChatContext = { history: [] };
		sinon.stub(positron.ai, 'getPositronChatContext').resolves({});
		const sendRequestSpy = sinon.spy(model, 'sendRequest');

		// Call the method under test.
		await chatParticipant.requestHandler(request, context, response, token);

		// The first user message should contain the formatted context.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		const document = await vscode.workspace.openTextDocument(fileReferenceUri);
		const filePath = vscode.workspace.asRelativePath(fileReferenceUri);
		const attachmentsText = await readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'attachments.md'), 'utf8');
		assert.strictEqual(messages.length, DEFAULT_EXPECTED_MESSAGE_COUNT, `Unexpected messages: ${JSON.stringify(messages)}`);
		assertContextMessage(messages.at(-1)!,
			`<attachments>
${attachmentsText}
<attachment filePath="${filePath}" description="Full contents of the file" language="${document.languageId}">
${document.getText()}
</attachment>
</attachments>`);
	});

	test('should include folder attachment', async () => {
		// Setup test inputs.
		const references: vscode.ChatPromptReference[] = [{
			id: 'test-folder-reference',
			name: 'Test folder',
			value: folderReferenceUri,
			modelDescription: 'Test folder description',
		}];
		const request = makeChatRequest({ model, references });
		const context: vscode.ChatContext = { history: [] };
		sinon.stub(positron.ai, 'getPositronChatContext').resolves({});
		const sendRequestSpy = sinon.spy(model, 'sendRequest');

		// Call the method under test.
		await chatParticipant.requestHandler(request, context, response, token);

		// The first user message should contain the formatted context.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		const filePath = vscode.workspace.asRelativePath(folderReferenceUri);
		const attachmentsText = await readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'attachments.md'), 'utf8');
		assert.strictEqual(messages.length, DEFAULT_EXPECTED_MESSAGE_COUNT, `Unexpected messages: ${JSON.stringify(messages)}`);
		assertContextMessage(messages.at(-1)!,
			`<attachments>
${attachmentsText}
<attachment filePath="${filePath}" description="Contents of the directory">
file.txt
subfolder/
</attachment>
</attachments>`);
	});

	test('should include file range attachment', async () => {
		// Setup test inputs.
		const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0));
		const location = new vscode.Location(fileReferenceUri, range);
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
		await chatParticipant.requestHandler(request, context, response, token);

		// The first user message should contain the formatted context.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		const document = await vscode.workspace.openTextDocument(fileReferenceUri);
		const filePath = vscode.workspace.asRelativePath(fileReferenceUri);
		const attachmentsText = await readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'attachments.md'), 'utf8');
		assert.strictEqual(messages.length, DEFAULT_EXPECTED_MESSAGE_COUNT, `Unexpected messages: ${JSON.stringify(messages)}`);
		assertContextMessage(messages.at(-1)!,
			`<attachments>
${attachmentsText}
<attachment filePath="${filePath}" description="Visible region of the active file" language="${document.languageId}" startLine="${range.start.line + 1}" endLine="${range.end.line + 1}">
${document.getText(range)}
</attachment>
<attachment filePath="${filePath}" description="Full contents of the active file" language="${document.languageId}">
${document.getText()}
</attachment>
</attachments>`);
	});

	test('should include image reference', async () => {
		// Setup test inputs.
		const data = new Uint8Array();
		const referenceBinaryData = new vscode.ChatReferenceBinaryData('image/png', async () => data);
		const reference = {
			id: 'test-file-reference',
			name: 'image.png',
			value: referenceBinaryData,
			modelDescription: 'Test file description',
		};
		const references: vscode.ChatPromptReference[] = [reference];
		const request = makeChatRequest({ model, references });
		const context: vscode.ChatContext = { history: [] };
		sinon.stub(positron.ai, 'getPositronChatContext').resolves({});
		const sendRequestSpy = sinon.spy(model, 'sendRequest');

		// Call the method under test.
		await chatParticipant.requestHandler(request, context, response, token);

		// The first user message should contain the formatted context.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		const attachmentsText = await readFile(path.join(MARKDOWN_DIR, 'prompts', 'chat', 'attachments.md'), 'utf8');
		assert.strictEqual(messages.length, DEFAULT_EXPECTED_MESSAGE_COUNT, `Unexpected messages: ${JSON.stringify(messages)}`);
		assertContextMessage(messages.at(-1)!,
			`<attachments>
${attachmentsText}
<img src="${reference.name}" />
</attachments>`,
			{
				mimeType: referenceBinaryData.mimeType,
				data: data,
			});
	});

	test('should include llms.txt instructions', async () => {
		// Create an llms.txt file in the workspace.
		const llmsTxtContent = `This is a test llms.txt file.
It should be included in the chat message.`;
		await vscode.workspace.fs.writeFile(llmsTxtUri, Buffer.from(llmsTxtContent));

		try {
			// Setup test inputs.
			const request = makeChatRequest({ model, references: [] });
			const context: vscode.ChatContext = { history: [] };
			sinon.stub(positron.ai, 'getPositronChatContext').resolves({});
			const sendRequestSpy = sinon.spy(model, 'sendRequest');

			// Call the method under test.
			await chatParticipant.requestHandler(request, context, response, token);

			// The first user message should contain the formatted context.
			sinon.assert.calledOnce(sendRequestSpy);
			const [messages,] = sendRequestSpy.getCall(0).args;
			assert.strictEqual(messages.length, DEFAULT_EXPECTED_MESSAGE_COUNT, `Unexpected messages: ${JSON.stringify(messages)}`);
			assertContextMessage(messages.at(-1)!,
				`<instructions>
${llmsTxtContent}
</instructions>`);
		} finally {
			// Delete the llms.txt file from the workspace.
			await vscode.workspace.fs.delete(llmsTxtUri);
		}
	});

	test('should include editor information', async () => {
		const document = await vscode.workspace.openTextDocument(fileReferenceUri);
		const selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(1, 0));
		// TODO: Not sure what wholeRange is supposed to be. We don't currently use it.
		const wholeRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0));
		const editorData = new vscode.ChatRequestEditorData(document, selection, wholeRange);
		const request = makeChatRequest({ model, references: [], location2: editorData });
		const context: vscode.ChatContext = { history: [] };
		sinon.stub(positron.ai, 'getPositronChatContext').resolves({});
		const sendRequestSpy = sinon.spy(model, 'sendRequest');

		// Call the method under test.
		await editorParticipant.requestHandler(request, context, response, token);

		// The first user message should contain the formatted context.
		sinon.assert.calledOnce(sendRequestSpy);
		const [messages,] = sendRequestSpy.getCall(0).args;
		assert.strictEqual(messages.length, DEFAULT_EXPECTED_MESSAGE_COUNT, `Unexpected messages: ${JSON.stringify(messages)}`);
		const filePath = vscode.workspace.asRelativePath(fileReferenceUri);
		assertContextMessage(messages.at(-1)!,
			`<editor description="Current active editor" filePath="${filePath}" language="${document.languageId}" line="${selection.active.line + 1}" column="${selection.active.character + 1}" documentOffset="${document.offsetAt(selection.active)}">
<document description="Full contents of the active file">
${document.getText()}
</document>
<selection description="Selected text in the active file">
${document.getText(selection)}
</selection>
</editor>`);
	});
});

function makeChatRequest(
	options: {
		model: vscode.LanguageModelChat;
		references: vscode.ChatPromptReference[];
		location2?: vscode.ChatRequest['location2'];
	},
): vscode.ChatRequest {
	return {
		id: 'test-request-id',
		prompt: 'Hello, world!',
		command: undefined,
		references: options.references,
		tools: new Map(),
		toolReferences: [],
		toolInvocationToken: undefined as vscode.ChatParticipantToolToken,
		model: options.model,
		attempt: 0,
		location: vscode.ChatLocation.Panel,
		location2: options.location2,
		enableCommandDetection: false,
		isParticipantDetected: false,
	};
}

function assertMessageRole(
	message: vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2,
	expectedRole: vscode.LanguageModelChatMessageRole): void {
	assert.ok(message.role === expectedRole, `Unexpected message role: ${JSON.stringify(message)}`);
}

function assertMessageTextPart(
	part: (vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2)['content'][number],
	expectedText: string,
) {
	assert.ok(part instanceof vscode.LanguageModelTextPart, `Expected a text part, got: ${JSON.stringify(part)}`);
	assert.strictEqual(part.value, expectedText, 'Unexpected text part value');
}

function assertMessageDataPart(
	part: (vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2)['content'][number],
	expectedMimeType: string,
	expectedData: Uint8Array,
) {
	assert.ok(part instanceof vscode.LanguageModelDataPart, `Expected a data part, got: ${JSON.stringify(part)}`);
	assert.strictEqual(part.mimeType, expectedMimeType, 'Unexpected data part mime type');
	assert.strictEqual(part.data, expectedData, 'Unexpected data part value');
}

function assertContextMessage(
	message: vscode.LanguageModelChatMessage | vscode.LanguageModelChatMessage2,
	expectedPrompt: string,
	expectedImage?: { mimeType: string; data: Uint8Array },
): void {
	// Should be a user message.
	assertMessageRole(message, vscode.LanguageModelChatMessageRole.User);

	// The first part should be a text part with the formatted context.
	assertMessageTextPart(message.content[0], expectedPrompt);

	if (expectedImage) {
		// If an image is expected, the second part should be a data part with the image.
		assert.ok(message.content.length > 1, `Missing context message image part: ${JSON.stringify(message.content)}`);
		assertMessageDataPart(message.content[1], expectedImage.mimeType, expectedImage.data);
	} else {
		// If no image is expected, there should be only one part.
		assert.strictEqual(message.content.length, 1, `Unexpected message content: ${JSON.stringify(message.content)}`);
	}
}
