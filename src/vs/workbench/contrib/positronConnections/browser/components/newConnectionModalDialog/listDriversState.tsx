/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { PropsWithChildren } from 'react';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/button/positronButton';
import { localize } from 'vs/nls';
import { PositronConnectionsServices } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import { LanguageRuntimeMetadata } from 'positron';
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { DropDownListBoxItem } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBoxItem';
import 'vs/css!./listDriversState';
import { IDriver } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsDriver';

interface ListDriversProps {
	readonly services: PositronConnectionsServices;
	readonly onCancel: () => void;
	readonly onSelection: (driver: IDriver) => void;
	readonly languageId?: string;
	readonly setLanguageId: (languageId: string) => void;
}

export const ListDrivers = (props: PropsWithChildren<ListDriversProps>) => {

	const onDriverSelectedHandler = (driver: IDriver) => {
		props.onSelection(driver);
	};

	const { languageId, setLanguageId } = props;
	const driverManager = props.services.connectionsService.driverManager;

	const drivers = languageId ?
		driverManager.getDrivers().filter(driver => driver.languageId === languageId) :
		[];

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
				keybindingService={props.services.keybindingService}
				layoutService={props.services.layoutService}
				title={(() => localize('positron.newConnectionModalDialog.listDrivers.selectLanguage', "Select a language"))()}
				entries={getRegisteredLanguages(props.services).map((item) => {
					return new DropDownListBoxItem({
						identifier: item.languageId,
						value: item
					});
				})}
				createItem={(item) => {
					const value = item.options.value;

					return <div className='language-dropdown-entry'>
						{value.base64EncodedIconSvg ? <img className='dropdown-entry-icon' src={`data:image/svg+xml;base64,${value.base64EncodedIconSvg}`} /> : null}
						<div className='dropdown-entry-title'>
							{value.languageName}
						</div>
					</div>;
				}}
				onSelectionChanged={(item) => onLanguageChangeHandler(item.options.identifier)}
				selectedIdentifier={languageId}
			>
			</DropDownListBox>
		</div>
		<div className='driver-list'>
			{
				drivers.length > 0 ?
					drivers.map(driver => {
						const icon = driver.base64EncodedIconSvg ?
							<img className='driver-icon' src={`data:image/svg+xml;base64,${driver.base64EncodedIconSvg}`} /> :
							<div className='driver-icon codicon codicon-database' style={{ opacity: 0.5, fontSize: '24px' }}></div>;

						return <div key={driver.driverId} className='driver-list-item'>
							{icon}
							<div className='driver-info' onMouseDown={() => onDriverSelectedHandler(driver)}>
								<div className='driver-name'>
									{driver.name}
								</div>
								<div className={`driver-button codicon codicon-chevron-right`}>
								</div>
							</div>
						</div>;
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

const getRegisteredLanguages = (services: PositronConnectionsServices) => {
	const languages = new Map<string, LanguageRuntimeMetadata>();
	for (const runtime of services.languageRuntimeService.registeredRuntimes) {
		if (languages.has(runtime.languageId)) {
			continue;
		}
		const preferedMetadata = services.runtimeAffiliationService.getPreferredRuntime(runtime.languageId);
		languages.set(runtime.languageId, preferedMetadata);
	}
	return Array.from(languages.values());
};
