/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IResolvedWalkthrough, IWalkthroughsService } from '../../browser/gettingStartedService.js';
import { IEnvironmentHealthService } from '../../browser/positronWelcomePage/environmentHealthService.js';
import { createPositronWelcomePage, PositronWelcomePage } from '../../browser/positronWelcomePage/positronWelcomePage.js';

class FakeResizeObserver implements ResizeObserver {
	public static instances: FakeResizeObserver[] = [];

	private readonly callback: ResizeObserverCallback;
	public readonly disconnect = vi.fn();
	public readonly observe = vi.fn();
	public readonly unobserve = vi.fn();

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback;
		FakeResizeObserver.instances.push(this);
	}

	public resize(): void {
		this.callback([], this);
	}
}

/**
 * The page renders the walkthrough banner, which reads this service. One
 * walkthrough with no `when` clause is what the real window always has, so the
 * banner shows and its place in the page order can be asserted.
 */
const oneWalkthrough = {
	getWalkthroughs: () => [stubInterface<IResolvedWalkthrough>({ when: ContextKeyExpr.true() })],
	onDidAddWalkthrough: Event.None,
	onDidRemoveWalkthrough: Event.None,
	onDidChangeWalkthrough: Event.None,
};

/**
 * A stub service for tests that only care about the rest of the page. The
 * card itself has its own tests, so this stands in wherever the page just
 * needs something to pass through.
 */
const environmentHealthService: IEnvironmentHealthService = {
	_serviceBrand: undefined,
	onDidChange: Event.None,
	// One language, so the card renders as it does in use. An empty snapshot puts
	// it in its "every language is turned off" state, which is the one state that
	// says nothing about where the card sits.
	state: [{ language: 'python', label: 'Python', state: { kind: 'loading' } }],
	isBusy: () => false,
	rerunCheckForLanguage: vi.fn(),
	rerunChecksForPage: vi.fn(),
	runFix: vi.fn(),
};

/**
 * Builds the DOM the editor pane hands to the page. These are real widgets
 * on the welcome page, so the test only needs something findable in their
 * place.
 */
const slottedDom = () => {
	const recentList = document.createElement('div');
	recentList.textContent = 'Recent';

	const footer = document.createElement('div');
	footer.textContent = 'Show welcome page on startup';

	return { recentList, footer };
};

describe('PositronWelcomePage', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IWalkthroughsService, oneWalkthrough)
		.stub(IContextKeyService, stubInterface<IContextKeyService>({ contextMatchesRules: () => true }))
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('renders the header, the card, then the recent list, Learn and the footer', () => {
		const { recentList, footer } = slottedDom();
		const { container } = rtl.render(
			<PositronWelcomePage
				environmentHealthService={environmentHealthService} expandedByLanguage={new Map()}
				footer={footer}
				recentList={recentList}
				onDidChangeContentSize={vi.fn()}
				onDidMount={vi.fn()}
			/>
		);

		// Recent leads: it is the primary reason to open this page, and on a wide
		// pane it takes the left column. DOM order matches that rather than being
		// reordered in CSS, so the tab order agrees with what is on screen.
		expect(container).toHaveTextContent(/Welcome to .*Help.*Environment setup.*Recent.*Learn.*Show welcome page on startup/);
	});

	it('calls onDidMount once every slotted element is in the document', () => {
		const { recentList, footer } = slottedDom();
		const connectedAtCallTime: { recent: boolean; footer: boolean }[] = [];
		const onDidMount = () => {
			connectedAtCallTime.push({
				recent: recentList.isConnected,
				footer: footer.isConnected,
			});
		};

		rtl.render(
			<PositronWelcomePage
				environmentHealthService={environmentHealthService} expandedByLanguage={new Map()}
				footer={footer}
				recentList={recentList}
				onDidChangeContentSize={vi.fn()}
				onDidMount={onDidMount}
			/>
		);

		// The editor pane attaches click handlers from this callback, so it has
		// to run after the slotted elements land in the DOM, not before.
		expect(connectedAtCallTime).toEqual([{ recent: true, footer: true }]);
	});
});

describe('createPositronWelcomePage', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IWalkthroughsService, oneWalkthrough)
		.stub(IContextKeyService, stubInterface<IContextKeyService>({ contextMatchesRules: () => true }))
		.build();

	beforeEach(() => {
		FakeResizeObserver.instances = [];
		// createPositronWelcomePage builds its own PositronReactRenderer, whose
		// provider reads this singleton rather than taking services as an
		// argument. Nothing else can reach into that renderer to supply them.
		PositronReactServices.services = ctx.reactServices;
	});

	afterEach(() => {
		PositronReactServices.services = undefined!;
	});

	const renderInto = (container: HTMLElement, onDidChangeContentSize = vi.fn()) => {
		const recentList = document.createElement('div');
		recentList.textContent = 'Recent';
		const footer = document.createElement('div');

		return createPositronWelcomePage(
			container,
			{ environmentHealthService, expandedByLanguage: new Map(), recentList, footer, onDidMount: vi.fn(), onDidChangeContentSize },
			FakeResizeObserver
		);
	};

	it('makes the container the page layout element', () => {
		const container = document.createElement('div');
		const renderer = renderInto(container);

		// The page renders a fragment, so this class is what the CSS hangs off.
		expect(container).toHaveClass('positron-welcome-page');

		renderer.dispose();
	});

	it('reports page size changes and disconnects the observer when disposed', () => {
		const container = document.createElement('div');
		const onDidChangeContentSize = vi.fn();
		const renderer = renderInto(container, onDidChangeContentSize);
		const observer = FakeResizeObserver.instances[0];

		observer.resize();
		expect({
			callbackCount: onDidChangeContentSize.mock.calls.length,
			observedElements: observer.observe.mock.calls.map(call => call[0]),
			disconnected: observer.disconnect.mock.calls.length,
		}).toEqual({
			callbackCount: 1,
			observedElements: [container],
			disconnected: 0,
		});

		renderer.dispose();
		expect(observer.disconnect).toHaveBeenCalledOnce();
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
