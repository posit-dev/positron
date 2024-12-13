/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../languageRuntime/common/languageRuntimeService.js';
import { IDriver, Input, InputType } from './interfaces/positronConnectionsDriver.js';
import { IPositronConnectionsService } from './interfaces/positronConnectionsService.js';
import { ILanguageRuntimeSession } from '../../runtimeSession/common/runtimeSessionService.js';

export class PositronConnectionsDriverManager {
	private readonly drivers: IDriver[] = [];

	constructor(readonly service: IPositronConnectionsService) {
		this.registerDefaultDrivers();
	}

	registerDriver(driver: IDriver): void {
		// Check that a driver with the same id does not already exist.
		const index = this.drivers.findIndex(d => d.driverId === driver.driverId);
		if (index > 0) {
			this.drivers[index] = driver;
		} else {
			this.drivers.push(driver);
		}
	}

	getDrivers(): IDriver[] {
		return this.drivers;
	}

	private registerDefaultDrivers(): void {
		this.registerDriver(new RPostgreSQLDriver(this.service));
	}
}


class RPostgreSQLDriver implements IDriver {
	constructor(readonly service: IPositronConnectionsService) { }

	languageId: string = 'r';
	driverId: string = 'postgres';
	name: string = 'PostgresSQL';
	inputs: Input[] = [
		{
			'id': 'dbname',
			'label': 'Database Name',
			'type': InputType.String,
			'value': 'localhost'
		},
		{
			'id': 'host',
			'label': 'Host',
			'type': InputType.String,
			'value': 'localhost'
		},
		{
			'id': 'port',
			'label': 'Port',
			'type': InputType.Number,
			'value': '5432'
		},
		{
			'id': 'user',
			'label': 'User',
			'type': InputType.String,
			'value': 'postgres'
		},
		{
			'id': 'password',
			'label': 'Password',
			'type': InputType.String,
			'value': 'password'
		},
		{
			'id': 'bigint',
			'label': 'Integer representation',
			'type': InputType.Option,
			'options': [
				{ 'identifier': 'integer64', 'title': 'integer64' },
				{ 'identifier': 'integer', 'title': 'integer' },
				{ 'identifier': 'numeric', 'title': 'numeric' },
				{ 'identifier': 'character', 'title': 'character' }
			],
			'value': 'integer64'
		}
	];

	generateCode(inputs: Array<Input>) {
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
		// Check if the foreground session is an R session.
		const session = this.getSession();

		if (!session) {
			throw new Error('No R session found. Create an R session and retry.');
		}

		// We don't get to know if something failed. That's fine for now as the error would be displayed
		// in the console.
		session.execute(code, 'connect', RuntimeCodeExecutionMode.Interactive, RuntimeErrorBehavior.Stop);
	}

	getSession(): ILanguageRuntimeSession | undefined {
		const foregroundSession = this.service.runtimeSessionService.foregroundSession;
		if (foregroundSession && foregroundSession.runtimeMetadata.languageId === 'r') {
			return foregroundSession;
		}

		// If no foreground session, we'll check if there's a running R session.
		const session = this.service.runtimeSessionService.activeSessions.find(session => session.runtimeMetadata.languageId === 'r');
		if (session) {
			return session;
		}

		// No running R session. For now we don't do anything to start a new session.
		return undefined;
	}
}
