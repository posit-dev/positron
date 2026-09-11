/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

import { render, screen } from '@testing-library/react';
import { LanguageModelIcon } from '../../browser/components/languageModelButton.js';

const LOGO_URL = 'https://example.com/logo.svg';

describe('LanguageModelIcon', () => {
	describe('URL logo', () => {
		it('renders a plain <img> with the logo src and no monochrome class when not monochrome', () => {
			render(<LanguageModelIcon logoUrl={LOGO_URL} provider='custom' />);

			const img = screen.getByRole('img');
			expect(img).toHaveAttribute('src', LOGO_URL);
			expect(img).toHaveClass('language-model', 'icon');
			expect(img).not.toHaveClass('monochrome');
		});

		it('renders a masked element (not an <img>) with the monochrome class when monochrome', () => {
			render(<LanguageModelIcon monochrome logoUrl={LOGO_URL} provider='custom' />);

			// The theme-recolored logo is painted via a CSS mask on a div, so there
			// must be no raw <img> (which would show the un-recolored logo -- the bug).
			expect(screen.queryByRole('img')).not.toBeInTheDocument();
			expect(screen.getByTestId('language-model-icon')).toHaveClass('monochrome');
		});
	});

	describe('built-in provider icon', () => {
		it('adds the monochrome class to a built-in provider icon when monochrome', () => {
			render(<LanguageModelIcon monochrome provider='anthropic-api' />);

			expect(screen.getByTestId('language-model-icon')).toHaveClass('monochrome');
		});

		it('omits the monochrome class from a built-in provider icon by default', () => {
			render(<LanguageModelIcon provider='anthropic-api' />);

			expect(screen.getByTestId('language-model-icon')).not.toHaveClass('monochrome');
		});

		it('leaves a codicon fallback icon un-monochromed even when monochrome', () => {
			// Codicon fallbacks (e.g. the custom-provider wrench) are font glyphs
			// colored by `currentColor`, so they are already theme-legible and are
			// deliberately not recolored -- the monochrome class would be a no-op.
			render(<LanguageModelIcon monochrome provider='openai-compatible' />);

			expect(screen.getByTestId('language-model-icon')).not.toHaveClass('monochrome');
		});
	});
});
