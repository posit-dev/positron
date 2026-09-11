/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Testing libraries.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

// Other dependencies.
import { Event } from '../../../../../base/common/event.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubGridLayoutWithSize } from '../../../../../test/vitest/stubGridLayout.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ListPackages } from '../../browser/components/listPackages.js';
import { PositronPackagesContextProvider } from '../../browser/positronPackagesContext.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { IPositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

// A large library on the scale the packages pane has to stay usable at
// (posit-dev/positron#12994): a base R install plus Bioconductor, or a heavyweight
// Python environment, lands in the low thousands.
const PACKAGE_COUNT = 5000;

const VIEWPORT_WIDTH = 300;
const VIEWPORT_HEIGHT = 400;

// Matches ROW_ITEM_HEIGHT in listPackages.tsx: the harness renders in 'row' mode,
// so a correct virtualization mounts about VIEWPORT_HEIGHT / 26 rows plus overscan.
const ROW_ITEM_HEIGHT = 26;

// Generous ceiling for "the DOM stays bounded": several times the visible window,
// far below the full library. A virtualization regression mounts thousands.
const MOUNTED_ROW_CEILING = 100;

/**
 * `pkg-0000` ... `pkg-4999`. Zero-padded so a filter query can target exactly one
 * package, and so the name regex below can't match a version string.
 */
const largeLibrary: ILanguageRuntimePackage[] = Array.from({ length: PACKAGE_COUNT }, (_, i) => {
	const name = `pkg-${String(i).padStart(4, '0')}`;
	return { id: name, name, displayName: name, version: '1.0.0' };
});

const FIRST_PACKAGE = 'pkg-0000';
const LAST_PACKAGE = `pkg-${String(PACKAGE_COUNT - 1).padStart(4, '0')}`;

/** Every mounted package row, identified by its unique name text. */
const mountedNames = () => screen.getAllByText(/^pkg-\d{4}$/).map(el => el.textContent);

describe('ListPackages with a large library', () => {
	// These tests never push a refresh or change event; the static 5,000-package
	// list is the whole scenario.
	const fakeInstance = stubInterface<IPositronPackagesInstance>({
		packages: largeLibrary,
		attachRuntime: () => { },
		detachRuntime: () => { },
		onDidRefreshPackagesInstance: Event.None,
		onDidChangePackages: Event.None,
	});

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IPositronPackagesService, {
			activePackagesInstance: fakeInstance,
			onDidChangeActivePackagesInstance: Event.None,
			// Row mode: the densest layout, so the viewport shows the most rows a
			// virtualization bound has to allow for.
			itemSize: 'row',
			onDidChangeItemSize: Event.None,
			setSelectedPackage: vi.fn(),
		})
		// Selecting a package fires the (fire-and-forget) 'positronPackages.openPackage'
		// command; stub it so row selection doesn't emit unhandled rejections.
		.stub(ICommandService, { executeCommand: vi.fn() })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const reactComponentContainer = stubInterface<IReactComponentContainer>({});

	let restoreLayout: (() => void) | undefined;
	afterEach(() => {
		vi.unstubAllGlobals();
		restoreLayout?.();
		restoreLayout = undefined;
	});

	async function renderList() {
		restoreLayout = stubGridLayoutWithSize(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		rtl.render(
			<PositronPackagesContextProvider reactComponentContainer={reactComponentContainer}>
				<ListPackages height={VIEWPORT_HEIGHT} reactComponentContainer={reactComponentContainer} width={VIEWPORT_WIDTH} />
			</PositronPackagesContextProvider>
		);
		expect(await screen.findByText(FIRST_PACKAGE)).toBeInTheDocument();
	}

	it('mounts only the visible window of rows, not the whole library', async () => {
		await renderList();

		const names = mountedNames();
		// The window is filled: at 26px rows a 400px viewport shows ~15 packages.
		expect(names.length).toBeGreaterThanOrEqual(Math.floor(VIEWPORT_HEIGHT / ROW_ITEM_HEIGHT));
		// ...and bounded: mounting anywhere near PACKAGE_COUNT rows is the
		// regression this file exists to catch.
		expect(names.length).toBeLessThan(MOUNTED_ROW_CEILING);
		expect(screen.queryByText(LAST_PACKAGE)).not.toBeInTheDocument();
	});

	it('Cmd/Ctrl+End reaches and renders the last package', async () => {
		await renderList();

		// The jump chord is Cmd on macOS and Ctrl elsewhere (see dataGridWaffle.tsx).
		// eslint-disable-next-line testing-library/prefer-user-event -- user.keyboard targets document.activeElement, and the virtualized grid takes no real DOM focus in happy-dom; the keydown bubbles from the row to the grid's handler, as it does in listPackages.vitest.tsx.
		fireEvent.keyDown(screen.getByText(FIRST_PACKAGE), {
			key: 'End',
			code: 'End',
			metaKey: isMacintosh,
			ctrlKey: !isMacintosh,
		});

		// The window slid to the end of the library: the last package is mounted,
		// the first is not, and the DOM stayed bounded through the jump.
		await waitFor(() => expect(screen.getByText(LAST_PACKAGE)).toBeInTheDocument());
		expect(screen.queryByText(FIRST_PACKAGE)).not.toBeInTheDocument();
		expect(mountedNames().length).toBeLessThan(MOUNTED_ROW_CEILING);
	});

	it('filters the library down to the matching row', async () => {
		const user = userEvent.setup();
		await renderList();

		// Targets exactly one of the 5,000 names (300ms debounce before it applies).
		await user.type(screen.getByPlaceholderText('Filter packages'), LAST_PACKAGE);

		await waitFor(() => expect(screen.getByText(LAST_PACKAGE)).toBeInTheDocument());
		expect(mountedNames()).toEqual([LAST_PACKAGE]);
	});
});
