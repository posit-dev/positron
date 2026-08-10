/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// React.
import React from 'react';

// Testing libraries.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Other dependencies.
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IAction } from '../../../../../base/common/actions.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ListPackages } from '../../browser/components/listPackages.js';
import { PackagesItemSize } from '../../browser/positronPackagesContextKeys.js';
import { PositronPackagesContextProvider } from '../../browser/positronPackagesContext.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { IPositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

// A viewport large enough that both package rows paint at once.
const VIEWPORT_WIDTH = 300;
const VIEWPORT_HEIGHT = 400;

// Below NARROW_WIDTH_THRESHOLD, so the row actions and the Update button drop out.
const NARROW_VIEWPORT_WIDTH = 180;

const pkg = (name: string, version: string): ILanguageRuntimePackage => ({
	id: name,
	name,
	displayName: name,
	version,
});

/**
 * The data grid sizes itself from the DOM via requestAnimationFrame + ResizeObserver, neither of
 * which produces a real layout in happy-dom. Give elements a concrete offset size and hand that
 * size to the grid synchronously through a ResizeObserver that fires on observe(), so the rows
 * paint during render. Mirrors the helper in positronList.vitest.tsx. Returns a restore function
 * for the offset overrides; callers must also call vi.unstubAllGlobals().
 */
function stubGridLayoutWithSize(width: number, height: number): () => void {
	const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
	const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
	Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width });
	Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });

	vi.stubGlobal('requestAnimationFrame', () => 0);
	vi.stubGlobal('ResizeObserver', class {
		private readonly _callback: ResizeObserverCallback;
		constructor(callback: ResizeObserverCallback) { this._callback = callback; }
		observe() {
			const entry = { contentRect: { width, height } };
			this._callback([entry] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
		}
		unobserve() { }
		disconnect() { }
	});

	return () => {
		Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor!);
		Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDescriptor!);
	};
}

describe('ListPackages', () => {
	// Emitters live at describe scope so the .stub() below captures their .event during build();
	// tests fire them to drive the view (see the "Common mistakes" note in vitest-tests.md).
	const onDidRefreshPackagesInstance = new Emitter<ILanguageRuntimePackage[]>();
	const onDidChangePackages = new Emitter<string[]>();
	const onDidChangeItemSize = new Emitter<PackagesItemSize>();
	// numpy carries a url so it renders both action buttons; pandas has none. polars is the
	// outdated one, so it renders whichever update affordance the current width calls for.
	const installed = [
		{ ...pkg('numpy', '1.26.0'), url: 'https://numpy.org' },
		pkg('pandas', '2.0.0'),
		{ ...pkg('polars', '0.20.0'), outdated: true, latestVersion: '0.21.0' },
	];

	const fakeInstance = stubInterface<IPositronPackagesInstance>({
		packages: installed,
		attachRuntime: () => { },
		detachRuntime: () => { },
		onDidRefreshPackagesInstance: onDidRefreshPackagesInstance.event,
		onDidChangePackages: onDidChangePackages.event,
	});

	const showContextMenu = vi.fn();

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPackagesService, {
			activePackagesInstance: fakeInstance,
			onDidChangeActivePackagesInstance: Event.None,
			itemSize: 'row',
			onDidChangeItemSize: onDidChangeItemSize.event,
			setSelectedPackage: vi.fn(),
		})
		// Selecting a package fires the (fire-and-forget) 'positronPackages.openPackage'
		// command; stub it so these flash/select tests don't emit unhandled rejections.
		.stub(ICommandService, { executeCommand: vi.fn() })
		.stub(IContextMenuService, { showContextMenu })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// ListPackages reads activeInstance through the packages context provider, which the env's
	// reactComponentContainer feeds; the container itself is never touched in these tests.
	const reactComponentContainer = stubInterface<IReactComponentContainer>({});

	// Stubbed per render rather than in beforeEach so a test can render at a narrow width and have
	// the grid's own measurements agree with the width prop it passes the component.
	let restoreLayout: (() => void) | undefined;
	afterEach(() => {
		vi.unstubAllGlobals();
		restoreLayout?.();
		restoreLayout = undefined;
	});

	function renderList(width = VIEWPORT_WIDTH) {
		restoreLayout = stubGridLayoutWithSize(width, VIEWPORT_HEIGHT);
		rtl.render(
			<PositronPackagesContextProvider reactComponentContainer={reactComponentContainer}>
				<ListPackages height={VIEWPORT_HEIGHT} reactComponentContainer={reactComponentContainer} width={width} />
			</PositronPackagesContextProvider>
		);
	}

	// .closest() walks up to the framework wrappers: .packages-list-item carries the flash class,
	// the outer .positron-list-row carries the selection class.
	const itemRow = (name: string) => screen.getByText(name).closest('.packages-list-item');
	const listRow = (name: string) => screen.getByText(name).closest('.positron-list-row');

	it('flashes and selects a single installed or updated package', async () => {
		renderList();
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		act(() => onDidChangePackages.fire(['numpy']));

		await waitFor(() => expect(itemRow('numpy')).toHaveClass('recently-changed'));
		expect(listRow('numpy')).toHaveClass('selected');
		// Selecting the row also drives the service-level selection (what the detail pane reads).
		await waitFor(() => expect(ctx.get(IPositronPackagesService).setSelectedPackage).toHaveBeenCalledWith('numpy'));
		// The untouched package is neither flashed nor selected.
		expect(itemRow('pandas')).not.toHaveClass('recently-changed');
		expect(listRow('pandas')).not.toHaveClass('selected');
	});

	it('flashes every updated package but selects none on a bulk update', async () => {
		renderList();
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		act(() => onDidChangePackages.fire(['numpy', 'pandas']));

		await waitFor(() => expect(itemRow('numpy')).toHaveClass('recently-changed'));
		expect(itemRow('pandas')).toHaveClass('recently-changed');
		// A bulk update has no single row to select: neither the CSS selection nor the
		// service-level selection is set for any affected package.
		expect(listRow('numpy')).not.toHaveClass('selected');
		expect(listRow('pandas')).not.toHaveClass('selected');
		const setSelectedPackage = ctx.get(IPositronPackagesService).setSelectedPackage;
		expect(setSelectedPackage).not.toHaveBeenCalledWith('numpy');
		expect(setSelectedPackage).not.toHaveBeenCalledWith('pandas');
	});

	it('does not flash or reveal a package hidden by the active filter', async () => {
		const user = userEvent.setup();
		renderList();
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		// Filter to "pandas" so numpy drops out of view (300ms debounce).
		await user.type(screen.getByPlaceholderText('Filter packages'), 'pandas');
		await waitFor(() => expect(screen.queryByText('numpy')).not.toBeInTheDocument());

		// An update for the now-hidden numpy must not reveal it or flash anything.
		act(() => onDidChangePackages.fire(['numpy']));

		await waitFor(() => expect(screen.getByText('pandas')).toBeInTheDocument());
		expect(screen.queryByText('numpy')).not.toBeInTheDocument();
		expect(itemRow('pandas')).not.toHaveClass('recently-changed');
	});

	it('keeps the flash through a Stage 2 refresh and clears it on schedule', async () => {
		renderList();
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		act(() => onDidChangePackages.fire(['numpy']));
		await waitFor(() => expect(itemRow('numpy')).toHaveClass('recently-changed'));

		// The async Stage 2 metadata refresh re-pushes the list; the flash must survive it
		// (the clear timer lives in its own effect so this re-render can't cancel it).
		act(() => onDidRefreshPackagesInstance.fire([pkg('numpy', '1.26.0'), pkg('pandas', '2.0.0')]));
		expect(itemRow('numpy')).toHaveClass('recently-changed');

		// Once the flash window elapses, the class is removed.
		await waitFor(() => expect(itemRow('numpy')).not.toHaveClass('recently-changed'), { timeout: 3000 });
	});

	it('does not re-flash on a later refresh once the flash has cleared', async () => {
		renderList();
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		act(() => onDidChangePackages.fire(['numpy']));
		await waitFor(() => expect(itemRow('numpy')).toHaveClass('recently-changed'));

		// Let the flash clear on its own.
		await waitFor(() => expect(itemRow('numpy')).not.toHaveClass('recently-changed'), { timeout: 3000 });

		// A later Stage 2 refresh (no new change event) must not revive the cleared flash:
		// the nonce is already consumed.
		act(() => onDidRefreshPackagesInstance.fire([pkg('numpy', '1.26.0'), pkg('pandas', '2.0.0')]));
		expect(itemRow('numpy')).not.toHaveClass('recently-changed');
	});

	// The icon group is right-aligned, so help has to come last: it is the only button every
	// package renders, and keeping it last pins it to the row's right edge whether or not the
	// package has a website. The detail page follows this same order (see packageViewState).
	it('renders the website action before the help action, keeping help on the right edge', async () => {
		renderList();
		expect(await screen.findByText('numpy')).toBeInTheDocument();
		const item = itemRow('numpy') as HTMLElement;

		const labels = within(item).getAllByRole('button').map(button => button.getAttribute('aria-label'));

		expect(labels).toEqual(['Open website for numpy', 'Show help for numpy']);
	});

	// The action buttons are a fixed 58px, which at the pane's minimum width squeezes the name down
	// to an unreadable "nu..." (issue #15122). Below the threshold they drop out entirely and the
	// context menu carries them instead.
	it('drops the row actions below the narrow-width threshold', async () => {
		renderList(NARROW_VIEWPORT_WIDTH);
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		expect(screen.queryByRole('button', { name: 'Open website for numpy' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Show help for numpy' })).not.toBeInTheDocument();
		// The width the buttons vacate goes to the name and version, which stay whole.
		expect(screen.getByText('1.26.0')).toBeInTheDocument();
	});

	it('keeps the row actions at normal widths', async () => {
		renderList();
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		expect(screen.getByRole('button', { name: 'Open website for numpy' })).toBeInTheDocument();
	});

	// Card mode's Update button is a ~60px text button on the description row. Narrow, it is
	// replaced by the compact arrow indicator that row mode already uses, so the update stays
	// visible without costing the description its width.
	it('replaces the card Update button with the compact indicator below the threshold', async () => {
		renderList(NARROW_VIEWPORT_WIDTH);
		act(() => onDidChangeItemSize.fire('card'));
		expect(await screen.findByText('polars')).toBeInTheDocument();

		expect(screen.queryByRole('button', { name: 'Update polars to 0.21.0' })).not.toBeInTheDocument();
		expect(screen.getByTitle('Update available: 0.21.0')).toBeInTheDocument();
	});

	it('keeps the card Update button at normal widths', async () => {
		renderList();
		act(() => onDidChangeItemSize.fire('card'));
		expect(await screen.findByText('polars')).toBeInTheDocument();

		expect(screen.getByRole('button', { name: 'Update polars to 0.21.0' })).toBeInTheDocument();
		expect(screen.queryByTitle('Update available: 0.21.0')).not.toBeInTheDocument();
	});

	// Show Help has always been in the context menu; the website action joins it so the narrow
	// layout hides nothing that right-click cannot reach.
	it('offers the website action in the context menu', async () => {
		const user = userEvent.setup();
		renderList();
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		await user.pointer({ keys: '[MouseRight]', target: itemRow('numpy') as HTMLElement });

		const delegate = showContextMenu.mock.calls[0][0] as { getActions: () => IAction[] };
		expect(delegate.getActions().map(action => action.label)).toContain('Open Website');
	});

	// At narrow widths the context menu is the only route to Show Help, Open Website and Update, so
	// it has to open without a mouse. The grid puts DOM focus on its own container rather than on a
	// row, so a keyboard-fired contextmenu event never reaches the row's own onContextMenu handler:
	// the list has to handle these keys itself. Both keys are fired on a descendant of the list
	// because the grid owns focus, which is exactly how the real keydown arrives (it bubbles).
	const menuLabels = () => {
		const delegate = showContextMenu.mock.calls[0][0] as { getActions: () => IAction[] };
		// Separators report an empty label; drop them so the assertion reads as the visible menu.
		return delegate.getActions().map(action => action.label).filter(Boolean);
	};

	it('opens the context menu for the selected package on Shift+F10', async () => {
		renderList(NARROW_VIEWPORT_WIDTH);
		expect(await screen.findByText('numpy')).toBeInTheDocument();
		act(() => onDidChangePackages.fire(['numpy']));
		await waitFor(() => expect(listRow('numpy')).toHaveClass('selected'));

		// eslint-disable-next-line testing-library/prefer-user-event -- user.keyboard targets document.activeElement, and the virtualized grid takes no real DOM focus in happy-dom.
		fireEvent.keyDown(screen.getByText('numpy'), { key: 'F10', code: 'F10', shiftKey: true });

		expect(menuLabels()).toEqual([
			'Show Help',
			'Open Website',
			`Copy 'numpy (1.26.0)'`,
			'Copy All',
			'Update Package',
			'Uninstall Package',
		]);
	});

	it('opens the context menu for the selected package on the ContextMenu key', async () => {
		renderList(NARROW_VIEWPORT_WIDTH);
		expect(await screen.findByText('numpy')).toBeInTheDocument();
		act(() => onDidChangePackages.fire(['numpy']));
		await waitFor(() => expect(listRow('numpy')).toHaveClass('selected'));

		// eslint-disable-next-line testing-library/prefer-user-event -- see the note on the Shift+F10 test above.
		fireEvent.keyDown(screen.getByText('numpy'), { key: 'ContextMenu', code: 'ContextMenu' });

		expect(menuLabels()).toContain('Show Help');
	});

	// Arrow keys move the cursor but leave the selection behind, so the two disagree as soon as the
	// user navigates. The menu has to act on the row the cursor is on, which is the one the user
	// sees as current; acting on the selection would open the menu for a different package.
	it('targets the row the cursor is on rather than a stale selection', async () => {
		renderList(NARROW_VIEWPORT_WIDTH);
		expect(await screen.findByText('numpy')).toBeInTheDocument();
		act(() => onDidChangePackages.fire(['numpy']));
		await waitFor(() => expect(listRow('numpy')).toHaveClass('selected'));

		// eslint-disable-next-line testing-library/prefer-user-event -- see the note on the Shift+F10 test above.
		fireEvent.keyDown(screen.getByText('numpy'), { key: 'ArrowDown', code: 'ArrowDown' });
		// eslint-disable-next-line testing-library/prefer-user-event -- see the note on the Shift+F10 test above.
		fireEvent.keyDown(screen.getByText('numpy'), { key: 'ContextMenu', code: 'ContextMenu' });

		// numpy is still the selection, so a menu naming numpy means we targeted the wrong row.
		expect(menuLabels()).toContain(`Copy 'pandas (2.0.0)'`);
	});

	// Without a selected package there is no row for the menu to act on.
	it('opens the menu for the first row before anything is selected', async () => {
		renderList(NARROW_VIEWPORT_WIDTH);
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		// eslint-disable-next-line testing-library/prefer-user-event -- see the note on the Shift+F10 test above.
		fireEvent.keyDown(screen.getByText('numpy'), { key: 'ContextMenu', code: 'ContextMenu' });

		expect(menuLabels()).toContain(`Copy 'numpy (1.26.0)'`);
	});

	// An empty list has no row under the cursor, so the key has nothing to act on.
	it('ignores the context menu key when the filter matches no packages', async () => {
		const user = userEvent.setup();
		renderList(NARROW_VIEWPORT_WIDTH);
		expect(await screen.findByText('numpy')).toBeInTheDocument();

		await user.type(screen.getByPlaceholderText('Filter packages'), 'nosuchpackage');
		expect(await screen.findByText('No packages found.')).toBeInTheDocument();

		// eslint-disable-next-line testing-library/prefer-user-event -- see the note on the Shift+F10 test above.
		fireEvent.keyDown(screen.getByText('No packages found.'), { key: 'ContextMenu', code: 'ContextMenu' });

		expect(showContextMenu).not.toHaveBeenCalled();
	});

	// pandas has no url, so there is nothing for the entry to open.
	it('omits the website action for a package with no url', async () => {
		const user = userEvent.setup();
		renderList();
		expect(await screen.findByText('pandas')).toBeInTheDocument();

		await user.pointer({ keys: '[MouseRight]', target: itemRow('pandas') as HTMLElement });

		const delegate = showContextMenu.mock.calls[0][0] as { getActions: () => IAction[] };
		expect(delegate.getActions().map(action => action.label)).not.toContain('Open Website');
	});
});
