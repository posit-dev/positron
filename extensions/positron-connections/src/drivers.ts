/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import path = require('path');
import * as positron from 'positron';
import * as vscode from 'vscode';

export function registerConnectionDrivers(context: vscode.ExtensionContext) {

	const drivers = [
		new RSQLiteDriver(context),
		new RPostgreSQLDriver(context),
		new RSparkShellDriver(context),
		new RSparkLivyDriver(context),
		new RSparkDatabricksDriver(context),
		new RSparkQuboleDriver(context),
		new RSparkSynapseDriver(context),
		new PythonSQLiteDriver(context),
		new PythonPostgreSQLDriver(context),
		new PythonDuckDBDriver(context),
	];

	for (const driver of drivers) {
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

	constructor(context: vscode.ExtensionContext) {
		super(['RPostgres', 'DBI', 'connections']);
		// See the top-level NOTICE file for attribution and license details.
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'postgre.svg');
		const iconData = readFileSync(iconPath, 'base64');
		this.metadata.base64EncodedIconSvg = iconData;
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
connections::connection_view(con)
`;
	}
}

class RSQLiteDriver extends RDriver implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super(['RSQLite', 'DBI', 'connections']);
		// See the top-level ThirdPartyNotices.txt file for attribution and license details.
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'sqlite.svg');
		const iconData = readFileSync(iconPath, 'base64');
		this.metadata.base64EncodedIconSvg = iconData;
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
		const dbname = inputs.find(input => input.id === 'dbname')?.value ?? '';
		const bigint = inputs.find(input => input.id === 'bigint')?.value ?? '';

		return `library(DBI)
con <- dbConnect(
	RSQLite::SQLite(),
	dbname = ${JSON.stringify(dbname)},
	bigint = ${JSON.stringify(bigint)}
)
connections::connection_view(con)
`;
	}
}

class RSparkDriverBase extends RDriver implements positron.ConnectionsDriver {

	constructor(
		context: vscode.ExtensionContext,
		driverId: string,
		description: string,
		private readonly method: string,
		inputs: positron.ConnectionsDriverMetadata['inputs']
	) {
		super(['sparklyr']);
		this.driverId = driverId;
		this.metadata = {
			languageId: 'r',
			name: 'Spark',
			description,
			inputs,
		};
		// See the top-level ThirdPartyNotices.txt file for attribution and license details.
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'spark.svg');
		const iconData = readFileSync(iconPath, 'base64');
		this.metadata.base64EncodedIconSvg = iconData;
	}

	driverId: string;
	metadata: positron.ConnectionsDriverMetadata;

	protected buildArguments(inputs: positron.ConnectionsInput[]) {
		const args: string[] = [];

		for (const input of this.metadata.inputs) {
			const value = inputs.find(i => i.id === input.id)?.value ?? input.value ?? '';
			if (value === '') {
				continue;
			}
			args.push(`${input.id} = ${JSON.stringify(value)}`);
		}

		args.push(`method = ${JSON.stringify(this.method)}`);

		return args;
	}

	generateCode(inputs: positron.ConnectionsInput[]) {
		const args = this.buildArguments(inputs);
		const joinedArgs = args.join(',\n\t');

		return `library(sparklyr)
sc <- spark_connect(
\t${joinedArgs}
)
`;
	}
}

class RSparkShellDriver extends RSparkDriverBase implements positron.ConnectionsDriver {
	constructor(context: vscode.ExtensionContext) {
		super(
			context,
			'spark-shell',
			'Local shell or standalone master',
			'shell',
			[
				{
					'id': 'master',
					'label': 'Master',
					'type': 'string',
					'value': 'local'
				},
			]
		);
	}
}

class RSparkLivyDriver extends RSparkDriverBase implements positron.ConnectionsDriver {
	constructor(context: vscode.ExtensionContext) {
		super(
			context,
			'spark-livy',
			'Connect through a Livy server',
			'livy',
			[
				{
					'id': 'master',
					'label': 'Livy URL',
					'type': 'string',
					'value': 'http://localhost:8998'
				},
				{
					'id': 'username',
					'label': 'Username',
					'type': 'string',
					'value': '<username>'
				},
				{
					'id': 'password',
					'label': 'Password',
					'type': 'string',
					'value': '<password>'
				},
			]
		);
	}
}

class RSparkDatabricksDriver extends RSparkDriverBase implements positron.ConnectionsDriver {
	constructor(context: vscode.ExtensionContext) {
		super(
			context,
			'spark-databricks',
			'Databricks cluster',
			'databricks',
			[
				{
					'id': 'host',
					'label': 'Workspace URL',
					'type': 'string',
					'value': 'https://<workspace>.cloud.databricks.com'
				},
				{
					'id': 'token',
					'label': 'Access Token',
					'type': 'string',
					'value': '<access-token>'
				},
				{
					'id': 'cluster',
					'label': 'Cluster ID',
					'type': 'string',
					'value': '<cluster-id>'
				},
			]
		);
	}
}

class RSparkQuboleDriver extends RSparkDriverBase implements positron.ConnectionsDriver {
	constructor(context: vscode.ExtensionContext) {
		super(
			context,
			'spark-qubole',
			'Qubole managed cluster',
			'qubole',
			[
				{
					'id': 'host',
					'label': 'QDS Host',
					'type': 'string',
					'value': 'https://api.qubole.com'
				},
				{
					'id': 'token',
					'label': 'API Token',
					'type': 'string',
					'value': '<api-token>'
				},
				{
					'id': 'cluster',
					'label': 'Cluster Label',
					'type': 'string',
					'value': '<cluster-label>'
				},
			]
		);
	}
}

class RSparkSynapseDriver extends RSparkDriverBase implements positron.ConnectionsDriver {
	constructor(context: vscode.ExtensionContext) {
		super(
			context,
			'spark-synapse',
			'Azure Synapse Spark pool',
			'synapse',
			[
				{
					'id': 'master',
					'label': 'Synapse Endpoint',
					'type': 'string',
					'value': 'https://<workspace>.dev.azuresynapse.net'
				},
				{
					'id': 'pool',
					'label': 'Spark Pool',
					'type': 'string',
					'value': '<spark-pool>'
				},
				{
					'id': 'access_token',
					'label': 'Access Token',
					'type': 'string',
					'value': '<access-token>'
				},
			]
		);
	}
}

class PythonDriver implements positron.ConnectionsDriver {
	driverId: string = 'python';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Unknown',
		inputs: []
	};

	async connect(code: string) {
		const exec = await positron.runtime.executeCode(
			'python',
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

class PythonSQLiteDriver extends PythonDriver implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		// See the top-level ThirdPartyNotices.txt file for attribution and license details.
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'sqlite.svg');
		const iconData = readFileSync(iconPath, 'base64');
		this.metadata.base64EncodedIconSvg = iconData;
	}

	driverId: string = 'py-sqlite';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'SQLite',
		inputs: [
			{
				'id': 'dbname',
				'label': 'Database Name',
				'type': 'string',
				'value': 'database.db'
			},
			{
				'id': 'timeout',
				'label': 'Timeout',
				'type': 'number',
				'value': '5.0'
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const dbname = inputs.find(input => input.id === 'dbname')?.value;

		return `import sqlite3
conn = sqlite3.connect(${JSON.stringify(dbname) ?? JSON.stringify('')})
%connection_show conn
`;
	}
}

class PythonPostgreSQLDriver extends PythonDriver implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		// See the top-level ThirdPartyNotices.txt file for attribution and license details.
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'postgre.svg');
		const iconData = readFileSync(iconPath, 'base64');
		this.metadata.base64EncodedIconSvg = iconData;
	}

	driverId: string = 'py-postgres';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
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
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const dbname = inputs.find(input => input.id === 'dbname')?.value;
		const host = inputs.find(input => input.id === 'host')?.value;
		const port = inputs.find(input => input.id === 'port')?.value;
		const user = inputs.find(input => input.id === 'user')?.value;
		const password = inputs.find(input => input.id === 'password')?.value;

		const connection_string = `postgresql+psycopg2://${user}:${password}@${host}:${port}/${dbname}`;

		return `import sqlalchemy
conn = sqlalchemy.create_engine(sqlalchemy.URL.create(
	"postgresql+psycopg2",
	username=${JSON.stringify(user)},
	password=${JSON.stringify(password)},
	host=${JSON.stringify(host)},
	database=${JSON.stringify(dbname)},
	port=${JSON.stringify(port)}
))
%connection_show conn
`;
	}
}

class PythonDuckDBDriver extends PythonDriver implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		// See the top-level ThirdPartyNotices.txt file for attribution and license details.
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'duckdb.svg');
		const iconData = readFileSync(iconPath, 'base64');
		this.metadata.base64EncodedIconSvg = iconData;
	}

	driverId: string = 'py-duckdb';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'DuckDB',
		inputs: [
			{
				'id': 'database',
				'label': 'Database path',
				'type': 'string',
				'value': ':memory:'
			},
			{
				'id': 'read_only',
				'label': 'Read Only',
				'type': 'option',
				'options': [
					{ 'identifier': 'false', 'title': 'False' },
					{ 'identifier': 'true', 'title': 'True' }
				],
				'value': 'false'
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const database = inputs.find(input => input.id === 'database')?.value;
		const read_only = inputs.find(input => input.id === 'read_only')?.value == 'false' ? 'False' : 'True';

		return `import duckdb
conn = duckdb.connect(${JSON.stringify(database)}, read_only=${read_only})
%connection_show conn
`;
	}
}
