/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ErrorContext } from '../base/errorContext';
import { AwsSdkCredentialsFeatures } from '@aws-sdk/types';

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
 * Converts AWS SDK credential source features to a human-readable string.
 * @param source The credential source features from AWS SDK
 * @returns A human-readable description of the credential type
 */
function getCredentialTypeDescription(source?: AwsSdkCredentialsFeatures): string | undefined {
	if (!source) {
		return undefined;
	}

	// Check in priority order (most specific first)
	if (source.CREDENTIALS_ENV_VARS) {
		return 'environment variables';
	} else if (source.CREDENTIALS_SSO) {
		return 'SSO';
	} else if (source.CREDENTIALS_SSO_LEGACY) {
		return 'SSO (legacy)';
	} else if (source.CREDENTIALS_IMDS) {
		return 'EC2 instance metadata';
	} else if (source.CREDENTIALS_PROFILE_PROCESS) {
		return 'credential process';
	} else if (source.CREDENTIALS_PROCESS) {
		return 'credential process';
	} else if (source.CREDENTIALS_PROFILE_SSO) {
		return 'SSO profile';
	} else if (source.CREDENTIALS_PROFILE) {
		return 'shared credentials file';
	} else if (source.CREDENTIALS_PROFILE_STS_WEB_ID_TOKEN) {
		return 'web identity token';
	} else if (source.CREDENTIALS_ENV_VARS_STS_WEB_ID_TOKEN) {
		return 'web identity token (env)';
	}

	return undefined;
}

/**
 * Checks if the credential source uses SSO authentication.
 * @param source The credential source features from AWS SDK
 * @returns True if SSO credentials are used
 */
function isSSOCredentials(source?: AwsSdkCredentialsFeatures): boolean {
	if (!source) {
		return false;
	}
	return !!(source.CREDENTIALS_SSO || source.CREDENTIALS_SSO_LEGACY || source.CREDENTIALS_PROFILE_SSO);
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
	 * @param params.credentialSource - Optional credential source features from AWS SDK
	 * @param params.setupInstructions - Instructions for setting up credentials
	 * @returns Formatted error message with markdown
	 */
	authenticationError(params: {
		provider: string;
		profile?: string;
		region?: string;
		credentialSource?: AwsSdkCredentialsFeatures;
	}): string {
		const profileContext = params.profile
			? ` for profile '${params.profile}'`
			: '';
		const regionContext = params.region
			? ` in region '${params.region}'`
			: '';

		const credentialTypeDesc = getCredentialTypeDescription(params.credentialSource);
		const credentialContext = credentialTypeDesc
			? ` using ${credentialTypeDesc}`
			: '';

		// Build credential-type-specific login guidance
		let loginGuidance = '';

		if (isSSOCredentials(params.credentialSource)) {
			// SSO credentials: suggest aws sso login
			let awsArgs = '';
			if (params.profile) {
				awsArgs += ` --profile ${params.profile}`;
			}
			if (params.region) {
				awsArgs += ` --region ${params.region}`;
			}
			loginGuidance = vscode.l10n.t(
				'To login, [open a terminal](command:workbench.action.terminal.new) and run `aws sso login {0}`.\n\n',
				awsArgs
			);
		} else if (params.credentialSource?.CREDENTIALS_ENV_VARS) {
			// Environment variables: suggest checking env vars
			loginGuidance = vscode.l10n.t(
				'Please verify that `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set correctly.\n\n'
			);
		} else if (params.credentialSource?.CREDENTIALS_PROFILE) {
			// Shared credentials: suggest checking credentials file
			loginGuidance = vscode.l10n.t(
				'Please check your credentials in `~/.aws/credentials` for profile \'{0}\'.\n\n',
				params.profile || 'default'
			);
		} else if (params.credentialSource?.CREDENTIALS_IMDS) {
			// EC2 instance metadata: suggest checking IAM role
			loginGuidance = vscode.l10n.t(
				'Please ensure the EC2 instance has a valid IAM role attached with the necessary permissions.\n\n'
			);
		} else if (params.credentialSource?.CREDENTIALS_PROFILE_PROCESS || params.credentialSource?.CREDENTIALS_PROCESS) {
			// Credential process: suggest checking config
			loginGuidance = vscode.l10n.t(
				'Please verify your credential process configuration in `~/.aws/config`.\n\n'
			);
		} else {
			// Unknown or default: generic message without specific login command
			loginGuidance = vscode.l10n.t(
				'Please verify your AWS credentials are valid and properly configured.\n\n'
			);
		}

		return vscode.l10n.t(
			'{0} authentication failed{1}{2}{3}.\n\n' +
			'{4}' +
			'You can also [configure a different profile or region]({5}) in Settings.',
			params.provider,
			profileContext,
			regionContext,
			credentialContext,
			loginGuidance,
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
	 * @param params.credentialSource - Optional credential source features from AWS SDK
	 * @returns Formatted error message with markdown
	 */
	permissionError(params: {
		provider: string;
		profile?: string;
		region?: string;
		credentialSource?: AwsSdkCredentialsFeatures;
	}): string {
		const profileContext = params.profile
			? ` for profile '${params.profile}'`
			: '';
		const regionContext = params.region
			? ` in region '${params.region}'`
			: '';

		const credentialTypeDesc = getCredentialTypeDescription(params.credentialSource);
		const credentialContext = credentialTypeDesc
			? ` using ${credentialTypeDesc}`
			: '';

		return vscode.l10n.t(
			'{0} authorization failed{1}{2}{3}.\n\n' +
			'Your AWS IAM role or user does not have the required Bedrock permissions. \n\n' +
			'You can [configure a different profile or region]({4}) in Settings, or contact your administrator to grant the necessary permissions. See the [required permissions documentation]({5}) for details.',
			params.provider,
			profileContext,
			regionContext,
			credentialContext,
			createSettingsUri(AWS_PROVIDER_SETTING_ID),
			AWS_PERMISSIONS_DOC_URL
		);
	},
};
