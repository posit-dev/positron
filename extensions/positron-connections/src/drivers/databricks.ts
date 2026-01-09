/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import path = require('path');
import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Base class for Python Databricks drivers.
 * Provides common functionality for executing Python code via Positron.
 */
class PythonDatabricksDriverBase implements positron.ConnectionsDriver {
	driverId: string = 'py-databricks';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Databricks',
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

/**
 * Python Databricks driver using Personal Access Token (PAT) authentication.
 *
 * This is the simplest authentication method, using a personal access token
 * generated from the Databricks workspace.
 *
 * Required parameters:
 * - server_hostname: The Databricks workspace hostname
 * - http_path: The HTTP path for the SQL warehouse or cluster
 * - access_token: Personal access token for authentication
 */
export class PythonDatabricksPATDriver extends PythonDatabricksDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'databricks.svg');
		try {
			const iconData = readFileSync(iconPath, 'base64');
			this.metadata.base64EncodedIconSvg = iconData;
		} catch {
			// Icon file may not exist yet, continue without it
		}
	}

	driverId: string = 'py-databricks-pat';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Databricks',
		description: 'Personal Access Token',
		inputs: [
			{
				'id': 'server_hostname',
				'label': 'Server Hostname',
				'type': 'string',
				'value': '<workspace>.cloud.databricks.com'
			},
			{
				'id': 'http_path',
				'label': 'HTTP Path',
				'type': 'string',
				'value': '/sql/1.0/warehouses/<warehouse-id>'
			},
			{
				'id': 'access_token',
				'label': 'Access Token',
				'type': 'string',
				'value': ''
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const serverHostname = inputs.find(input => input.id === 'server_hostname')?.value ?? '';
		const httpPath = inputs.find(input => input.id === 'http_path')?.value ?? '';
		const accessToken = inputs.find(input => input.id === 'access_token')?.value ?? '';

		return `from databricks import sql

conn = sql.connect(
	server_hostname=${JSON.stringify(serverHostname)},
	http_path=${JSON.stringify(httpPath)},
	access_token=${JSON.stringify(accessToken)}
)
%connection_show conn
`;
	}
}

/**
 * Python Databricks driver using OAuth Machine-to-Machine (M2M) authentication.
 *
 * This authentication method uses a service principal with an OAuth secret
 * for automated/programmatic access without user interaction.
 *
 * Required parameters:
 * - server_hostname: The Databricks workspace hostname
 * - http_path: The HTTP path for the SQL warehouse or cluster
 * - client_id: The service principal's application (client) ID
 * - client_secret: The OAuth secret for the service principal
 */
export class PythonDatabricksM2MDriver extends PythonDatabricksDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'databricks.svg');
		try {
			const iconData = readFileSync(iconPath, 'base64');
			this.metadata.base64EncodedIconSvg = iconData;
		} catch {
			// Icon file may not exist yet, continue without it
		}
	}

	driverId: string = 'py-databricks-m2m';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Databricks',
		description: 'OAuth Machine-to-Machine (M2M)',
		inputs: [
			{
				'id': 'server_hostname',
				'label': 'Server Hostname',
				'type': 'string',
				'value': '<workspace>.cloud.databricks.com'
			},
			{
				'id': 'http_path',
				'label': 'HTTP Path',
				'type': 'string',
				'value': '/sql/1.0/warehouses/<warehouse-id>'
			},
			{
				'id': 'client_id',
				'label': 'Client ID',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'client_secret',
				'label': 'Client Secret',
				'type': 'string',
				'value': ''
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const serverHostname = inputs.find(input => input.id === 'server_hostname')?.value ?? '';
		const httpPath = inputs.find(input => input.id === 'http_path')?.value ?? '';
		const clientId = inputs.find(input => input.id === 'client_id')?.value ?? '';
		const clientSecret = inputs.find(input => input.id === 'client_secret')?.value ?? '';

		return `from databricks.sdk.core import Config, oauth_service_principal
from databricks import sql

def credential_provider():
	config = Config(
		host=${JSON.stringify('https://' + serverHostname)},
		client_id=${JSON.stringify(clientId)},
		client_secret=${JSON.stringify(clientSecret)}
	)
	return oauth_service_principal(config)

conn = sql.connect(
	server_hostname=${JSON.stringify(serverHostname)},
	http_path=${JSON.stringify(httpPath)},
	credentials_provider=credential_provider
)
%connection_show conn
`;
	}
}

/**
 * Python Databricks driver using OAuth User-to-Machine (U2M) authentication.
 *
 * This authentication method triggers an interactive browser-based login flow
 * for the user to authenticate with their Databricks account.
 *
 * Required parameters:
 * - server_hostname: The Databricks workspace hostname
 * - http_path: The HTTP path for the SQL warehouse or cluster
 */
export class PythonDatabricksU2MDriver extends PythonDatabricksDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'databricks.svg');
		try {
			const iconData = readFileSync(iconPath, 'base64');
			this.metadata.base64EncodedIconSvg = iconData;
		} catch {
			// Icon file may not exist yet, continue without it
		}
	}

	driverId: string = 'py-databricks-u2m';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Databricks',
		description: 'OAuth User-to-Machine (U2M)',
		inputs: [
			{
				'id': 'server_hostname',
				'label': 'Server Hostname',
				'type': 'string',
				'value': '<workspace>.cloud.databricks.com'
			},
			{
				'id': 'http_path',
				'label': 'HTTP Path',
				'type': 'string',
				'value': '/sql/1.0/warehouses/<warehouse-id>'
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const serverHostname = inputs.find(input => input.id === 'server_hostname')?.value ?? '';
		const httpPath = inputs.find(input => input.id === 'http_path')?.value ?? '';

		return `from databricks import sql

conn = sql.connect(
	server_hostname=${JSON.stringify(serverHostname)},
	http_path=${JSON.stringify(httpPath)},
	auth_type="databricks-oauth"
)
%connection_show conn
`;
	}
}
