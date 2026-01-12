/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import path = require('path');
import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Base class for Python Snowflake drivers.
 * Provides common functionality for executing Python code via Positron.
 */
class PythonSnowflakeDriverBase implements positron.ConnectionsDriver {
	driverId: string = 'py-snowflake';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Snowflake',
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

	protected loadIcon(context: vscode.ExtensionContext) {
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'snowflake.svg');
		try {
			const iconData = readFileSync(iconPath, 'base64');
			this.metadata.base64EncodedIconSvg = iconData;
		} catch {
			// Icon file may not exist yet, continue without it
		}
	}
}

/**
 * Python Snowflake driver using Username/Password authentication.
 *
 * This is the simplest authentication method, using a username and password
 * to connect to a Snowflake account.
 *
 * Required parameters:
 * - account: The Snowflake account identifier
 * - user: The Snowflake login name
 * - password: The user's password
 * - warehouse: The warehouse to use
 * - database: The database to connect to
 * - schema: The schema to use
 */
export class PythonSnowflakePasswordDriver extends PythonSnowflakeDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		this.loadIcon(context);
	}

	driverId: string = 'py-snowflake-password';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Snowflake',
		description: 'Username/Password',
		inputs: [
			{
				'id': 'account',
				'label': 'Account',
				'type': 'string',
				'value': '<account-identifier>'
			},
			{
				'id': 'user',
				'label': 'User',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'password',
				'label': 'Password',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'warehouse',
				'label': 'Warehouse',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'database',
				'label': 'Database',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'schema',
				'label': 'Schema',
				'type': 'string',
				'value': ''
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const account = inputs.find(input => input.id === 'account')?.value ?? '';
		const user = inputs.find(input => input.id === 'user')?.value ?? '';
		const password = inputs.find(input => input.id === 'password')?.value ?? '';
		const warehouse = inputs.find(input => input.id === 'warehouse')?.value ?? '';
		const database = inputs.find(input => input.id === 'database')?.value ?? '';
		const schema = inputs.find(input => input.id === 'schema')?.value ?? '';

		return `import snowflake.connector

conn = snowflake.connector.connect(
	account=${JSON.stringify(account)},
	user=${JSON.stringify(user)},
	password=${JSON.stringify(password)},
	warehouse=${JSON.stringify(warehouse)},
	database=${JSON.stringify(database)},
	schema=${JSON.stringify(schema)}
)
%connection_show conn
`;
	}
}

/**
 * Python Snowflake driver using External Browser (SSO) authentication.
 *
 * This authentication method opens a browser window for the user to
 * authenticate with their identity provider (SSO).
 *
 * Required parameters:
 * - account: The Snowflake account identifier
 * - user: The Snowflake login name
 * - warehouse: The warehouse to use
 * - database: The database to connect to
 * - schema: The schema to use
 */
export class PythonSnowflakeSSODriver extends PythonSnowflakeDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		this.loadIcon(context);
	}

	driverId: string = 'py-snowflake-sso';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Snowflake',
		description: 'External Browser (SSO)',
		inputs: [
			{
				'id': 'account',
				'label': 'Account',
				'type': 'string',
				'value': '<account-identifier>'
			},
			{
				'id': 'user',
				'label': 'User',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'warehouse',
				'label': 'Warehouse',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'database',
				'label': 'Database',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'schema',
				'label': 'Schema',
				'type': 'string',
				'value': ''
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const account = inputs.find(input => input.id === 'account')?.value ?? '';
		const user = inputs.find(input => input.id === 'user')?.value ?? '';
		const warehouse = inputs.find(input => input.id === 'warehouse')?.value ?? '';
		const database = inputs.find(input => input.id === 'database')?.value ?? '';
		const schema = inputs.find(input => input.id === 'schema')?.value ?? '';

		return `import snowflake.connector

conn = snowflake.connector.connect(
	account=${JSON.stringify(account)},
	user=${JSON.stringify(user)},
	authenticator="externalbrowser",
	warehouse=${JSON.stringify(warehouse)},
	database=${JSON.stringify(database)},
	schema=${JSON.stringify(schema)}
)
%connection_show conn
`;
	}
}

/**
 * Python Snowflake driver using Key Pair authentication.
 *
 * This authentication method uses a private key file for secure,
 * non-interactive authentication.
 *
 * Required parameters:
 * - account: The Snowflake account identifier
 * - user: The Snowflake login name
 * - private_key_file: Path to the private key file
 * - private_key_file_pwd: Passphrase for the private key (if encrypted)
 * - warehouse: The warehouse to use
 * - database: The database to connect to
 * - schema: The schema to use
 */
export class PythonSnowflakeKeyPairDriver extends PythonSnowflakeDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		this.loadIcon(context);
	}

	driverId: string = 'py-snowflake-keypair';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Snowflake',
		description: 'Key Pair',
		inputs: [
			{
				'id': 'account',
				'label': 'Account',
				'type': 'string',
				'value': '<account-identifier>'
			},
			{
				'id': 'user',
				'label': 'User',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'private_key_file',
				'label': 'Private Key File',
				'type': 'string',
				'value': '/path/to/private_key.p8'
			},
			{
				'id': 'private_key_file_pwd',
				'label': 'Private Key Passphrase',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'warehouse',
				'label': 'Warehouse',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'database',
				'label': 'Database',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'schema',
				'label': 'Schema',
				'type': 'string',
				'value': ''
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const account = inputs.find(input => input.id === 'account')?.value ?? '';
		const user = inputs.find(input => input.id === 'user')?.value ?? '';
		const privateKeyFile = inputs.find(input => input.id === 'private_key_file')?.value ?? '';
		const privateKeyFilePwd = inputs.find(input => input.id === 'private_key_file_pwd')?.value ?? '';
		const warehouse = inputs.find(input => input.id === 'warehouse')?.value ?? '';
		const database = inputs.find(input => input.id === 'database')?.value ?? '';
		const schema = inputs.find(input => input.id === 'schema')?.value ?? '';

		// If passphrase is provided, include it; otherwise omit the parameter
		const pwdParam = privateKeyFilePwd
			? `\n\tprivate_key_file_pwd=${JSON.stringify(privateKeyFilePwd)},`
			: '';

		return `import snowflake.connector

conn = snowflake.connector.connect(
	account=${JSON.stringify(account)},
	user=${JSON.stringify(user)},
	private_key_file=${JSON.stringify(privateKeyFile)},${pwdParam}
	warehouse=${JSON.stringify(warehouse)},
	database=${JSON.stringify(database)},
	schema=${JSON.stringify(schema)}
)
%connection_show conn
`;
	}
}

/**
 * Python Snowflake driver using OAuth Client Credentials (M2M) authentication.
 *
 * This authentication method uses OAuth 2.0 client credentials flow for
 * machine-to-machine authentication without user interaction.
 *
 * Required parameters:
 * - account: The Snowflake account identifier
 * - user: The Snowflake login name
 * - oauth_client_id: The OAuth client ID
 * - oauth_client_secret: The OAuth client secret
 * - oauth_token_request_url: The token endpoint URL
 * - warehouse: The warehouse to use
 * - database: The database to connect to
 * - schema: The schema to use
 */
export class PythonSnowflakeOAuthM2MDriver extends PythonSnowflakeDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		this.loadIcon(context);
	}

	driverId: string = 'py-snowflake-oauth-m2m';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Snowflake',
		description: 'OAuth Client Credentials (M2M)',
		inputs: [
			{
				'id': 'account',
				'label': 'Account',
				'type': 'string',
				'value': '<account-identifier>'
			},
			{
				'id': 'user',
				'label': 'User',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'oauth_client_id',
				'label': 'OAuth Client ID',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'oauth_client_secret',
				'label': 'OAuth Client Secret',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'oauth_token_request_url',
				'label': 'Token Request URL',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'warehouse',
				'label': 'Warehouse',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'database',
				'label': 'Database',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'schema',
				'label': 'Schema',
				'type': 'string',
				'value': ''
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const account = inputs.find(input => input.id === 'account')?.value ?? '';
		const user = inputs.find(input => input.id === 'user')?.value ?? '';
		const oauthClientId = inputs.find(input => input.id === 'oauth_client_id')?.value ?? '';
		const oauthClientSecret = inputs.find(input => input.id === 'oauth_client_secret')?.value ?? '';
		const oauthTokenRequestUrl = inputs.find(input => input.id === 'oauth_token_request_url')?.value ?? '';
		const warehouse = inputs.find(input => input.id === 'warehouse')?.value ?? '';
		const database = inputs.find(input => input.id === 'database')?.value ?? '';
		const schema = inputs.find(input => input.id === 'schema')?.value ?? '';

		return `import snowflake.connector

conn = snowflake.connector.connect(
	account=${JSON.stringify(account)},
	user=${JSON.stringify(user)},
	authenticator="oauth_client_credentials",
	oauth_client_id=${JSON.stringify(oauthClientId)},
	oauth_client_secret=${JSON.stringify(oauthClientSecret)},
	oauth_token_request_url=${JSON.stringify(oauthTokenRequestUrl)},
	warehouse=${JSON.stringify(warehouse)},
	database=${JSON.stringify(database)},
	schema=${JSON.stringify(schema)}
)
%connection_show conn
`;
	}
}

/**
 * Python Snowflake driver using Programmatic Access Token (PAT) authentication.
 *
 * PATs are Snowflake-specific tokens that can replace passwords for
 * non-interactive authentication. The token is used in place of the password.
 *
 * Required parameters:
 * - account: The Snowflake account identifier
 * - user: The Snowflake login name
 * - token: The Programmatic Access Token (used as password)
 * - warehouse: The warehouse to use
 * - database: The database to connect to
 * - schema: The schema to use
 */
export class PythonSnowflakePATDriver extends PythonSnowflakeDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		this.loadIcon(context);
	}

	driverId: string = 'py-snowflake-pat';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Snowflake',
		description: 'Programmatic Access Token (PAT)',
		inputs: [
			{
				'id': 'account',
				'label': 'Account',
				'type': 'string',
				'value': '<account-identifier>'
			},
			{
				'id': 'user',
				'label': 'User',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'token',
				'label': 'Access Token',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'warehouse',
				'label': 'Warehouse',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'database',
				'label': 'Database',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'schema',
				'label': 'Schema',
				'type': 'string',
				'value': ''
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const account = inputs.find(input => input.id === 'account')?.value ?? '';
		const user = inputs.find(input => input.id === 'user')?.value ?? '';
		const token = inputs.find(input => input.id === 'token')?.value ?? '';
		const warehouse = inputs.find(input => input.id === 'warehouse')?.value ?? '';
		const database = inputs.find(input => input.id === 'database')?.value ?? '';
		const schema = inputs.find(input => input.id === 'schema')?.value ?? '';

		return `import snowflake.connector

conn = snowflake.connector.connect(
	account=${JSON.stringify(account)},
	user=${JSON.stringify(user)},
	password=${JSON.stringify(token)},
	warehouse=${JSON.stringify(warehouse)},
	database=${JSON.stringify(database)},
	schema=${JSON.stringify(schema)}
)
%connection_show conn
`;
	}
}

/**
 * Python Snowflake driver using Default Connection (connections.toml) authentication.
 *
 * This authentication method uses a named connection defined in the user's
 * connections.toml file. The file is typically located at:
 * - ~/.snowflake/connections.toml
 * - ~/Library/Application Support/snowflake/connections.toml (macOS)
 * - %USERPROFILE%\AppData\Local\snowflake\connections.toml (Windows)
 *
 * Required parameters:
 * - connection_name: The name of the connection defined in connections.toml
 */
export class PythonSnowflakeDefaultConnectionDriver extends PythonSnowflakeDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		this.loadIcon(context);
	}

	driverId: string = 'py-snowflake-default';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Snowflake',
		description: 'Default Connection (connections.toml)',
		inputs: [
			{
				'id': 'connection_name',
				'label': 'Connection Name',
				'type': 'string',
				'value': 'default'
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const connectionName = inputs.find(input => input.id === 'connection_name')?.value ?? 'default';

		return `import snowflake.connector

conn = snowflake.connector.connect(
	connection_name=${JSON.stringify(connectionName)}
)
%connection_show conn
`;
	}
}
