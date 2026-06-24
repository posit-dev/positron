/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// React.
import React from 'react';

// Testing libraries.
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Other dependencies.
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ListPackages } from '../../browser/components/listPackages.js';
import { PositronPackagesContextProvider } from '../../browser/positronPackagesContext.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { IPositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

// A viewport large enough that both package rows paint at once.
const VIEWPORT_WIDTH = 300;
const VIEWPORT_HEIGHT = 400;

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

describe('ListPackages highlight', () => {
	// Emitters live at describe scope so the .stub() below captures their .event during build();
	// tests fire them to drive the view (see the "Common mistakes" note in vitest-tests.md).
	const onDidRefreshPackagesInstance = new Emitter<ILanguageRuntimePackage[]>();
	const onDidChangePackages = new Emitter<string[]>();
	const installed = [pkg('numpy', '1.26.0'), pkg('pandas', '2.0.0')];

	const fakeInstance = stubInterface<IPositronPackagesInstance>({
		packages: installed,
		attachRuntime: () => { },
		detachRuntime: () => { },
		onDidRefreshPackagesInstance: onDidRefreshPackagesInstance.event,
		onDidChangePackages: onDidChangePackages.event,
	});

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPackagesService, {
			activePackagesInstance: fakeInstance,
			onDidChangeActivePackagesInstance: Event.None,
			itemSize: 'row',
			onDidChangeItemSize: Event.None,
			setSelectedPackage: vi.fn(),
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// ListPackages reads activeInstance through the packages context provider, which the env's
	// reactComponentContainer feeds; the container itself is never touched in these tests.
	const reactComponentContainer = stubInterface<IReactComponentContainer>({});

	let restoreLayout: () => void;
	beforeEach(() => { restoreLayout = stubGridLayoutWithSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT); });
	afterEach(() => {
		vi.unstubAllGlobals();
		restoreLayout();
	});

	function renderList() {
		rtl.render(
			<PositronPackagesContextProvider reactComponentContainer={reactComponentContainer}>
				<ListPackages height={VIEWPORT_HEIGHT} reactComponentContainer={reactComponentContainer} width={VIEWPORT_WIDTH} />
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
});
