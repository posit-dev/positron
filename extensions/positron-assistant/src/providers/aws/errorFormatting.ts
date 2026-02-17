/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ErrorContext } from '../base/errorContext';

export { ErrorContext };

// URL to documentation on required AWS permissions for Bedrock - used in permission error messages
const AWS_PERMISSIONS_DOC_URL = 'https://docs.posit.co/ide/server-pro/admin/authenticating_users/aws_credentials.html#amazon-bedrock-permissions';
// Setting ID for AWS provider variables - used in settings links in error messages
const AWS_PROVIDER_SETTING_ID = 'positron.assistant.providerVariables.bedrock';

function createSettingsUri(
	settingId: string
): string {
	const settingsArg = encodeURIComponent(JSON.stringify([settingId]));
	return `command:workbench.action.openSettings?${settingsArg}`;
}

/**
 * Standard error message templates with markdown formatting.
 * These templates provide consistent, well-formatted error messages across all providers.
 */
export const ErrorTemplates = {
	/**
	 * Template for authentication/credential errors.
	 *
	 * @param params - Template parameters
	 * @param params.provider - Provider name (e.g., 'Amazon Bedrock', 'OpenAI')
	 * @param params.profile - Optional profile name (for AWS)
	 * @param params.region - Optional region (for AWS)
	 * @param params.setupInstructions - Instructions for setting up credentials
	 * @returns Formatted error message with markdown
	 */
	authenticationError(params: {
		provider: string;
		profile?: string;
		region?: string;
	}): string {
		const profileContext = params.profile
			? ` for profile '${params.profile}'`
			: '';
		const regionContext = params.region
			? ` in region '${params.region}'`
			: '';

		let awsArgs = '';
		if (params.profile) {
			awsArgs += ` --profile ${params.profile}`;
		}
		if (params.region) {
			awsArgs += ` --region ${params.region}`;
		}

		return vscode.l10n.t(
			'{0} authentication failed{1}{2}.\n\n' +
			'To login, [open a terminal](command:workbench.action.terminal.new) and run `aws sso login {3}`.\n\n' +
			'You can also [choose a different profile or region]({4}) in Settings.',
			params.provider,
			profileContext,
			regionContext,
			awsArgs,
			createSettingsUri(AWS_PROVIDER_SETTING_ID)
		);
	},

	/**
	 * Template for IAM/permission errors.
	 *
	 * @param params - Template parameters
	 * @param params.provider - Provider name (e.g., 'Amazon Bedrock')
	 * @param params.profile - Optional profile name (for AWS)
	 * @param params.region - Optional region (for AWS)
	 * @returns Formatted error message with markdown
	 */
	permissionError(params: {
		provider: string;
		profile?: string;
		region?: string;
	}): string {
		const profileContext = params.profile
			? ` for profile '${params.profile}'`
			: '';
		const regionContext = params.region
			? ` in region '${params.region}'`
			: '';

		return vscode.l10n.t(
			'{0} authorization failed{1}{2}.\n\n' +
			'Your AWS IAM role or user does not have the required Bedrock permissions. \n\n' +
			'You can [choose a different profile or region]({3}) in Settings, or contact your administrator to grant the necessary permissions. See the [required permissions documentation]({4}) for details.',
			params.provider,
			profileContext,
			regionContext,
			createSettingsUri(AWS_PROVIDER_SETTING_ID),
			AWS_PERMISSIONS_DOC_URL
		);
	},
};
