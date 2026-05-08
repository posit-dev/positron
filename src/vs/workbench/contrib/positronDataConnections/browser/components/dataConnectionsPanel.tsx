/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionsPanel.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DataConnectionProfile } from './dataConnectionProfile.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { DataConnectionInstance } from './dataConnectionInstance.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { NewDataConnectionFlow } from '../dialogs/newDataConnectionFlow.js';
import { PositronList } from '../../../../browser/positronList/positronList.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { DataConnectionSection, IDataConnectionSection } from './dataConnectionSection.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ListEntry, PositronListInstance } from '../../../../browser/positronList/classes/positronListInstance.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { DEFAULT_ACTION_BAR_BUTTON_WIDTH, DynamicActionBarAction, PositronDynamicActionBar } from '../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js';

/**
 * Constants.
 */
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * DataConnectionsPanelProps interface.
 */
interface DataConnectionsPanelProps {
	// Whether the panel is active.
	active: boolean;
}

/**
 * A row in the data connections list. Discriminated so the renderer can dispatch on kind
 * without sniffing for type-specific fields. 'instance' rows wrap a live IDataConnectionInstance
 * (rendered in the Active section); 'profile' rows wrap a persisted IDataConnectionProfile
 * (rendered in the Saved section).
 */
type IDataConnectionListItem =
	| { readonly kind: 'instance'; readonly instance: IDataConnectionInstance }
	| { readonly kind: 'profile'; readonly profile: IDataConnectionProfile };

/**
 * DataConnectionsPanel component.
 */
export const DataConnectionsPanel = ({ active }: DataConnectionsPanelProps) => {
	// Context.
	const { positronDataConnectionsService } = usePositronReactServicesContext();

	// Instances and profiles state. Lazy initializers so the service getters only run on first
	// mount, not every render. The useEffect below resyncs to catch any change between this
	// initial read and effect commit.
	const [instances, setInstances] = useState<readonly IDataConnectionInstance[]>(() => positronDataConnectionsService.getInstances());
	const [profiles, setProfiles] = useState<readonly IDataConnectionProfile[]>(() => positronDataConnectionsService.getProfiles());

	// Listen for changes to data connection instances and profiles, and update state accordingly.
	useEffect(() => {
		// Disposable store to hold our listeners so we can clean them up on unmount.
		const disposableStore = new DisposableStore();

		// Subscribe to future changes.
		disposableStore.add(positronDataConnectionsService.onDidChangeInstances(updatedInstances => {
			setInstances(updatedInstances);
		}));
		disposableStore.add(positronDataConnectionsService.onDidChangeProfiles(updatedProfiles => {
			setProfiles(updatedProfiles);
		}));

		// Resync to current state. The lazy useState initializers ran during render; the service
		// may have fired a change between then and now (effect commit).
		setInstances(positronDataConnectionsService.getInstances());
		setProfiles(positronDataConnectionsService.getProfiles());

		// Clean up listeners on unmount.
		return () => disposableStore.dispose();
	}, [positronDataConnectionsService]);



	// PositronListInstance. Items are a discriminated union: 'instance' rows wrap a live
	// IDataConnectionInstance, 'profile' rows wrap a persisted IDataConnectionProfile. The
	// renderer dispatches on the item's kind.
	const [listInstance] = useState(() => new PositronListInstance<IDataConnectionListItem, IDataConnectionSection>({
		defaultItemHeight: 45,
		itemRenderer: item => item.kind === 'profile'
			? <DataConnectionProfile profile={item.profile} />
			: <DataConnectionInstance instance={item.instance} />,
		defaultSectionHeight: 30,
		sectionRenderer: section => <DataConnectionSection section={section} />
	}));

	// Push the latest instances and profiles into the list, grouped into "Active Connections"
	// (live instances) and "Saved" (persisted profiles). Empty groups are omitted.
	useEffect(() => {
		// Create the list entries.
		const entries: ListEntry<IDataConnectionListItem, IDataConnectionSection>[] = [];

		// Add an "Active Connections" section if there are any instances, and an entry for each instance.
		if (instances.length > 0) {
			// Push the section.
			entries.push({
				kind: 'section',
				section: {
					label: localize('positronDataConnections.activeConnectionsSection', "Active")
				},
			});

			// Push the instances.
			for (const instance of instances) {
				entries.push({
					kind: 'item',
					item: {
						kind: 'instance',
						instance
					}
				});
			}
		}

		// Add a "Saved Connections" section if there are any profiles, and an entry for each profile.
		if (profiles.length > 0) {
			// Push the section.
			entries.push({
				kind: 'section',
				section: {
					label: localize('positronDataConnections.savedConnectionsSection', "Saved")
				},
			});

			// Push the entries.
			for (const profile of profiles) {
				entries.push({
					kind: 'item',
					item: {
						kind: 'profile',
						profile
					}
				});
			}
		}

		// Update the list entries.
		listInstance.setEntries(entries);
	}, [listInstance, instances, profiles]);

	// Dispose the list instance on unmount.
	useEffect(() => () => listInstance.dispose(), [listInstance]);

	// Left action bar actions.
	const leftActions: DynamicActionBarAction[] = [];

	// Right action bar actions.
	const rightActions: DynamicActionBarAction[] = [];

	// Add connection.
	const addConnection = localize('positronDataConnections.addConnection', "Add Connection");
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: false,
		component: (
			<ActionBarButton
				ariaLabel={addConnection}
				disabled={false}
				icon={ThemeIcon.fromId('positron-add-connection')}
				tooltip={addConnection}
				onPressed={() => {
					const renderer = new PositronModalDialogReactRenderer();
					renderer.render(
						<NewDataConnectionFlow
							renderer={renderer}
						/>
					);
				}}
			/>
		)
	});

	// Render.
	return (
		<div
			className={positronClassNames(
				'data-connections-panel',
				{ 'active': active }
			)}
			id='data-connections-panel'
			role='tabpanel'
		>
			<PositronActionBarContextProvider>
				<PositronDynamicActionBar
					borderBottom={true}
					borderTop={true}
					leftActions={leftActions}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
					rightActions={rightActions}
				/>
			</PositronActionBarContextProvider>
			<div className='data-connection-profiles-list'>
				<PositronList<IDataConnectionListItem, IDataConnectionSection>
					emptyListRenderer={() => localize('positronDataConnections.noConnections', "No data connections.")}
					id='data-connection-profiles-list'
					instance={listInstance}
				/>
			</div>
		</div>
	);
};
