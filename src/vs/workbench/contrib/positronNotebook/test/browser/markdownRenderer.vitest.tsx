/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import * as marked from '../../../../../base/common/marked/marked.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { TokenMarkdownRenderer } from '../../browser/markdownRenderer.js';

describe('TokenMarkdownRenderer', () => {
	const rtl = setupRTLRenderer();

	function renderMarkdown(content: string) {
		// Use marked.lexer directly: KaTeX/superscript/footnote extensions are
		// only relevant for content that triggers them, and our fixtures are
		// plain CommonMark.
		const tokens = marked.lexer(content);
		const renderer = new TokenMarkdownRenderer(
			stubInterface<IExtensionService>({}),
			stubInterface<ILanguageService>({}),
		);
		return rtl.render(<>{renderer.render(tokens)}</>);
	}

	it('renders headings (h1, h2) and emphasis (strong, em) from a multi-paragraph fixture', () => {
		renderMarkdown('# Heading 1\n\n## Heading 2\n\n**Bold Text**\n\n*Italic Text*');

		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Heading 1');
		expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Heading 2');
		expect(screen.getByText('Bold Text', { selector: 'strong' })).toBeInTheDocument();
		expect(screen.getByText('Italic Text', { selector: 'em' })).toBeInTheDocument();
	});

	it('renders inline strong and em within a single paragraph', () => {
		renderMarkdown('This is **bold** and this is *italic*');

		expect(screen.getByText('bold', { selector: 'strong' })).toBeInTheDocument();
		expect(screen.getByText('italic', { selector: 'em' })).toBeInTheDocument();
	});

	it('produces no headings when content is empty', () => {
		renderMarkdown('');

		expect(screen.queryByRole('heading')).not.toBeInTheDocument();
	});

	it('renders plain text without inserting strong or em tags', () => {
		renderMarkdown('This is just plain text.');

		expect(screen.getByText('This is just plain text.')).toBeInTheDocument();
		expect(screen.queryByText('This is just plain text.', { selector: 'strong' })).not.toBeInTheDocument();
		expect(screen.queryByText('This is just plain text.', { selector: 'em' })).not.toBeInTheDocument();
	});
});
