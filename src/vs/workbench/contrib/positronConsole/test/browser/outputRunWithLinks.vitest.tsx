/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { OutputRunWithLinks } from '../../browser/components/outputRunWithLinks.js';

describe('OutputRunWithLinks', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders text without links unchanged', () => {
		const { container } = rtl.render(<OutputRunWithLinks text='no links here' />);
		expect(container).toHaveTextContent('no links here', { normalizeWhitespace: false });
		expect(screen.queryByRole('link')).not.toBeInTheDocument();
	});

	it('renders distinct links in order', () => {
		const text = 'see http://localhost:8080/ and http://localhost:8081/ now';
		const { container } = rtl.render(<OutputRunWithLinks text={text} />);
		expect(container).toHaveTextContent(text, { normalizeWhitespace: false });
		expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual([
			'http://localhost:8080/',
			'http://localhost:8081/',
		]);
	});

	// https://github.com/posit-dev/positron/issues/11627
	it('does not duplicate text when a URL is a prefix of an earlier link', () => {
		const text = '[1] "https://xkcd.comFoo https://xkcd.com"';
		const { container } = rtl.render(<OutputRunWithLinks text={text} />);
		expect(container).toHaveTextContent(text, { normalizeWhitespace: false });
		expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual([
			'https://xkcd.comFoo',
			'https://xkcd.com',
		]);
	});

	// https://github.com/posit-dev/positron/issues/11627
	it('does not duplicate text when the same URL appears more than once', () => {
		const text = '[1] "whatever https://google.comGoogle url is https://google.com or http://google.com"';
		const { container } = rtl.render(<OutputRunWithLinks text={text} />);
		expect(container).toHaveTextContent(text, { normalizeWhitespace: false });
		expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual([
			'https://google.comGoogle',
			'https://google.com',
			'http://google.com',
		]);
	});

	it('links each copy of a repeated URL', () => {
		const text = 'https://example.com and https://example.com';
		const { container } = rtl.render(<OutputRunWithLinks text={text} />);
		expect(container).toHaveTextContent(text, { normalizeWhitespace: false });
		expect(screen.getAllByRole('link')).toHaveLength(2);
	});
});
