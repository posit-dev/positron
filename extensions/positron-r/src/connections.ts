/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';

export function registerConnectionDrivers() {
	positron.connections.registerConnectionDriver(new RPostgreSQLDriver());
}

class RPostgreSQLDriver implements positron.ConnectionsDriver {
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
}

