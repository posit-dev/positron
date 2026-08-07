/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createPositronWelcomePage, PositronWelcomePage } from '../../browser/positronWelcomePage/positronWelcomePage.js';

describe('PositronWelcomePage', () => {
	const rtl = setupRTLRenderer();

	/**
	 * Builds the DOM the editor pane hands to the page. These are real widgets
	 * on the welcome page, so the test only needs something findable in their
	 * place.
	 */
	const slottedDom = () => {
		const recentList = document.createElement('div');
		recentList.textContent = 'Recent';

		const connectAction = document.createElement('div');
		connectAction.textContent = 'Connect to...';

		const footer = document.createElement('div');
		footer.textContent = 'Show welcome page on startup';

		return { recentList, connectAction, footer };
	};

	it('renders the recent list, then the connect action, then the footer', () => {
		const { recentList, connectAction, footer } = slottedDom();
		const { container } = rtl.render(
			<PositronWelcomePage
				connectAction={connectAction}
				footer={footer}
				recentList={recentList}
				onDidMount={vi.fn()}
			/>
		);

		expect(container).toHaveTextContent(/Recent.*Connect to\.\.\..*Show welcome page on startup/);
	});

	it('omits the connect action when there is none, as on web', () => {
		const { recentList, footer } = slottedDom();
		rtl.render(
			<PositronWelcomePage footer={footer} recentList={recentList} onDidMount={vi.fn()} />
		);

		expect(screen.queryByText('Connect to...')).not.toBeInTheDocument();
	});

	it('calls onDidMount once every slotted element is in the document', () => {
		const { recentList, connectAction, footer } = slottedDom();
		const connectedAtCallTime: { recent: boolean; connect: boolean; footer: boolean }[] = [];
		const onDidMount = () => {
			connectedAtCallTime.push({
				recent: recentList.isConnected,
				connect: connectAction.isConnected,
				footer: footer.isConnected,
			});
		};

		rtl.render(
			<PositronWelcomePage
				connectAction={connectAction}
				footer={footer}
				recentList={recentList}
				onDidMount={onDidMount}
			/>
		);

		// The editor pane attaches click handlers from this callback, so it has
		// to run after the slotted elements land in the DOM, not before.
		expect(connectedAtCallTime).toEqual([{ recent: true, connect: true, footer: true }]);
	});
});

describe('createPositronWelcomePage', () => {
	const renderInto = (container: HTMLElement) => {
		const recentList = document.createElement('div');
		recentList.textContent = 'Recent';
		const footer = document.createElement('div');

		return createPositronWelcomePage(container, { recentList, footer, onDidMount: vi.fn() });
	};

	it('makes the container the page layout element', () => {
		const container = document.createElement('div');
		const renderer = renderInto(container);

		// The page renders a fragment, so this class is what the CSS hangs off.
		expect(container).toHaveClass('positron-welcome-page');

		renderer.dispose();
	});

	it('unmounts the page when the renderer is disposed', async () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const renderer = renderInto(container);

		expect(await screen.findByText('Recent')).toBeInTheDocument();

		renderer.dispose();

		// The editor pane disposes this on every rebuild of the categories slide,
		// so a stale page must not be left behind.
		expect(screen.queryByText('Recent')).not.toBeInTheDocument();
		container.remove();
	});
});
