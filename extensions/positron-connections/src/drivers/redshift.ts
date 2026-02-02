/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import path = require('path');
import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Base class for Python Redshift drivers.
 * Provides common functionality for executing Python code via Positron.
 *
 * @see https://docs.aws.amazon.com/redshift/latest/mgmt/python-redshift-driver.html
 */
class PythonRedshiftDriverBase implements positron.ConnectionsDriver {
	driverId: string = 'py-redshift';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Redshift',
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
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'redshift.svg');
		try {
			const iconData = readFileSync(iconPath, 'base64');
			this.metadata.base64EncodedIconSvg = iconData;
		} catch {
			// Icon file may not exist yet, continue without it
		}
	}
}

/**
 * Python Redshift driver using standard username/password authentication.
 *
 * This is the simplest authentication method using database credentials.
 *
 * Required parameters:
 * - host: The Redshift cluster endpoint
 * - database: The database name
 * - user: Database username
 * - password: Database password
 * - port: The port number (default: 5439)
 *
 * @see https://docs.aws.amazon.com/redshift/latest/mgmt/python-redshift-driver.html
 */
export class PythonRedshiftBasicDriver extends PythonRedshiftDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		this.loadIcon(context);
	}

	driverId: string = 'py-redshift-basic';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Redshift',
		description: 'Username/Password',
		inputs: [
			{
				'id': 'host',
				'label': 'Host',
				'type': 'string',
				'value': '<cluster>.us-east-1.redshift.amazonaws.com'
			},
			{
				'id': 'database',
				'label': 'Database',
				'type': 'string',
				'value': 'dev'
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
				'id': 'port',
				'label': 'Port',
				'type': 'number',
				'value': '5439'
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const host = inputs.find(input => input.id === 'host')?.value ?? '';
		const database = inputs.find(input => input.id === 'database')?.value ?? '';
		const user = inputs.find(input => input.id === 'user')?.value ?? '';
		const password = inputs.find(input => input.id === 'password')?.value ?? '';
		const port = inputs.find(input => input.id === 'port')?.value ?? '5439';

		return `import redshift_connector

conn = redshift_connector.connect(
	host=${JSON.stringify(host)},
	database=${JSON.stringify(database)},
	user=${JSON.stringify(user)},
	password=${JSON.stringify(password)},
	port=${port}
)
%connection_show conn
`;
	}
}

/**
 * Python Redshift driver using IAM authentication with AWS Profile.
 *
 * This authentication method uses AWS IAM credentials from a configured profile.
 *
 * Required parameters:
 * - host: The Redshift cluster endpoint
 * - database: The database name
 * - cluster_identifier: The Redshift cluster identifier
 * - profile: AWS profile name (optional, uses default if not specified)
 *
 * @see https://docs.aws.amazon.com/redshift/latest/mgmt/python-redshift-driver.html
 * @see https://docs.aws.amazon.com/redshift/latest/mgmt/redshift-iam-authentication-access-control.html
 */
export class PythonRedshiftIAMDriver extends PythonRedshiftDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		this.loadIcon(context);
	}

	driverId: string = 'py-redshift-iam';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Redshift',
		description: 'IAM (AWS Profile)',
		inputs: [
			{
				'id': 'host',
				'label': 'Host',
				'type': 'string',
				'value': '<cluster>.us-east-1.redshift.amazonaws.com'
			},
			{
				'id': 'database',
				'label': 'Database',
				'type': 'string',
				'value': 'dev'
			},
			{
				'id': 'port',
				'label': 'Port',
				'type': 'number',
				'value': '5439'
			},
			{
				'id': 'cluster_identifier',
				'label': 'Cluster Identifier',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'profile',
				'label': 'AWS Profile',
				'type': 'string',
				'value': 'default'
			},
			{
				'id': 'db_user',
				'label': 'DB User',
				'type': 'string',
				'value': ''
			}
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const host = inputs.find(input => input.id === 'host')?.value ?? '';
		const database = inputs.find(input => input.id === 'database')?.value ?? '';
		const port = inputs.find(input => input.id === 'port')?.value ?? '5439';
		const clusterIdentifier = inputs.find(input => input.id === 'cluster_identifier')?.value ?? '';
		const profile = inputs.find(input => input.id === 'profile')?.value ?? '';
		const dbUser = inputs.find(input => input.id === 'db_user')?.value ?? '';

		// If profile is provided, include it; otherwise omit the parameter
		const profileParam = profile
			? `\n\tprofile=${JSON.stringify(profile)},`
			: '';

		// If db_user is provided, include it; otherwise omit the parameter
		const dbUserParam = dbUser
			? `\n\tdb_user=${JSON.stringify(dbUser)}`
			: '';

		return `import redshift_connector

conn = redshift_connector.connect(
	iam=True,
	host=${JSON.stringify(host)},
	database=${JSON.stringify(database)},
	port=${port},
	cluster_identifier=${JSON.stringify(clusterIdentifier)},${profileParam}${dbUserParam}
)
%connection_show conn
`;
	}
}

/**
 * Python Redshift driver using Okta authentication.
 *
 * This authentication method uses Okta for federated identity authentication.
 *
 * Required parameters:
 * - host: The Redshift cluster endpoint
 * - database: The database name
 * - cluster_identifier: The Redshift cluster identifier
 * - user: Okta username
 * - password: Okta password
 * - idp_host: The Okta identity provider hostname
 * - app_id: Okta application ID
 * - app_name: Okta application name
 *
 * @see https://docs.aws.amazon.com/redshift/latest/mgmt/python-connect-identity-provider-plugins.html
 * @see https://aws.amazon.com/blogs/big-data/federate-amazon-redshift-access-with-okta-as-an-identity-provider/
 */
export class PythonRedshiftOktaDriver extends PythonRedshiftDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		this.loadIcon(context);
	}

	driverId: string = 'py-redshift-okta';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'Redshift',
		description: 'Okta',
		inputs: [
			{
				'id': 'host',
				'label': 'Host',
				'type': 'string',
				'value': '<cluster>.us-east-1.redshift.amazonaws.com'
			},
			{
				'id': 'database',
				'label': 'Database',
				'type': 'string',
				'value': 'dev'
			},
			{
				'id': 'port',
				'label': 'Port',
				'type': 'number',
				'value': '5439'
			},
			{
				'id': 'cluster_identifier',
				'label': 'Cluster Identifier',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'user',
				'label': 'User',
				'type': 'string',
				'value': 'user@okta.org'
			},
			{
				'id': 'password',
				'label': 'Password',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'idp_host',
				'label': 'IDP Host',
				'type': 'string',
				'value': 'company.okta.com'
			},
			{
				'id': 'app_id',
				'label': 'App ID',
				'type': 'string',
				'value': ''
			},
			{
				'id': 'app_name',
				'label': 'App Name',
				'type': 'string',
				'value': ''
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const host = inputs.find(input => input.id === 'host')?.value ?? '';
		const database = inputs.find(input => input.id === 'database')?.value ?? '';
		const port = inputs.find(input => input.id === 'port')?.value ?? '5439';
		const clusterIdentifier = inputs.find(input => input.id === 'cluster_identifier')?.value ?? '';
		const user = inputs.find(input => input.id === 'user')?.value ?? '';
		const password = inputs.find(input => input.id === 'password')?.value ?? '';
		const idpHost = inputs.find(input => input.id === 'idp_host')?.value ?? '';
		const appId = inputs.find(input => input.id === 'app_id')?.value ?? '';
		const appName = inputs.find(input => input.id === 'app_name')?.value ?? '';

		return `import redshift_connector

conn = redshift_connector.connect(
	iam=True,
	host=${JSON.stringify(host)},
	database=${JSON.stringify(database)},
	port=${port},
	cluster_identifier=${JSON.stringify(clusterIdentifier)},
	credentials_provider="OktaCredentialsProvider",
	user=${JSON.stringify(user)},
	password=${JSON.stringify(password)},
	idp_host=${JSON.stringify(idpHost)},
	app_id=${JSON.stringify(appId)},
	app_name=${JSON.stringify(appName)}
)
%connection_show conn
`;
	}
}
