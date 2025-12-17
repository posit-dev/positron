/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './listDriversState.css';

// React.
import React, { PropsWithChildren } from 'react';

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

	const onDriverSelectedHandler = (drivers: IDriver[]) => {
		props.onSelection(drivers);
	};

	const { languageId, setLanguageId } = props;
	const driverManager = services.positronConnectionsService.driverManager;

	const drivers = languageId
		? driverManager
			.getDrivers()
			.filter((driver) => driver.metadata.languageId === languageId)
		: [];

	// group drivers by name such that we only display a single driver per name
	const driversByName: Map<string, IDriver[]> = new Map();
	for (const driver of drivers) {
		if (!driversByName.get(driver.metadata.name)) {
			driversByName.set(driver.metadata.name, [driver]);
		} else {
			driversByName.get(driver.metadata.name)?.push(driver);
		}
	}

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
