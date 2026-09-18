/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

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

	// Note: DOMPurify strips all tags in the happy-dom test environment, so
	// <summary> elements from sanitized inner HTML won't appear. These tests
	// verify the grouping logic (content inside <details>) rather than the
	// sanitization output.

	it('groups split <details> tokens so content renders inside the element', () => {
		const { container } = renderMarkdown(
			'<details>\n<summary>Click me</summary>\n\nHidden content\n\n</details>'
		);

		// eslint-disable-next-line no-restricted-syntax -- <details> has no ARIA role
		const details = container.querySelector('details');
		expect(details).toBeInTheDocument();
		expect(details).toHaveTextContent('Hidden content');
	});

	it('groups nested <details> elements correctly', () => {
		const { container } = renderMarkdown(
			'<details>\n<summary>Outer</summary>\n\n' +
			'<details>\n<summary>Inner</summary>\n\nInner content\n\n</details>\n\n' +
			'Outer content\n\n</details>'
		);

		// eslint-disable-next-line no-restricted-syntax -- <details> has no ARIA role
		const allDetails = container.querySelectorAll('details');
		expect(allDetails).toHaveLength(2);
		expect(allDetails[0]).toHaveTextContent('Inner content');
		expect(allDetails[0]).toHaveTextContent('Outer content');
		expect(allDetails[1]).toHaveTextContent('Inner content');
	});

	it('preserves the open attribute on <details>', () => {
		const { container } = renderMarkdown(
			'<details open>\n<summary>Expanded</summary>\n\nVisible content\n\n</details>'
		);

		// eslint-disable-next-line no-restricted-syntax -- <details> has no ARIA role
		const details = container.querySelector('details');
		expect(details).toBeInTheDocument();
		expect(details).toHaveAttribute('open');
	});

	it('strips event handler attributes from grouped HTML elements', () => {
		const { container } = renderMarkdown(
			'<details onclick="alert(1)" open>\n<summary>Click</summary>\n\nContent\n\n</details>'
		);

		// eslint-disable-next-line no-restricted-syntax -- <details> has no ARIA role
		const details = container.querySelector('details');
		expect(details).toBeInTheDocument();
		expect(details).toHaveAttribute('open');
		expect(details).not.toHaveAttribute('onclick');
	});

	it('falls back to normal rendering for unclosed HTML tags', () => {
		const { container } = renderMarkdown(
			'<details>\n<summary>No closing tag</summary>\n\nContent here'
		);

		expect(container).toHaveTextContent('Content here');
	});

	it('groups split <div> tokens the same way as <details>', () => {
		const { container } = renderMarkdown(
			'<div>\n\nParagraph inside div\n\n</div>'
		);

		// eslint-disable-next-line no-restricted-syntax -- structural div with no role
		const div = container.querySelector('.raw-html-content + div, div > div');
		expect(container).toHaveTextContent('Paragraph inside div');
	});
});
