/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { render } from '@testing-library/react';
import { ShadowDomContent } from '../ShadowDomContent.js';

describe('ShadowDomContent', () => {
	// happy-dom does not enforce Trusted Types, so an undefined policy exercises
	// the component's fallback of assigning the string to innerHTML directly.
	it('renders the content inside a shadow root', () => {
		const { container } = render(
			<ShadowDomContent content='<div class="gt">cell</div>' trustedTypesPolicy={undefined} />
		);
		const host = container.firstElementChild as HTMLElement;

		expect(host.shadowRoot).not.toBeNull();
		// eslint-disable-next-line no-restricted-syntax -- shadow DOM content is not reachable via Testing Library queries
		expect(host.shadowRoot!.querySelector('.gt')?.textContent).toBe('cell');
	});

	it('empties the shadow root on unmount', () => {
		const { container, unmount } = render(
			<ShadowDomContent content='<div>hi</div>' trustedTypesPolicy={undefined} />
		);
		const host = container.firstElementChild as HTMLElement;
		expect(host.shadowRoot!.childNodes.length).toBeGreaterThan(0);

		unmount();

		expect(host.shadowRoot!.childNodes.length).toBe(0);
	});
});
