/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

export function registerConnectionDrivers(context: vscode.ExtensionContext) {
	for (const driver of [new RSQLiteDriver(), new RPostgreSQLDriver()]) {
		context.subscriptions.push(
			positron.connections.registerConnectionDriver(driver)
		);
	}
}

///  A generic driver implementation
class RDriver implements positron.ConnectionsDriver {

	driverId: string = 'unknown';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'r',
		name: 'Unknown',
		inputs: []
	};

	constructor(readonly packages: string[]) { }

	async connect(code: string) {
		const exec = await positron.runtime.executeCode(
			'r',
			code,
			true,
			false,
			positron.RuntimeCodeExecutionMode.Interactive,
			positron.RuntimeErrorBehavior.Continue
		);
		if (!exec) {
			throw new Error('Failed to execute code');
		}
		return;
	}

	async checkDependencies() {
		// Currently we skip dependency checks if there's no active R session
		// in the foreground.
		if (this.packages.length === 0) {
			return true;
		}

		const session = await positron.runtime.getForegroundSession();
		if (session) {

			if (session.runtimeMetadata.languageId !== 'r') {
				return true;
			}

			for (const pkg of this.packages) {
				const installed = await session.callMethod?.('is_installed', pkg);
				if (!installed) {
					return false;
				}
			}
		}

		return true;
	}

	async installDependencies() {
		// Similar to checkDependencies, we skip dependency installation if there's
		// no active R session in the foreground.
		if (this.packages.length === 0) {
			return true;
		}
		const session = await positron.runtime.getForegroundSession();
		if (session) {

			if (session.runtimeMetadata.languageId !== 'r') {
				return true;
			}

			const allow_install = await positron.window.showSimpleModalDialogPrompt(
				vscode.l10n.t("Installing dependencies"),
				vscode.l10n.t("The following R packages are required for this connection: {0}. Would you like to install them now?", this.packages.join(', '))
			);

			if (!allow_install) {
				return false;
			}

			for (const pkg of this.packages) {
				const installed = await session.callMethod?.('is_installed', pkg);
				if (!installed) {
					const install_succeed = await session.callMethod?.('install_packages', pkg);
					if (!install_succeed) {
						throw new Error('Failed to install dependencies');
					}
				}
			}
		}
		return true;
	}
}

class RPostgreSQLDriver extends RDriver implements positron.ConnectionsDriver {

	constructor() {
		super(['RPostgres', 'DBI']);
	}

	driverId: string = 'postgres';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'r',
		name: 'PostgresSQL',
		inputs: [
			{
				'id': 'dbname',
				'label': 'Database Name',
				'type': 'string',
				'value': 'localhost'
			},
			{
				'id': 'host',
				'label': 'Host',
				'type': 'string',
				'value': 'localhost'
			},
			{
				'id': 'port',
				'label': 'Port',
				'type': 'number',
				'value': '5432'
			},
			{
				'id': 'user',
				'label': 'User',
				'type': 'string',
				'value': 'postgres'
			},
			{
				'id': 'password',
				'label': 'Password',
				'type': 'string',
				'value': 'password'
			},
			{
				'id': 'bigint',
				'label': 'Integer representation',
				'type': 'option',
				'options': [
					{ 'identifier': 'integer64', 'title': 'integer64' },
					{ 'identifier': 'integer', 'title': 'integer' },
					{ 'identifier': 'numeric', 'title': 'numeric' },
					{ 'identifier': 'character', 'title': 'character' }
				],
				'value': 'integer64'
			}
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const dbname = inputs.find(input => input.id === 'dbname')?.value;
		const host = inputs.find(input => input.id === 'host')?.value;
		const port = inputs.find(input => input.id === 'port')?.value;
		const user = inputs.find(input => input.id === 'user')?.value;
		const password = inputs.find(input => input.id === 'password')?.value;
		const bigint = inputs.find(input => input.id === 'bigint')?.value;

		return `library(DBI)
con <- dbConnect(
	RPostgres::Postgres(),
	dbname = '${dbname ?? ''}',
	host = '${host ?? ''}',
	port = ${port ?? ''},
	user = '${user ?? ''}',
	password = '${password ?? ''}',
	bigint = '${bigint ?? ''}'
)
`;
	}
}

class RSQLiteDriver extends RDriver implements positron.ConnectionsDriver {

	constructor() {
		super(['RSQLite', 'DBI', 'connections']);
	}

	driverId: string = 'sqlite';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'r',
		name: 'SQLite',
		inputs: [
			{
				'id': 'dbname',
				'label': 'Database Name',
				'type': 'string',
				'value': 'database.db'
			},
			{
				'id': 'bigint',
				'label': 'Integer representation',
				'type': 'option',
				'options': [
					{ 'identifier': 'integer64', 'title': 'integer64' },
					{ 'identifier': 'integer', 'title': 'integer' },
					{ 'identifier': 'numeric', 'title': 'numeric' },
					{ 'identifier': 'character', 'title': 'character' }
				],
				'value': 'integer64'
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const dbname = inputs.find(input => input.id === 'dbname')?.value;
		const bigint = inputs.find(input => input.id === 'bigint')?.value;

		return `library(DBI)
con <- dbConnect(
	RSQLite::SQLite(),
	${dbname ? `dbname = '${dbname}'` : ''},
	bigint = '${bigint ?? ''}'
)
connections:: connection_view(con)
`;
	}
}

