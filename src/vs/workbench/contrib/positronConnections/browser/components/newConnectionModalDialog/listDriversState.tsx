/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './listDriversState.css';

// React.
import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { PositronButton } from '../../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { localize } from '../../../../../../nls.js';
import { LanguageRuntimeMetadata } from 'positron';
import { DropDownListBox } from '../../../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { IDriver } from '../../../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { PositronReactServices } from '../../../../../../base/browser/positronReactServices.js';

interface ListDriversProps {
	readonly onCancel: () => void;
	readonly onSelection: (drivers: IDriver[]) => void;
	readonly languageId?: string;
	readonly setLanguageId: (languageId: string) => void;
}

export const ListDrivers = (props: PropsWithChildren<ListDriversProps>) => {
	const services = usePositronReactServicesContext();
	const driverManager = services.positronConnectionsService.driverManager;
	const runtimeSessionService = services.runtimeSessionService;

	const { languageId, setLanguageId } = props;

	// Use a ref to track languageId to avoid recreating the subscription on every change
	const languageIdRef = useRef(languageId);
	useEffect(() => {
		languageIdRef.current = languageId;
	}, [languageId]);

	// Store raw drivers list in state
	// Note: We spread the array to create a new reference, since driverManager.getDrivers()
	// may return the same mutable array, and React skips re-renders if the reference is unchanged.
	const [drivers, setDrivers] = useState(() => [...driverManager.getDrivers()]);

	// Subscribe to driver changes
	useEffect(() => {
		const disposable = driverManager.onDidChangeDrivers((newDrivers) => {
			setDrivers(newDrivers);
		});
		// Re-fetch after subscription to catch any changes we might have missed
		setDrivers([...driverManager.getDrivers()]);
		return () => disposable.dispose();
	}, [driverManager]);

	// Auto-select language when a console starts and no language is selected
	useEffect(() => {
		const disposable = runtimeSessionService.onDidStartRuntime((session) => {
			if (!languageIdRef.current) {
				setLanguageId(session.runtimeMetadata.languageId);
			}
		});
		return () => disposable.dispose();
	}, [runtimeSessionService, setLanguageId]);

	// Compute filtered/grouped drivers during render
	const driversByName = (() => {
		const filtered = languageId
			? drivers.filter((driver) => driver.metadata.languageId === languageId)
			: [];

		const grouped = new Map<string, IDriver[]>();
		for (const driver of filtered) {
			const existing = grouped.get(driver.metadata.name);
			if (existing) {
				existing.push(driver);
			} else {
				grouped.set(driver.metadata.name, [driver]);
			}
		}
		return grouped;
	})();

	const onDriverSelectedHandler = (drivers: IDriver[]) => {
		props.onSelection(drivers);
	};

	const onLanguageChangeHandler = (lang: string) => {
		setLanguageId(lang);
	};

	return <div className='connections-new-connection-list-drivers'>
		<div className='title'>
			<h1>
				{(() => localize('positron.newConnectionModalDialog.listDrivers.title', "Choose a Database Driver"))()}
			</h1>
		</div>
		<div className='select-language'>
			<DropDownListBox
				createItem={(item) => {
					const value = item.options.value;

					return <div className='language-dropdown-entry'>
						{value.base64EncodedIconSvg ? <img className='dropdown-entry-icon' src={`data:image/svg+xml;base64,${value.base64EncodedIconSvg}`} /> : null}
						<div className='dropdown-entry-title'>
							{value.languageName}
						</div>
					</div>;
				}}
				entries={getRegisteredLanguages(services).map((item) => {
					return new DropDownListBoxItem({
						identifier: item.languageId,
						value: item
					});
				})}
				selectedIdentifier={languageId}
				title={(() => localize('positron.newConnectionModalDialog.listDrivers.selectLanguage', "Select a language"))()}
				onSelectionChanged={(item) => onLanguageChangeHandler(item.options.identifier)}
			>
			</DropDownListBox>
		</div>
		<div className='driver-list'>
			{
				driversByName.size > 0 ?
					[...driversByName].map(([name, drivers]) => {
						// find the first icon
						const baseIcon = drivers[0].metadata.base64EncodedIconSvg;

						const icon = baseIcon ?
							<img alt='' className='driver-icon' src={`data:image/svg+xml;base64,${baseIcon}`} /> :
							<div className='driver-icon codicon codicon-database' style={{ opacity: 0.5, fontSize: '24px' }}></div>;

						return <button
							key={name}
							className='driver-list-item'
							onClick={() => onDriverSelectedHandler(drivers)}
						>
							{icon}
							<div className='driver-info'>
								<div className='driver-name'>
									{name}
								</div>
								<div className={`driver-button codicon codicon-chevron-right`}>
								</div>
							</div>
						</button>;
					}) :
					<div className='no-drivers'>
						{(() => localize('positron.newConnectionModalDialog.listDrivers.noDrivers', "No drivers available"))()}
					</div>
			}
		</div>
		<div className='footer'>
			<PositronButton
				className='button action-bar-button'
				onPressed={props.onCancel}
			>
				{(() => localize('positron.resumeConnectionModalDialog.cancel', "Cancel"))()}
			</PositronButton>
		</div>
	</div>;
};

const getRegisteredLanguages = (services: PositronReactServices) => {
	const languages = new Map<string, LanguageRuntimeMetadata>();
	for (const runtime of services.languageRuntimeService.registeredRuntimes) {
		if (languages.has(runtime.languageId)) {
			continue;
		}
		const preferredMetadata = services.runtimeStartupService.getPreferredRuntime(runtime.languageId);
		if (preferredMetadata) {
			languages.set(runtime.languageId, preferredMetadata);
		}
	}
	return Array.from(languages.values());
};
