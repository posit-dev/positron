/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { DefaultTextProcessor } from '../defaultTextProcessor.js';
import { ReplaceStringProcessor } from '../replaceStringProcessor.js';
import { ReplaceSelectionProcessor } from '../replaceSelectionProcessor.js';
import { mock } from './utils.js';

suite('Text Processors', () => {
	let responseParts: vscode.ExtendedChatResponsePart[];
	let mockResponse: vscode.ChatResponseStream;
	let mockUri: vscode.Uri;
	let mockDocument: vscode.TextDocument;

	const createMockResponse = () => mock<vscode.ChatResponseStream>({
		markdown: (value: string | vscode.MarkdownString) => {
			responseParts.push(new vscode.ChatResponseMarkdownPart(value));
		},
		warning: (value: string | vscode.MarkdownString) => {
			responseParts.push(new vscode.ChatResponseWarningPart(value));
		},
		textEdit: (target: vscode.Uri, edits: vscode.TextEdit | vscode.TextEdit[] | true) => {
			if (edits === true) {
				responseParts.push(new vscode.ChatResponseTextEditPart(target, true));
			} else {
				responseParts.push(new vscode.ChatResponseTextEditPart(target, edits));
			}
		},
	});

	const getResponseParts = () => ({
		markdown: responseParts.filter(p => p instanceof vscode.ChatResponseMarkdownPart) as vscode.ChatResponseMarkdownPart[],
		warnings: responseParts.filter(p => p instanceof vscode.ChatResponseWarningPart) as vscode.ChatResponseWarningPart[],
		textEdits: responseParts.filter(p => p instanceof vscode.ChatResponseTextEditPart) as vscode.ChatResponseTextEditPart[]
	});

	setup(() => {
		responseParts = [];
		mockResponse = createMockResponse();
		mockUri = vscode.Uri.file('/test/file.ts');
		mockDocument = mock<vscode.TextDocument>({
			uri: mockUri,
			getText: () => 'test content',
			positionAt: (offset: number) => new vscode.Position(0, offset)
		});
	});

	test('DefaultTextProcessor handles regular text and warning tags', async () => {
		const processor = new DefaultTextProcessor(mockResponse);

		await processor.process('Some text ');
		await processor.process('<warning>This is a warning</warning>');
		await processor.process(' more text');
		await processor.flush();

		const { markdown, warnings, textEdits } = getResponseParts();
		const combinedMarkdown = markdown.map(p => p.value.value).join('');

		assert.strictEqual(combinedMarkdown, 'Some text  more text');
		assert.strictEqual(warnings.length, 1);
		assert.strictEqual(textEdits.length, 0);
	});

	test('ReplaceSelectionProcessor handles text and replaceSelection tags', async () => {
		const selection = new vscode.Selection(0, 0, 0, 5);
		const defaultTextProcessor = new DefaultTextProcessor(mockResponse);
		const processor = new ReplaceSelectionProcessor(mockUri, selection, mockResponse, defaultTextProcessor);

		await processor.process('Some text ');
		await processor.process('<warning>This is a warning</warning>');
		await processor.process(' more text');
		await processor.process('<replaceSelection>Replaced content</replaceSelection>');
		await processor.flush();

		const { markdown, warnings, textEdits } = getResponseParts();
		const combinedMarkdown = markdown.map(p => p.value.value).join('');

		assert.strictEqual(combinedMarkdown, 'Some text  more text');
		assert.strictEqual(warnings.length, 1);
		assert.strictEqual(warnings[0].value.value, 'This is a warning');
		assert.strictEqual(textEdits.length, 2);

		// First edit deletes selection, second edit inserts new content
		assert.strictEqual(textEdits[0].edits[0].newText, '');
		assert.strictEqual(textEdits[1].edits[0].newText, 'Replaced content');
	});

	test('ReplaceStringProcessor handles text and replaceString tags', async () => {
		const defaultTextProcessor = new DefaultTextProcessor(mockResponse);
		const processor = new ReplaceStringProcessor(mockDocument, mockResponse, defaultTextProcessor);

		await processor.process('<warning>This is a warning</warning>');
		await processor.process('Before ');
		await processor.process('<replaceString><old>test content</old><new>new content</new></replaceString>');
		await processor.process(' after');
		await processor.flush();

		const { markdown, warnings, textEdits } = getResponseParts();
		const combinedMarkdown = markdown.map(p => p.value.value).join('');

		assert.strictEqual(combinedMarkdown, 'Before  after');
		assert.strictEqual(warnings.length, 1);
		assert.strictEqual(warnings[0].value.value, 'This is a warning');
		assert.strictEqual(textEdits.length, 2);

		// First edit deletes old text, second edit inserts new text
		assert.strictEqual(textEdits[0].edits[0].newText, '');
		assert.strictEqual(textEdits[1].edits[0].newText, 'new content');
	});
});
