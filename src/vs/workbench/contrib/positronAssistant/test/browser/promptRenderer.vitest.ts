/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileContent, IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronChatContext } from '../../common/interfaces/positronAssistantService.js';
import { getPositronContextPrompts } from '../../browser/prompts/positronContextPrompts.js';
import { PromptRenderer } from '../../browser/prompts/promptRenderer.js';
import { PromptTemplateEngine } from '../../browser/prompts/promptTemplateEngine.js';

describe('PromptTemplateEngine', () => {
	it('interpolates property paths', () => {
		expect(PromptTemplateEngine.render('mode is {{positron.mode}}', { mode: 'agent' })).toBe('mode is agent');
	});

	it('renders the if branch when the condition holds and the else branch otherwise', () => {
		const template = '{{@if(positron.hasRSession)}}has R{{#else}}no R{{/if}}';
		expect(PromptTemplateEngine.render(template, { sessions: [{ languageId: 'r' }] })).toBe('has R');
		expect(PromptTemplateEngine.render(template, { sessions: [{ languageId: 'python' }] })).toBe('no R');
	});

	it('supports negation and equality conditions', () => {
		expect(PromptTemplateEngine.render('{{@if(!positron.hasPythonSession)}}none{{/if}}', { sessions: [] })).toBe('none');
		expect(PromptTemplateEngine.render(`{{@if(positron.mode == 'ask')}}asking{{/if}}`, { mode: 'ask' })).toBe('asking');
	});

	it('resolves nested request properties for selection templates', () => {
		const template = '{{@if(positron.request.location2.selection.isEmpty)}}empty{{#else}}has selection{{/if}}';
		expect(PromptTemplateEngine.render(template, { request: { location2: { selection: { isEmpty: true } } } })).toBe('empty');
		expect(PromptTemplateEngine.render(template, { request: { location2: { selection: { isEmpty: false } } } })).toBe('has selection');
	});
});

describe('PromptRenderer', () => {
	function rendererWith(files: Record<string, string>): PromptRenderer {
		const contentsByPath = new Map<string, string>();
		const children: IFileStat[] = Object.entries(files).map(([name, content]) => {
			const resource = URI.file(`/prompts/${name}`);
			contentsByPath.set(resource.path, content);
			return stubInterface<IFileStat>({ resource, name, isDirectory: false });
		});

		const fileService = stubInterface<IFileService>({
			// Cast needed because `resolve` is an overloaded method type.
			resolve: (async () => stubInterface<IFileStat>({ children })) as IFileService['resolve'],
			readFile: async (resource: URI) => stubInterface<IFileContent>({ value: VSBuffer.fromString(contentsByPath.get(resource.path) ?? '') }),
		});

		return new PromptRenderer(fileService, URI.file('/prompts'));
	}

	it('merges the fragments that match the mode, ordered by `order`', async () => {
		const renderer = rendererWith({
			'agent.md': '---\nmode: agent\norder: 50\n---\nAgent instructions.',
			'default.md': '---\nmode:\n  - ask\n  - agent\norder: 10\n---\nDefault instructions.',
			'ask.md': '---\nmode: ask\norder: 50\n---\nAsk instructions.',
		});

		// default (order 10) precedes agent (order 50); ask.md is excluded.
		expect(await renderer.renderModePrompt({ mode: 'agent' })).toBe('Default instructions.\n\nAgent instructions.');
	});

	it('returns an empty string when no fragment matches the mode', async () => {
		const renderer = rendererWith({ 'edit.md': '---\nmode: edit\norder: 10\n---\nEdit only.' });

		expect(await renderer.renderModePrompt({ mode: 'agent' })).toBe('');
	});
});

describe('getPositronContextPrompts', () => {
	it('emits a fragment for each populated context field', () => {
		const context: IPositronChatContext = {
			shell: 'bash',
			plots: { hasPlots: true },
			positronVersion: '2026.7.0',
			currentDate: '2026-07-03',
		};

		expect(getPositronContextPrompts(context)).toEqual([
			'<shell description="Current active shell">\nbash\n</shell>',
			'<plots>\nA plot is visible.\n</plots>',
			'<version>\nPositron version: 2026.7.0\n</version>',
			'<date>\nToday\'s date is: 2026-07-03\n</date>',
		]);
	});

	it('omits fragments for absent context and hidden plots', () => {
		expect(getPositronContextPrompts({ currentDate: '2026-07-03', plots: { hasPlots: false } })).toEqual([
			'<date>\nToday\'s date is: 2026-07-03\n</date>',
		]);
	});
});
