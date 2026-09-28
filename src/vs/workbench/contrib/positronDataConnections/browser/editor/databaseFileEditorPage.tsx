/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './databaseFileEditorPage.css';

// React.
import { useCallback, useEffect, useMemo, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { isLinux } from '../../../../../base/common/platform.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { IDatabaseFileDriver } from './databaseFileEditorInput.js';
import { basename, extname } from '../../../../../base/common/resources.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { pathUriToLabel } from '../../../../browser/utils/path.js';
import { ConfigureDataConnection } from '../dialogs/configureDataConnection.js';
import { POSITRON_DATA_CONNECTIONS_VIEW_ID } from '../positronDataConnectionsConfiguration.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IDataConnectionDriver, IDataConnectionMechanism, IDataConnectionParameter, IDataConnectionProfile, resolveDataConnectionMechanism } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

/**
 * DatabaseFileEditorPageProps interface.
 */
interface DatabaseFileEditorPageProps {
	// The database file the page was opened for.
	readonly resource: URI;

	// The driver that opens this kind of database file.
	readonly driver: IDatabaseFileDriver;
}

/**
 * The file parameter a file mechanism is configured by, paired with the mechanism that declares it.
 * This is what the page seeds with the file it was opened for.
 */
interface IFileMechanism {
	readonly mechanism: IDataConnectionMechanism;
	readonly fileParameter: IDataConnectionParameter;
}

/**
 * Finds the mechanism that connects by database file: the first one with a file parameter. Both
 * file-based drivers expose exactly one mechanism, but the page asks the driver rather than
 * assuming, so a driver that grows a second way to connect (a URL, say) still seeds the right form.
 * @param driver The driver to search.
 * @returns The file mechanism, or undefined if the driver has none.
 */
function findFileMechanism(driver: IDataConnectionDriver): IFileMechanism | undefined {
	for (const mechanism of driver.metadata.mechanisms) {
		const fileParameter = mechanism.parameters.find(parameter => parameter.type === 'file');
		if (fileParameter) {
			return { mechanism, fileParameter };
		}
	}

	return undefined;
}

/**
 * Determines whether two paths name the same file. Compared as the user's platform compares them,
 * since a connection saved as `C:\Db.duckdb` points at the file opened as `C:\db.duckdb`.
 * @param one The first path.
 * @param two The second path.
 */
function samePath(one: string, two: string): boolean {
	return isLinux ? one === two : one.toLowerCase() === two.toLowerCase();
}

/**
 * Finds a saved connection that already points at this file, which the page offers to open rather
 * than have the user create a second connection to the same database.
 *
 * Matching is by the path as written, against the two spellings this file can be written as: the
 * label the page and the configuration dialog's own "Browse..." picker both produce, and the
 * platform path. A connection whose path reaches the same file by some other spelling -- a relative
 * path, a `~`, a symlink -- is not recognized, and the page offers to create one instead. That is
 * the safe way to be wrong: the worst case is the connection the user already has going unmentioned,
 * rather than the page pointing at a database that isn't this one.
 * @param profiles The saved connection profiles to search.
 * @param driver The driver this file belongs to, whose mechanisms say which parameter holds a path.
 * @param resource The database file.
 * @param labelService The label service.
 * @returns The first profile that points at this file, or undefined if none does.
 */
function findExistingProfile(
	profiles: readonly IDataConnectionProfile[],
	driver: IDataConnectionDriver,
	resource: URI,
	labelService: ILabelService,
): IDataConnectionProfile | undefined {
	const spellings = [pathUriToLabel(resource, labelService), resource.fsPath];

	return profiles.find(profile => {
		if (profile.driverMetadata.id !== driver.metadata.id) {
			return false;
		}

		// Which parameter holds the path is the mechanism's business, not this page's, so ask the
		// mechanism the profile was configured with.
		const mechanism = resolveDataConnectionMechanism(driver.metadata, profile.mechanismId);
		const fileParameter = mechanism?.parameters.find(parameter => parameter.type === 'file');
		if (!fileParameter) {
			return false;
		}

		const value = profile.parameterValues[fileParameter.id];
		return typeof value === 'string' &&
			spellings.some(spelling => samePath(value.trim(), spelling));
	});
}

/**
 * The name to seed the connection with: the file's name without its extension, so `bikeshare.duckdb`
 * suggests a connection called `bikeshare`. A dotfile with no extension keeps its whole name.
 * @param resource The database file.
 * @returns The suggested connection name.
 */
function suggestedConnectionName(resource: URI): string {
	const name = basename(resource);
	const extension = extname(resource);
	return extension.length > 0 && extension.length < name.length
		? name.slice(0, -extension.length)
		: name;
}

/**
 * DatabaseFileEditorPage component.
 * The page a database file opens to: it names the file's format, says what a data connection to it
 * would give the user, and offers to create one. Nothing is created, and no connection is opened,
 * until the user presses the button -- opening the file is not on its own a request to connect to
 * it.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const DatabaseFileEditorPage = (props: DatabaseFileEditorPageProps) => {
	// Services.
	const { labelService, logService, positronDataConnectionsService, viewsService } = usePositronReactServicesContext();

	// The user's saved connections, watched rather than read once: a connection created from this
	// page (or from the pane behind it) flips the page to offering to open that connection instead.
	const [profiles, setProfiles] = useState<readonly IDataConnectionProfile[]>(
		() => positronDataConnectionsService.getProfiles()
	);

	// The registered driver, once it is known. Undefined until the driver extension has activated,
	// and permanently undefined if no extension provides this driver.
	const [driver, setDriver] = useState<IDataConnectionDriver | undefined>(
		() => positronDataConnectionsService.driverManager.getDriver(props.driver.id)
	);

	// Whether the driver is known to be missing: its extension has activated and registered no such
	// driver. Distinct from "not resolved yet", which is what an undefined driver alone means.
	const [driverMissing, setDriverMissing] = useState(false);

	// Resolve the driver. Drivers load lazily, when the Data Connections view is first shown, so on
	// this path the page asks for them itself -- the user opening a database file is the same kind
	// of signal, and the page needs the driver's icon to name the format.
	useEffect(() => {
		const driverManager = positronDataConnectionsService.driverManager;
		let disposed = false;

		// Pick up the driver whenever the set of registered drivers changes, so the page fills in
		// behind an extension that activates for some other reason as well -- including one
		// installed while this page is open, which is why a driver arriving clears the missing
		// flag rather than leaving the page saying its driver is unavailable next to a live
		// button.
		const listener = driverManager.onDidChangeDrivers(() => {
			const changedDriver = driverManager.getDriver(props.driver.id);
			setDriver(changedDriver);
			if (changedDriver) {
				setDriverMissing(false);
			}
		});

		const registeredDriver = driverManager.getDriver(props.driver.id);
		setDriver(registeredDriver);
		if (!registeredDriver) {
			driverManager.activateDrivers().then(() => {
				if (disposed) {
					return;
				}

				// The activation event has been dispatched, so every extension that provides a
				// driver has registered it: a driver still absent here is genuinely not installed.
				const activatedDriver = driverManager.getDriver(props.driver.id);
				setDriver(activatedDriver);
				setDriverMissing(activatedDriver === undefined);
			}, error => {
				if (disposed) {
					return;
				}

				// Activation itself failed (the extension host didn't come up, say). The driver is
				// as unavailable as if it weren't installed, and saying so is the only way off this
				// page -- the alternative is a permanent "Loading..." with no button, since the
				// button is hidden until the driver resolves.
				logService.error(`[DatabaseFileEditor] activating data connection drivers failed: ${error}`);
				setDriverMissing(true);
			});
		}

		return () => {
			disposed = true;
			listener.dispose();
		};
	}, [logService, positronDataConnectionsService, props.driver.id]);

	// Watch the saved connections.
	useEffect(() => {
		const listener = positronDataConnectionsService.onDidChangeProfiles(() => {
			setProfiles(positronDataConnectionsService.getProfiles());
		});
		setProfiles(positronDataConnectionsService.getProfiles());

		return () => listener.dispose();
	}, [positronDataConnectionsService]);

	// The connection the user already has to this file, if there is one. Resolved only once the
	// driver is known, since it is the driver's mechanisms that say which parameter holds the path.
	const existingProfile = useMemo(
		() => driver && findExistingProfile(profiles, driver, props.resource, labelService),
		[driver, labelService, profiles, props.resource]
	);

	// The mechanism to configure, and the file parameter within it to seed. Undefined until the
	// driver has resolved, which is what the button waits on: there is nothing to configure before
	// the driver that declares the form has loaded.
	// Memoized because it is a fresh object each time it is derived, which would otherwise make the
	// press handler below a new function on every render.
	const fileMechanism = useMemo(() => driver && findFileMechanism(driver), [driver]);

	// Whether a connection to this file can be created at all: the driver is installed, and it
	// connects by database file. A driver that registered without a file mechanism is as good as
	// absent here -- the page has nothing to seed -- so the two read the same to the user.
	const canCreateConnection = fileMechanism !== undefined;
	const connectionUnavailable = driverMissing || (driver !== undefined && !canCreateConnection);

	// What can be done with the file, which is the one thing that changes across the four states
	// the page can be in: waiting on the driver, holding a connection the user already has, ready
	// to create one, and unable to connect at all. Said on a line of its own, under the line
	// naming the format -- so none of these has to repeat the format's name, and each stays to a
	// single line. The button stays put through all four, disabled until it would do something, so
	// the page doesn't reflow under the pointer.
	const action = connectionUnavailable
		? localize(
			'positron.databaseFileEditor.driverUnavailable',
			"The data connection driver is not available."
		)
		: existingProfile
			? localize(
				'positron.databaseFileEditor.existingConnection',
				"You already have a data connection to it, named \"{0}\".",
				existingProfile.connectionName
			)
			: canCreateConnection
				? localize(
					'positron.databaseFileEditor.createConnectionHint',
					"Create a data connection to browse and query it."
				)
				: localize(
					'positron.databaseFileEditor.loadingDriver',
					"Loading the data connection driver..."
				);

	// Shows a connection in the Data Connections pane: opens the pane, then hands the profile to
	// the pane's tree, which selects it and opens it. Where both of this page's buttons end up --
	// one after creating the connection, the other for the connection the user already had.
	const showConnection = useCallback(async (profileId: string) => {
		await viewsService.openView(POSITRON_DATA_CONNECTIONS_VIEW_ID, true);
		positronDataConnectionsService.revealConnection(profileId);
	}, [positronDataConnectionsService, viewsService]);

	// Open connection handler.
	const openConnectionHandler = useCallback(async () => {
		if (existingProfile) {
			await showConnection(existingProfile.id);
		}
	}, [existingProfile, showConnection]);

	// Create connection handler. Opens the configuration dialog seeded with this file, rather than
	// saving a connection outright, so the user names the connection and chooses whether it is
	// read-only before anything is added to the Data Connections pane.
	const createConnectionHandler = useCallback(() => {
		// The button is only live once both of these are resolved; this is the type guard for it.
		if (!driver || !fileMechanism) {
			return;
		}

		// Seed the profile with this file: the connection is named after the file (without its
		// extension) and its file parameter holds the path, formatted the same way the dialog's own
		// "Browse..." picker formats a path the user chooses. Every other parameter is left to the
		// driver's declared default, which is where the dialog gets them from.
		// A draft, so it carries no createdAt: the dialog stamps that on when the user saves.
		const profile: IDataConnectionProfile = {
			id: generateUuid(),
			connectionName: suggestedConnectionName(props.resource),
			driverMetadata: {
				id: driver.metadata.id,
				name: driver.metadata.name,
				iconSvg: driver.metadata.iconSvg,
				supportedLanguageIds: driver.metadata.supportedLanguageIds,
			},
			mechanismId: fileMechanism.mechanism.id,
			parameterValues: {
				[fileMechanism.fileParameter.id]: pathUriToLabel(props.resource, labelService),
			},
		};

		// Show the configuration dialog.
		const renderer = new PositronModalReactRenderer();
		renderer.render(
			<ConfigureDataConnection
				driver={driver}
				mechanism={fileMechanism.mechanism}
				profile={profile}
				renderer={renderer}
				onSave={savedProfile => {
					// Add the connection profile in the service.
					positronDataConnectionsService.addUpdateProfile(savedProfile);

					// Dispose the renderer to close the dialog.
					renderer.dispose();

					// Show the new connection where the user will work with it from now on.
					void showConnection(savedProfile.id);
				}}
			/>
		);
	}, [driver, fileMechanism, labelService, positronDataConnectionsService, props.resource, showConnection]);

	// Render.
	return (
		<div className='database-file-editor-page'>
			<div className='database-file-editor-page-content'>
				{/*
				 * The format's own mark once the driver is known, in the slot the warning triangle
				 * used to hold. A driver logo is drawn for its own light background (DuckDB's is
				 * black on transparent), so it sits on the same light badge the provider cards give
				 * it, which is what makes it legible in both themes. Until the driver that carries
				 * the logo has loaded the slot stays empty rather than standing something in: it
				 * keeps its size, so the page below it doesn't move when the logo arrives.
				 */}
				<div className={positronClassNames(
					'database-file-editor-page-badge',
					{ 'has-logo': driver !== undefined }
				)}>
					{driver &&
						<img alt='' className='database-file-editor-page-logo' src={`data:image/svg+xml;base64,${driver.metadata.iconSvg}`} />
					}
				</div>

				<div className='database-file-editor-page-title'>
					{basename(props.resource)}
				</div>

				{/* What the file is, then what can be done with it. The fact never changes, so it never moves. */}
				<div className='database-file-editor-page-description'>
					<div>
						{localize(
							'positron.databaseFileEditor.fileType',
							"This is a {0} database file.",
							props.driver.name
						)}
					</div>
					<div>{action}</div>
				</div>

				{/*
				 * Which of the two things this button does isn't known until the driver is, so it
				 * stays invisible until then -- but keeps its place in the layout, so the page it
				 * sits in doesn't move when it appears.
				 */}
				<Button
					ariaDisabled={!existingProfile && !canCreateConnection}
					className={positronClassNames(
						'database-file-editor-page-button',
						'solid',
						{ 'awaiting-driver': driver === undefined }
					)}
					onPressed={existingProfile
						? () => { void openConnectionHandler(); }
						: createConnectionHandler
					}
				>
					{existingProfile
						? localize('positron.databaseFileEditor.openConnection', "Open Data Connection")
						: localize('positron.databaseFileEditor.createConnection', "Create Data Connection")
					}
				</Button>
			</div>
		</div>
	);
};
