/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../base/common/uri.js';
import { Emitter } from '../../../../../base/common/event.js';
import { isLinux } from '../../../../../base/common/platform.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { POSITRON_DATA_CONNECTIONS_VIEW_ID } from '../../browser/positronDataConnectionsConfiguration.js';
import { DatabaseFileEditorPage } from '../../browser/editor/databaseFileEditorPage.js';
import { IDataConnectionDriver, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionsDriverManager } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionsDriverManager.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

// The configuration dialog is opened through a modal renderer, and the dialog itself isn't what
// these tests are about. Mocking the renderer lets us read the profile the page seeded it with
// straight off the render call, and drive its onSave without standing up a modal.
const { modalRender } = vi.hoisted(() => ({ modalRender: vi.fn() }));
vi.mock('../../../../../base/browser/positronModalReactRenderer.js', () => ({
	PositronModalReactRenderer: class {
		render = modalRender;
		dispose = vi.fn();
	},
}));

// The database file the page is opened for, and the driver the editor says reads it. The driver
// here is the one the editor resolves from the file's extension, which the page can name before
// any driver extension has loaded -- distinct from the registered driver below.
const RESOURCE = URI.file('/home/user/bikeshare.sqlite');
const FILE_DRIVER = { id: 'positron-data-driver-sqlite', name: 'SQLite' };

// How the label service spells this file, which is what the configuration dialog's own "Browse..."
// picker writes into a file parameter -- deliberately not the platform path, so the two spellings
// a saved connection can be stored in stay distinguishable in these tests.
const RESOURCE_LABEL = '~/bikeshare.sqlite';

// The registered driver, once its extension has activated. It connects by database file, which is
// what makes the page's button live.
const REGISTERED_DRIVER = stubInterface<IDataConnectionDriver>({
	id: FILE_DRIVER.id,
	metadata: {
		id: FILE_DRIVER.id,
		name: FILE_DRIVER.name,
		description: '',
		iconSvg: '',
		supportedLanguageIds: ['python', 'r'],
		mechanisms: [{
			id: 'file',
			label: 'Database File',
			description: '',
			parameters: [{ id: 'databasePath', label: 'Database File', type: 'file', required: true }],
		}],
	},
});

/**
 * A saved connection profile, pointing at the page's own file unless told otherwise.
 * @param overrides Fields to override.
 */
function savedProfile(overrides: Partial<IDataConnectionProfile> = {}): IDataConnectionProfile {
	return {
		id: 'conn-1',
		connectionName: 'bikeshare',
		driverMetadata: {
			id: FILE_DRIVER.id,
			name: FILE_DRIVER.name,
			iconSvg: '',
			supportedLanguageIds: [],
		},
		mechanismId: 'file',
		parameterValues: { databasePath: RESOURCE.fsPath },
		...overrides,
	};
}

describe('DatabaseFileEditorPage', () => {
	// What the service reports, set per test before rendering. The stubs below read these on every
	// call rather than closing over a value captured at build time.
	let registeredDriver: IDataConnectionDriver | undefined;
	let profiles: IDataConnectionProfile[];

	// The driver activation the page starts when no driver is registered yet. Held open so a test
	// can look at the page mid-activation, then let it either finish or fail.
	let activation: Promise<void>;
	let finishActivation: () => void;
	let failActivation: () => void;

	const onDidChangeDrivers = new Emitter<IDataConnectionDriver[]>();
	const onDidChangeProfiles = new Emitter<IDataConnectionProfile[]>();
	const addUpdateProfile = vi.fn();
	const revealConnection = vi.fn();
	const openView = vi.fn(async (_id: string, _focus?: boolean) => null);

	const ctx = createTestContainer()
		.withReactServices()
		// The page spells the file the way the dialog's own file picker spells it, and matches
		// saved connections against that spelling as well as the platform path.
		.stub(ILabelService, { getUriLabel: () => RESOURCE_LABEL })
		.stub(IViewsService, { openView })
		.stub(IPositronDataConnectionsService, {
			driverManager: stubInterface<IDataConnectionsDriverManager>({
				getDriver: () => registeredDriver,
				activateDrivers: () => activation,
				onDidChangeDrivers: onDidChangeDrivers.event,
			}),
			getProfiles: () => profiles,
			onDidChangeProfiles: onDidChangeProfiles.event,
			addUpdateProfile,
			revealConnection,
		})
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	beforeEach(() => {
		registeredDriver = undefined;
		profiles = [];
		activation = new Promise<void>((resolve, reject) => {
			finishActivation = resolve;
			failActivation = () => reject(new Error('the extension host did not come up'));
		});
	});

	const renderPage = () =>
		rtl.render(<DatabaseFileEditorPage driver={FILE_DRIVER} resource={RESOURCE} />);

	it('offers to create a connection once the driver is registered', () => {
		registeredDriver = REGISTERED_DRIVER;

		renderPage();

		expect(screen.getByText('This is a SQLite database file.')).toBeInTheDocument();
		expect(screen.getByText('Create a data connection to browse and query it.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Create Data Connection' })).not.toHaveAttribute('aria-disabled');
	});

	it('withholds the button until the driver activation registers one', async () => {
		renderPage();

		expect(screen.getByText('Loading the data connection driver...')).toBeInTheDocument();

		// Hidden, but still laid out, so the page doesn't reflow when the button appears. jsdom
		// loads no stylesheet, so the class that hides it is what says so here.
		const loadingButton = screen.getByRole('button', { name: 'Create Data Connection' });
		expect(loadingButton).toHaveClass('awaiting-driver');
		expect(loadingButton).toHaveAttribute('aria-disabled', 'true');

		registeredDriver = REGISTERED_DRIVER;
		await act(async () => {
			finishActivation();
			await activation;
		});

		expect(screen.getByText('Create a data connection to browse and query it.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Create Data Connection' })).not.toHaveClass('awaiting-driver');
	});

	it('reports an unavailable driver when activation finishes without one', async () => {
		renderPage();

		await act(async () => {
			finishActivation();
			await activation;
		});

		expect(screen.getByText('The data connection driver is not available.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Create Data Connection' })).toHaveAttribute('aria-disabled', 'true');
	});

	it('names the connection the user already has and offers to open it', () => {
		registeredDriver = REGISTERED_DRIVER;
		profiles = [savedProfile()];

		renderPage();

		expect(screen.getByText('You already have a data connection to it, named "bikeshare".')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Open Data Connection' })).toBeInTheDocument();
	});

	it('opens the Data Connections pane on the connection the user already has', async () => {
		registeredDriver = REGISTERED_DRIVER;
		profiles = [savedProfile()];
		const user = userEvent.setup();

		renderPage();
		await user.click(screen.getByRole('button', { name: 'Open Data Connection' }));

		expect(openView).toHaveBeenCalledWith(POSITRON_DATA_CONNECTIONS_VIEW_ID, true);
		expect(revealConnection).toHaveBeenCalledWith('conn-1');
	});

	it('does not mistake a connection to a different file for this one', () => {
		registeredDriver = REGISTERED_DRIVER;
		profiles = [savedProfile({ parameterValues: { databasePath: '/home/user/other.sqlite' } })];

		renderPage();

		expect(screen.getByRole('button', { name: 'Create Data Connection' })).toBeInTheDocument();
	});

	it('recognizes a connection stored in the file picker\'s spelling of the path', () => {
		// The dialog's "Browse..." picker writes the label form, so a connection the user made by
		// browsing to this file is stored that way rather than as the platform path.
		registeredDriver = REGISTERED_DRIVER;
		profiles = [savedProfile({ parameterValues: { databasePath: `  ${RESOURCE_LABEL}  ` } })];

		renderPage();

		expect(screen.getByRole('button', { name: 'Open Data Connection' })).toBeInTheDocument();
	});

	it('compares stored paths the way the platform compares them', () => {
		registeredDriver = REGISTERED_DRIVER;
		profiles = [savedProfile({ parameterValues: { databasePath: RESOURCE.fsPath.toUpperCase() } })];

		renderPage();

		// A path differing only in case names the same file everywhere but Linux, which is the one
		// platform where these two are different files.
		const expected = isLinux ? 'Create Data Connection' : 'Open Data Connection';
		expect(screen.getByRole('button', { name: expected })).toBeInTheDocument();
	});

	it('offers the connection once one is saved for this file', async () => {
		// The page is left open behind the dialog, so the connection the user just created has to
		// reach it: saving one anywhere flips this page from creating to opening.
		registeredDriver = REGISTERED_DRIVER;
		renderPage();
		expect(screen.getByRole('button', { name: 'Create Data Connection' })).toBeInTheDocument();

		profiles = [savedProfile()];
		await act(async () => { onDidChangeProfiles.fire(profiles); });

		expect(screen.getByRole('button', { name: 'Open Data Connection' })).toBeInTheDocument();
	});

	it('picks up a driver registered while the page is open', async () => {
		renderPage();
		await act(async () => {
			finishActivation();
			await activation;
		});
		expect(screen.getByText('The data connection driver is not available.')).toBeInTheDocument();

		// A driver installed while the page is open has to clear the unavailable message; leaving
		// it up next to a live button would say two contradictory things at once.
		registeredDriver = REGISTERED_DRIVER;
		await act(async () => { onDidChangeDrivers.fire([REGISTERED_DRIVER]); });

		expect(screen.getByText('Create a data connection to browse and query it.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Create Data Connection' })).not.toHaveClass('awaiting-driver');
	});

	it('reports an unavailable driver when the activation itself fails', async () => {
		renderPage();

		await act(async () => {
			failActivation();
			await activation.catch(() => { });
		});

		// Without this the page would sit on "Loading..." forever, with its button hidden and out
		// of the tab order -- a dead end with nothing to act on.
		expect(screen.getByText('The data connection driver is not available.')).toBeInTheDocument();
	});

	it('seeds the configuration dialog with the file and a name taken from it', async () => {
		registeredDriver = REGISTERED_DRIVER;
		const user = userEvent.setup();

		renderPage();
		await user.click(screen.getByRole('button', { name: 'Create Data Connection' }));

		const seeded = modalRender.mock.lastCall?.[0].props.profile;
		expect({
			connectionName: seeded.connectionName,
			mechanismId: seeded.mechanismId,
			parameterValues: seeded.parameterValues,
		}).toEqual({
			connectionName: 'bikeshare',
			mechanismId: 'file',
			parameterValues: { databasePath: RESOURCE_LABEL },
		});
	});

	it('saves the configured connection and shows it in the Data Connections pane', async () => {
		registeredDriver = REGISTERED_DRIVER;
		const user = userEvent.setup();
		const configured = savedProfile({ id: 'conn-2', connectionName: 'bikeshare (read only)' });

		renderPage();
		await user.click(screen.getByRole('button', { name: 'Create Data Connection' }));
		await act(async () => { modalRender.mock.lastCall?.[0].props.onSave(configured); });

		expect(addUpdateProfile).toHaveBeenCalledWith(configured);
		expect(openView).toHaveBeenCalledWith(POSITRON_DATA_CONNECTIONS_VIEW_ID, true);
		expect(revealConnection).toHaveBeenCalledWith('conn-2');
	});
});
