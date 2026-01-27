/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import path = require('path');
import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Base class for Python BigQuery drivers.
 * Provides common functionality for executing Python code via Positron.
 */
class PythonBigQueryDriverBase implements positron.ConnectionsDriver {
	driverId: string = 'py-bigquery';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'BigQuery',
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
 * Python BigQuery driver using Application Default Credentials.
 *
 * This is the simplest authentication method that works automatically in GCP
 * environments (Compute Engine, Cloud Run, etc.) or locally when configured
 * with `gcloud auth application-default login`.
 *
 * Required parameters:
 * - project: The Google Cloud project ID
 */
export class PythonBigQueryDefaultCredentialsDriver extends PythonBigQueryDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'bigquery.svg');
		try {
			const iconData = readFileSync(iconPath, 'base64');
			this.metadata.base64EncodedIconSvg = iconData;
		} catch {
			// Icon file may not exist yet, continue without it
		}
	}

	driverId: string = 'py-bigquery-default';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'BigQuery',
		description: 'Application Default Credentials',
		inputs: [
			{
				'id': 'project',
				'label': 'Project ID',
				'type': 'string',
				'value': '<project-id>'
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const project = inputs.find(input => input.id === 'project')?.value ?? '';

		return `from google.cloud import bigquery

# To configure credentials locally, run: gcloud auth application-default login
# See: https://cloud.google.com/docs/authentication/provide-credentials-adc
conn = bigquery.Client(project=${JSON.stringify(project)})
%connection_show conn
`;
	}
}

/**
 * Python BigQuery driver using Service Account authentication.
 *
 * This authentication method uses a service account JSON keyfile for
 * authentication. This is useful for applications running outside of GCP.
 *
 * Required parameters:
 * - project: The Google Cloud project ID
 * - keyfile_path: Path to the service account JSON keyfile
 */
export class PythonBigQueryServiceAccountDriver extends PythonBigQueryDriverBase implements positron.ConnectionsDriver {

	constructor(context: vscode.ExtensionContext) {
		super();
		const iconPath = path.join(context.extensionPath, 'media', 'logo', 'bigquery.svg');
		try {
			const iconData = readFileSync(iconPath, 'base64');
			this.metadata.base64EncodedIconSvg = iconData;
		} catch {
			// Icon file may not exist yet, continue without it
		}
	}

	driverId: string = 'py-bigquery-service-account';
	metadata: positron.ConnectionsDriverMetadata = {
		languageId: 'python',
		name: 'BigQuery',
		description: 'Service Account',
		inputs: [
			{
				'id': 'project',
				'label': 'Project ID',
				'type': 'string',
				'value': '<project-id>'
			},
			{
				'id': 'keyfile_path',
				'label': 'Service Account Keyfile Path',
				'type': 'string',
				'value': '/path/to/keyfile.json'
			},
		]
	};

	generateCode(inputs: positron.ConnectionsInput[]) {
		const project = inputs.find(input => input.id === 'project')?.value ?? '';
		const keyfilePath = inputs.find(input => input.id === 'keyfile_path')?.value ?? '';

		return `from google.cloud import bigquery
from google.oauth2 import service_account

credentials = service_account.Credentials.from_service_account_file(${JSON.stringify(keyfilePath)})
conn = bigquery.Client(credentials=credentials, project=${JSON.stringify(project)})
%connection_show conn
`;
	}
}
