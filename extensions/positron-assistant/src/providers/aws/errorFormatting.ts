/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AwsSdkCredentialsFeatures } from '@aws-sdk/types';
import { PROVIDER_METADATA } from '../../providerMetadata.js';

// URL to documentation on required AWS permissions for Bedrock - used in permission error messages
const AWS_PERMISSIONS_DOC_URL = 'https://positron.posit.co/redirect/aws-bedrock-iam-permissions';

// Setting ID for the Amazon Bedrock provider variables - used in settings links in error messages.
// This is always defined on the amazonBedrock entry in PROVIDER_METADATA.
const BEDROCK_PROVIDER_SETTING_NAME = PROVIDER_METADATA.amazonBedrock.providerVariablesSettingName!;

function createSettingsUri(
	settingId: string
): string {
	const settingsArg = encodeURIComponent(JSON.stringify([settingId]));
	return `command:workbench.action.openSettings?${settingsArg}`;
}

/**
 * Converts AWS SDK credential source features to a human-readable string.
 * @param source The credential source features from AWS SDK
 * @param isManagedCredential Whether the credentials are managed credentials (detected by caller)
 * @returns A human-readable description of the credential type
 */
export function getCredentialTypeDescription(source?: AwsSdkCredentialsFeatures, isManagedCredential?: boolean): string | undefined {
	if (!source) {
		return undefined;
	}

	// Check in priority order (most specific first)
	if (source.CREDENTIALS_ENV_VARS) {
		return 'environment variables';
	} else if (source.CREDENTIALS_SSO || source.CREDENTIALS_SSO_LEGACY) {
		return 'SSO';
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
	} else if (source.CREDENTIALS_PROFILE_STS_WEB_ID_TOKEN || source.CREDENTIALS_ENV_VARS_STS_WEB_ID_TOKEN) {
		// Managed credentials can come from either profile or environment variable sources
		if (isManagedCredential) {
			return 'managed credentials';
		}
		return 'web identity token';
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
	 * @param params.isManagedCredential - Whether the credentials are managed credentials
	 * @returns Formatted error message with markdown
	 */
	authenticationError(params: {
		provider: string;
		profile?: string;
		region?: string;
		credentialSource?: AwsSdkCredentialsFeatures;
		isManagedCredential?: boolean;
	}): string {
		const profileContext = params.profile
			? ` for profile '${params.profile}'`
			: '';
		const region = params.region || 'us-east-1';
		const regionContext = ` in region '${region}'`;

		const credentialTypeDesc = getCredentialTypeDescription(params.credentialSource, params.isManagedCredential);
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
			awsArgs += ` --region ${region}`;
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
			createSettingsUri(BEDROCK_PROVIDER_SETTING_NAME)
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
	 * @param params.isManagedCredential - Whether the credentials are managed credentials
	 * @returns Formatted error message with markdown
	 */
	permissionError(params: {
		provider: string;
		profile?: string;
		region?: string;
		credentialSource?: AwsSdkCredentialsFeatures;
		isManagedCredential?: boolean;
	}): string {
		const profileContext = params.profile
			? ` for profile '${params.profile}'`
			: '';
		const region = params.region || 'us-east-1';
		const regionContext = ` in region '${region}'`;

		const credentialTypeDesc = getCredentialTypeDescription(params.credentialSource, params.isManagedCredential);
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
			createSettingsUri(BEDROCK_PROVIDER_SETTING_NAME),
			AWS_PERMISSIONS_DOC_URL
		);
	},
};
