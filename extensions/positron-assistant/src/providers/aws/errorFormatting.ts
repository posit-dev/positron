/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ErrorContext } from '../base/errorContext';

export { ErrorContext };

/**
 * Creates a markdown command link that opens settings to a specific section.
 *
 * @param linkText - The text to display for the link
 * @param settingId - The ID of the setting to open (e.g., 'positron.assistant.providerVariables.bedrock')
 * @returns A markdown-formatted command link
 *
 * @example
 * ```typescript
 * createSettingsLink('configure credentials', 'positron.assistant.providerVariables.bedrock')
 * // Returns: '[configure credentials](command:workbench.action.openSettings?%5B%22positron.assistant.providerVariables.bedrock%22%5D)'
 * ```
 */
export function createSettingsLink(
	linkText: string,
	settingId: string
): string {
	const settingsArg = encodeURIComponent(JSON.stringify([settingId]));
	return `[${linkText}](command:workbench.action.openSettings?${settingsArg})`;
}

/**
 * Creates a markdown command link that opens a terminal.
 *
 * @param linkText - The text to display for the link
 * @returns A markdown-formatted command link
 *
 * @example
 * ```typescript
 * createTerminalCommandLink('open a terminal')
 * // Returns: '[open a terminal](command:workbench.action.terminal.new)'
 * ```
 */
export function createTerminalCommandLink(
	linkText: string
): string {
	return `[${linkText}](command:workbench.action.terminal.new)`;
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
	 * @param params.settingId - Setting ID to open in settings
	 * @param params.setupInstructions - Instructions for setting up credentials
	 * @returns Formatted error message with markdown
	 *
	 * @example
	 * ```typescript
	 * ErrorTemplates.authenticationError({
	 *   provider: 'Amazon Bedrock',
	 *   profile: 'default',
	 *   region: 'us-east-1',
	 *   settingId: 'positron.assistant.providerVariables.bedrock',
	 *   setupInstructions: 'Set up credentials by running `aws configure` or `aws sso login`.'
	 * })
	 * ```
	 */
	authenticationError(params: {
		provider: string;
		profile?: string;
		region?: string;
		settingId: string;
		setupInstructions: string;
	}): string {
		const profileContext = params.profile
			? ` for profile '${params.profile}'`
			: '';
		const regionContext = params.region
			? ` in region '${params.region}'`
			: '';

		return vscode.l10n.t(
			'{0} authentication failed{1}{2}.\n\n' +
			'{3}\n\n' +
			'You can {4} in Settings > Positron > Assistant > Provider Variables, or {5}.',
			params.provider,
			profileContext,
			regionContext,
			params.setupInstructions,
			createSettingsLink('configure credentials', params.settingId),
			createTerminalCommandLink('open a terminal')
		);
	},

	/**
	 * Template for IAM/permission errors.
	 *
	 * @param params - Template parameters
	 * @param params.provider - Provider name (e.g., 'Amazon Bedrock')
	 * @param params.profile - Optional profile name (for AWS)
	 * @param params.region - Optional region (for AWS)
	 * @param params.settingId - Setting ID to open in settings
	 * @param params.documentationUrl - URL to permissions documentation
	 * @returns Formatted error message with markdown
	 *
	 * @example
	 * ```typescript
	 * ErrorTemplates.permissionError({
	 *   provider: 'Amazon Bedrock',
	 *   profile: 'default',
	 *   region: 'us-east-1',
	 *   settingId: 'positron.assistant.providerVariables.bedrock',
	 *   documentationUrl: 'https://docs.posit.co/ide/server-pro/admin/authenticating_users/aws_credentials.html#amazon-bedrock-permissions'
	 * })
	 * ```
	 */
	permissionError(params: {
		provider: string;
		profile?: string;
		region?: string;
		settingId: string;
		documentationUrl: string;
	}): string {
		const profileContext = params.profile
			? ` for profile '${params.profile}'`
			: '';
		const regionContext = params.region
			? ` in region '${params.region}'`
			: '';

		return vscode.l10n.t(
			'{0} authorization failed{1}{2}.\n\n' +
			'Your AWS IAM role or user does not have the required Bedrock permissions. ' +
			'See the [required permissions documentation]({3}) for details.\n\n' +
			'You can {4} in Settings, or contact your administrator to grant the necessary permissions.',
			params.provider,
			profileContext,
			regionContext,
			params.documentationUrl,
			createSettingsLink('configure the profile', params.settingId)
		);
	},

	/**
	 * Template for rate limit errors.
	 *
	 * @param params - Template parameters
	 * @param params.provider - Provider name
	 * @param params.retryAfter - Optional seconds until retry is allowed
	 * @returns Formatted error message with markdown
	 *
	 * @example
	 * ```typescript
	 * ErrorTemplates.rateLimitError({
	 *   provider: 'OpenAI',
	 *   retryAfter: 60
	 * })
	 * ```
	 */
	rateLimitError(params: {
		provider: string;
		retryAfter?: number;
	}): string {
		const retryMessage = params.retryAfter
			? vscode.l10n.t('Try again in {0} seconds.', params.retryAfter)
			: vscode.l10n.t('Please try again in a few moments.');

		return vscode.l10n.t(
			'{0} rate limit exceeded.\n\n{1}',
			params.provider,
			retryMessage
		);
	},

	/**
	 * Template for network/connection errors.
	 *
	 * @param params - Template parameters
	 * @param params.provider - Provider name
	 * @param params.endpoint - Optional endpoint URL that failed
	 * @returns Formatted error message with markdown
	 *
	 * @example
	 * ```typescript
	 * ErrorTemplates.connectionError({
	 *   provider: 'OpenAI',
	 *   endpoint: 'https://api.openai.com/v1/chat/completions'
	 * })
	 * ```
	 */
	connectionError(params: {
		provider: string;
		endpoint?: string;
	}): string {
		const endpointInfo = params.endpoint
			? vscode.l10n.t(' to {0}', params.endpoint)
			: '';

		return vscode.l10n.t(
			'Failed to connect to {0}{1}.\n\n' +
			'Please check your internet connection and try again.',
			params.provider,
			endpointInfo
		);
	}
};
