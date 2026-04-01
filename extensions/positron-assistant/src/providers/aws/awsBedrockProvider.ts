/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createBedrockAnthropic, BedrockAnthropicProvider } from '@ai-sdk/amazon-bedrock/anthropic';
import { AttributedAwsCredentialIdentity, AwsCredentialIdentityProvider, AwsSdkCredentialsFeatures } from '@aws-sdk/types';
import {
	BedrockClient,
	FoundationModelSummary,
	InferenceProfileSummary,
	ListFoundationModelsCommand,
	ListInferenceProfilesCommand
} from '@aws-sdk/client-bedrock';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { getStoredModels, expandConfigToSource } from '../../config';
import { ModelConfig } from '../../configTypes.js';
import { DEFAULT_MAX_TOKEN_INPUT } from '../../constants';
import { AssistantError } from '../../errors';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers';
import { getAllModelDefinitions } from '../../modelDefinitions';
import { PositronAssistantApi } from '../../api';
import { ErrorTemplates, getCredentialTypeDescription } from './errorFormatting';
import { registerModelWithAPI } from '../../modelRegistration';
import { PROVIDER_METADATA } from '../../providerMetadata.js';
import { ErrorContext } from '../base/errorContext.js';

/**
 * AWS Bedrock model provider implementation.
 *
 * This provider integrates with Amazon Bedrock service for Claude and other supported models.
 * It includes:
 * - SSO login support for authentication
 * - Custom credential management using AWS SDK
 * - Inference profile support for automatic region routing
 * - Dynamic model listing from Bedrock API
 *
 * Note: AWS Bedrock extends VercelModelProvider to use the Vercel AI SDK for chat operations
 * while maintaining custom AWS SDK integration for authentication and model discovery.
 */
export class AWSModelProvider extends VercelModelProvider implements positron.ai.LanguageModelChatProvider {
	/**
	 * Bedrock client for API calls to list models and inference profiles.
	 */
	bedrockClient: BedrockClient;

	/**
	 * Available inference profiles for the authenticated user.
	 * Inference profiles enable automatic region routing and resource allocation.
	 */
	inferenceProfiles: InferenceProfileSummary[] = [];


	/**
	 * The preferred inference profile region.
	 * Derived from AWS_REGION or explicitly set via user setting.
	 */
	private _inferenceProfileRegion!: string;

	/**
	 * The last error encountered during model resolution.
	 * Used to manage re-authentication prompts.
	 */
	private _lastError?: Error;

	/**
	 * Promise that resolves to the AWS credential source features from the credential provider.
	 * Stored as a promise to avoid race conditions with async credential detection.
	 * Used to determine which credential type was used for enhanced error messages.
	 */
	private _credentialSourcePromise?: Promise<AwsSdkCredentialsFeatures | undefined>;

	/**
	 * Supported Bedrock model providers.
	 * Currently only Anthropic models are supported.
	 */
	static SUPPORTED_BEDROCK_PROVIDERS = ['Anthropic'];

	/**
	 * Legacy models that should be filtered out.
	 * These older model versions are superseded by newer releases.
	 */
	static LEGACY_MODELS_REGEX = [
		'.*anthropic\\.claude-3-opus.*',
		'.*anthropic\\.claude-3-5-sonnet.*',
	];

	/**
	 * Default token limits for AWS Bedrock models.
	 */
	static DEFAULT_MAX_TOKENS_INPUT = DEFAULT_MAX_TOKEN_INPUT;
	static DEFAULT_MAX_TOKENS_OUTPUT = 8192;

	/**
	 * Maps AWS region prefixes to Bedrock inference profile regions.
	 * Most regions use the same prefix, but some differ
	 */
	private static readonly REGION_PREFIX_MAP: Record<string, string> = {
		'ap': 'apac',
	};

	/**
	 * Derives the inference profile region from an AWS region.
	 * AWS regions follow pattern: {region}-{zone}-{number}
	 *
	 * @param awsRegion The AWS region (e.g., 'us-east-1', 'ap-southeast-1')
	 * @returns The inference profile region prefix (e.g., 'us', 'apac')
	 */
	static deriveInferenceProfileRegion(awsRegion: string): string {
		const prefix = awsRegion.split('-')[0];
		return this.REGION_PREFIX_MAP[prefix] ?? prefix;
	}

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.amazonBedrock,
		supportedOptions: ['toolCalls'],
		defaults: {
			name: 'Claude 4 Sonnet Bedrock',
			model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
			toolCalls: true,
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
	}

	/**
	 * Retrieves the credential source features from the AWS SDK credential chain.
	 * @param credentialProvider The AWS credential identity provider
	 * @returns The credential source features or undefined if not available
	 */
	private async getCredentialSource(
		credentialProvider: AwsCredentialIdentityProvider
	): Promise<AwsSdkCredentialsFeatures | undefined> {
		try {
			const credentials = await credentialProvider() as AttributedAwsCredentialIdentity;
			return credentials.$source;
		} catch (error) {
			// If we can't resolve credentials, return undefined
			return undefined;
		}
	}

	/**
	 * Initializes the AWS Bedrock provider with credentials and region settings.
	 */
	protected override initializeProvider() {
		// Create a credential provider that fetches fresh credentials
		// from the auth extension on each SDK request.
		const credentials: AwsCredentialIdentityProvider = async () => {
			const session = await vscode.authentication.getSession(
				'amazon-bedrock', [], { silent: true }
			);
			if (!session) {
				throw new Error('No AWS credentials available');
			}
			const creds = JSON.parse(session.accessToken);
			return {
				accessKeyId: creds.accessKeyId,
				secretAccessKey: creds.secretAccessKey,
				sessionToken: creds.sessionToken,
			};
		};

		// Get region/profile from the auth session for SDK client init.
		// These are resolved synchronously by the auth provider from
		// settings/env, so we read them via the same settings here.
		const providerVars = vscode.workspace
			.getConfiguration('authentication.aws')
			.get<{ AWS_PROFILE?: string; AWS_REGION?: string }>(
				'credentials', {}
			);
		const region = providerVars.AWS_REGION
			?? process.env.AWS_REGION ?? 'us-east-1';
		const profile = providerVars.AWS_PROFILE
			?? process.env.AWS_PROFILE;

		const inferenceProfileRegion = vscode.workspace
			.getConfiguration('authentication.aws')
			.get<string>('inferenceProfileRegion');

		if (inferenceProfileRegion) {
			this._inferenceProfileRegion = inferenceProfileRegion;
		} else {
			this._inferenceProfileRegion = AWSModelProvider.deriveInferenceProfileRegion(region);
		}

		// Detect and store credential source promise for error handling
		// Store as promise to avoid race conditions if errors occur before resolution
		this._credentialSourcePromise = this.getCredentialSource(credentials).then(credentialSource => {
			if (credentialSource) {
				const description = getCredentialTypeDescription(credentialSource);
				this.logger.debug(`AWS credentials loaded using ${description ?? 'unknown source'}.`);
			}
			return credentialSource;
		});

		this.logger.info(
			`Using AWS region: ${region}, profile: ${profile ?? '(not set, using default)'}, ` +
			`inference profile region: ${this._inferenceProfileRegion}`
		);

		// Initialize Vercel AI SDK providers for chat generation.
		// Use the Anthropic-specific provider for Anthropic models (native API
		// through InvokeModel for better feature compatibility) and the generic
		// Bedrock provider for all other models (Converse API).
		const bedrockAnthropicProvider = createBedrockAnthropic({
			region,
			credentialProvider: credentials
		});
		const bedrockProvider = createAmazonBedrock({
			region,
			credentialProvider: credentials
		});
		this.aiProvider = (id: string) => {
			if (id.includes('anthropic')) {
				return bedrockAnthropicProvider(id);
			}
			return bedrockProvider(id);
		};

		// Initialize Bedrock SDK client for model listing
		this.bedrockClient = new BedrockClient({
			...(profile && { profile }),
			region,
			credentials: credentials
		});
	}

	override async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<void> {
		// Only select Bedrock models support cache breakpoints
		const bedrockCacheBreakpoint = this.providerId === 'amazon-bedrock' &&
			!model.id.includes('anthropic.claude-3-5');

		// Provide the response using the base class implementation
		return super.provideVercelResponse(
			model,
			messages,
			options,
			progress,
			token,
			{ bedrockCacheBreakpoint }
		);
	}

	/**
	 * Parses Bedrock-specific errors and returns user-friendly messages.
	 * Handles SSO authentication errors with automatic login prompts.
	 *
	 * @param error The error object returned by Bedrock.
	 * @param context Optional context about where the error is being displayed
	 * @returns A user-friendly error message or undefined if not specifically handled.
	 */
	override async parseProviderError(error: any, context?: ErrorContext) {
		// Handle AI_APICallError which wraps AWS errors in responseBody
		let name = error?.name;
		let message = error?.message;
		const statusCode: number | undefined = ai.APICallError.isInstance(error) ? error.statusCode : undefined;

		// Check for AI API call errors (either via isInstance or by duck typing)
		if (ai.APICallError.isInstance(error) && error.responseBody) {
			try {
				const parsedBody = JSON.parse(error.responseBody);
				message = parsedBody.Message || parsedBody.message || message;

				// Extract error type from response headers
				if (error.responseHeaders?.['x-amzn-errortype']) {
					const errorType = error.responseHeaders['x-amzn-errortype'];
					// Extract the error name (e.g., "AccessDeniedException" from "AccessDeniedException:http://...")
					const errorNameMatch = errorType.match(/^([^:]+)/);
					if (errorNameMatch) {
						name = errorNameMatch[1];
					}
				}
			} catch (e) {
				// If we can't parse the response body, fall back to the original error
			}
		}

		// If not an AI_APICallError and not an Error instance, return undefined
		if (!ai.APICallError.isInstance(error) && !(error instanceof Error)) {
			return undefined;
		}

		if (!message) {
			return await super.parseProviderError(error, context);
		}

		// Get AWS profile and region for better error messages
		const profile = this.bedrockClient.config.profile || undefined;
		const region = (typeof this.bedrockClient.config.region === 'function'
			? await this.bedrockClient.config.region()
			: this.bedrockClient.config.region) || undefined;

		// Await credential source to avoid race condition
		const credentialSource = await this._credentialSourcePromise;

		// Determine if we're in a connection test (used for SSO login handling)
		const isConnectionTest = context?.isConnectionTest ?? false;

		// Handle IAM authorization errors
		if (name === 'AccessDeniedException' || name === 'UnauthorizedException' ||
			statusCode === 403 || message.includes('not authorized to perform')) {

			return ErrorTemplates.permissionError({
				provider: 'Amazon Bedrock',
				profile,
				region,
				credentialSource,

			});
		}

		// Handle AWS SSO credential errors
		if (name === 'CredentialsProviderError') {
			// This error occurs when the SSO refresh token is expired
			if (message.includes('aws sso login')) {
				const existingModels = getStoredModels(this._context);

				// Check if our model is already registered
				if (!existingModels.some(m => m.provider === this._config.provider)) {
					// The model is not yet registered, so just refresh without prompting
					if (await this.refreshCredentials(true)) {
						// If we're successful, return undefined to indicate no error
						return undefined;
					}
				} else {
					// The model has already been registered, so we can prompt the user to login
					const action = { title: vscode.l10n.t('Run in Terminal'), id: 'aws-sso-login' };

					vscode.window.showErrorMessage(`Amazon Bedrock: ${message}`, action).then(async selection => {
						if (selection?.id === action.id) {
							// User chose to login, so we need to refresh the credentials
							await this.refreshCredentials(isConnectionTest);
						}
					});

					if (isConnectionTest) {
						// We're in a connection test, so throw an AssistantError to avoid showing a message box
						// but that stops the model provider from being registered in core
						throw new AssistantError(message, false);
					} else {
						// We are in a chat response, so we should return an error to display in the chat pane
						const profileArg = profile ? ` --profile ${profile}` : '';
						const regionArg = region ? ` --region ${region}` : '';
						throw new Error(
							vscode.l10n.t(
								'AWS login required. Please run `aws sso login{0}{1}` in the terminal, and retry this request.',
								profileArg,
								regionArg,
							)
						);
					}
				}
			} else {
				// Generic credentials error - provide helpful context about which profile was used
				// The error template now handles credential-type-specific guidance
				return ErrorTemplates.authenticationError({
					provider: 'Amazon Bedrock',
					profile,
					region,
					credentialSource,

				});
			}
		}

		return vscode.l10n.t('Amazon Bedrock error: {0}', message);
	}

	/**
	 * Refreshes AWS SSO credentials by running the aws sso login command.
	 *
	 * @param reregister If true, re-register the model after successful login.
	 * @returns Promise that resolves to true if login was successful.
	 */
	private async refreshCredentials(reregister: boolean = false): Promise<boolean> {
		// Grab the profile & region to refresh from the Bedrock client config
		const profile = this.bedrockClient.config.profile;
		// Region may be an async function or a string, so handle both cases
		const region = typeof this.bedrockClient.config.region === 'function'
			? await this.bedrockClient.config.region()
			: this.bedrockClient.config.region;

		// Build the SSO login command, only including --profile if explicitly configured
		const profileArg = profile ? ` --profile ${profile}` : '';
		const ssoCommand = `aws sso login${profileArg} --region ${region}`;

		// Execute the AWS SSO login command as a native task
		const taskExecution = await vscode.tasks.executeTask(new vscode.Task(
			{ type: 'shell' },
			vscode.TaskScope.Workspace,
			'AWS SSO Login',
			'AWS',
			new vscode.ShellExecution(ssoCommand)
		));

		const result = new Promise<boolean>((resolve) => {
			const disposable = vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution === taskExecution) {
					const idx = this._context.subscriptions.indexOf(disposable);
					if (idx !== -1) {
						this._context.subscriptions.splice(idx, 1);
						disposable.dispose();
					}
					// Notify the user of the result
					const success = e.exitCode === 0 || e.exitCode === undefined;
					if (success) {
						// Success
						vscode.window.showInformationMessage(vscode.l10n.t('AWS login completed successfully'));
					} else {
						// Failure
						vscode.window.showErrorMessage(
							vscode.l10n.t('AWS login failed with exit code {0}', e.exitCode)
						);
					}

					// Open a URI to bring Positron to the foreground
					// This is a little sneaky, but works + no other native method
					const redirectUri = vscode.Uri.from({ scheme: vscode.env.uriScheme });
					vscode.env.openExternal(redirectUri);

					if (success && reregister) {
						// If we were in a connection test, re-run it now that we've logged in
						registerModelWithAPI(
							this._config,
							this._context,
							this
						).then(() => {
							positron.ai.addLanguageModelConfig(expandConfigToSource(this._config));
							PositronAssistantApi.get().notifySignIn(this._config.name);
						});
					}
					resolve(success);
				}
			});
			this._context.subscriptions.push(disposable);
		});
		return result;
	}

	/**
	 * Resolves the connection by fetching available models.
	 * The Vercel and Bedrock SDKs both use the node provider chain for credentials,
	 * so getting a model listing validates the credentials.
	 *
	 * @param token The cancellation token.
	 * @returns Error if connection failed, undefined if successful.
	 */
	override async resolveConnection(token: vscode.CancellationToken) {
		this.logger.debug('Resolving connection by fetching available models...');

		// Set context to indicate we're in a connection test (used for error handling)
		const connectionTestContext: ErrorContext = {
			isConnectionTest: true,
			isChat: false,
			isStartup: false
		};

		try {
			await this.resolveModels(token);
			this.checkError();
		} catch (error) {
			// Try to parse specific Bedrock errors
			// This way, we can handle SSO login errors specifically
			const parsedError = await this.parseProviderError(error, connectionTestContext);
			if (parsedError) {
				return new Error(parsedError);
			}
		}

		return undefined;
	}

	/**
	 * Resolves the available language models from Bedrock.
	 *
	 * @param token The cancellation token.
	 * @returns A promise that resolves to an array of language model descriptors.
	 */
	async resolveModels(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		this.logger.debug('Resolving models...');

		// First check for configured models
		const configuredModels = this.retrieveModelsFromConfig();
		if (configuredModels) {
			this.modelListing = configuredModels;
			return configuredModels;
		}

		// Otherwise, retrieve models from the Bedrock API
		const apiModels = await this.retrieveModelsFromApi(token);
		if (apiModels) {
			this.modelListing = apiModels;
			return apiModels;
		}

		return undefined;
	}

	/**
	 * Retrieves models from configuration.
	 *
	 * @returns The configured models or undefined if none.
	 */
	protected override retrieveModelsFromConfig() {
		const configuredModels = getAllModelDefinitions(this.providerId);
		if (configuredModels.length === 0) {
			return undefined;
		}

		this.logger.info(`Using ${configuredModels.length} configured models.`);

		const modelListing = configuredModels.map((modelDef) =>
			createModelInfo({
				id: modelDef.identifier,
				name: modelDef.name,
				family: 'Amazon Bedrock',
				version: '',
				provider: this.providerId,
				providerName: this.providerName,
				capabilities: this.capabilities,
				defaultMaxInput: modelDef.maxInputTokens ?? AWSModelProvider.DEFAULT_MAX_TOKENS_INPUT,
				defaultMaxOutput: modelDef.maxOutputTokens ?? AWSModelProvider.DEFAULT_MAX_TOKENS_OUTPUT
			})
		);

		return markDefaultModel(modelListing, this.providerId, this._config.model);
	}

	/**
	 * Retrieves models from the Bedrock API.
	 * Fetches foundation models and inference profiles, then filters for eligible models.
	 *
	 * @param token The cancellation token.
	 * @returns The models retrieved from the API or undefined if failed.
	 */
	protected override async retrieveModelsFromApi(
		token: vscode.CancellationToken
	) {
		try {
			const command = new ListFoundationModelsCommand();

			this.logger.info(
				`Fetching available Amazon Bedrock models for these providers: ${AWSModelProvider.SUPPORTED_BEDROCK_PROVIDERS.join(', ')}`
			);

			const response = await this.bedrockClient.send(command);
			const modelSummaries = response.modelSummaries;

			if (!modelSummaries || modelSummaries.length === 0) {
				this.logger.error('No Amazon Bedrock models available');
				return [];
			}
			this.logger.info(`Found ${modelSummaries.length} available models.`);

			// Fetch inference profiles
			this.logger.debug('Fetching available Amazon Bedrock inference profiles...');
			const inferenceResponse = await this.bedrockClient.send(new ListInferenceProfilesCommand());
			this.inferenceProfiles = inferenceResponse.inferenceProfileSummaries ?? [];

			if (this.inferenceProfiles.length === 0) {
				this.logger.error('No Amazon Bedrock inference profiles available');
				return [];
			}
			this.logger.debug(`Total inference profiles available: ${this.inferenceProfiles.length}`);

			// Filter for basic eligibility before creating model objects
			const filteredModelSummaries = this.filterModelSummaries(modelSummaries);
			this.logger.debug(
				`${filteredModelSummaries.length} models available (from ${modelSummaries.length} total) after removing ineligible models.`
			);

			// Convert eligible model summaries to LanguageModelChatInformation objects
			const models = filteredModelSummaries.map(m => {
				const modelId = this.findInferenceProfileForModel(m.modelArn, this.inferenceProfiles);
				const modelInfo = createModelInfo({
					id: modelId,
					name: m.modelName ?? modelId,
					family: 'Amazon Bedrock',
					version: '',
					provider: this.providerId,
					providerName: this.providerName,
					capabilities: this.capabilities,
					defaultMaxInput: AWSModelProvider.DEFAULT_MAX_TOKENS_INPUT,
					defaultMaxOutput: AWSModelProvider.DEFAULT_MAX_TOKENS_OUTPUT
				});
				return modelInfo;
			}).filter(m => {
				if (!m.id) {
					this.logger.debug(`Filtering out model without inference profile ARN: ${m.name}`);
					return false;
				}
				return true;
			});

			this.logger.debug(`Available models after processing: ${models.map(m => m.name).join(', ')}`);

			return markDefaultModel(models, this.providerId, this._config.model);
		} catch (error) {
			this.logger.warn(`Failed to fetch models from Bedrock API: ${error}`);
			this._lastError = error instanceof Error ? error : new Error(String(error));
			return undefined;
		}
	}

	/**
	 * Filters model summaries for eligibility before converting to LanguageModelChatInformation.
	 * This handles all Bedrock-specific filtering at the source data level.
	 *
	 * @param modelSummaries The model summaries to filter.
	 * @returns The filtered model summaries.
	 */
	private filterModelSummaries(modelSummaries: FoundationModelSummary[]): FoundationModelSummary[] {
		return modelSummaries.filter(m => {
			// Filter for ACTIVE models only
			if (m.modelLifecycle?.status !== 'ACTIVE') {
				this.logger.debug(`Filtering out non-ACTIVE model: ${m.modelName}`);
				return false;
			}

			// Filter for supported Bedrock providers
			if (!AWSModelProvider.SUPPORTED_BEDROCK_PROVIDERS.includes(m.providerName as string)) {
				this.logger.debug(
					`Filtering out unsupported provider model: ${m.modelName} (provider: ${m.providerName})`
				);
				return false;
			}

			// Filter for models that support INFERENCE_PROFILE inference type
			// INFERENCE_PROFILE doesn't exist in the Bedrock types but it can actually return it
			// so it casts the field to string[] to avoid typescript errors
			if (!m.inferenceTypesSupported || !(m.inferenceTypesSupported as string[]).includes('INFERENCE_PROFILE')) {
				this.logger.debug(`Filtering out model without INFERENCE_PROFILE support: ${m.modelName}`);
				return false;
			}

			// Filter out legacy models based on regex patterns using the original modelId
			if (AWSModelProvider.LEGACY_MODELS_REGEX.some(regex => {
				const re = new RegExp(`${regex}`);
				return re.test(m.modelId);
			})) {
				this.logger.debug(`Filtering out legacy model: ${m.modelName} (modelId: ${m.modelId})`);
				return false;
			}

			// Filter out models without ARN
			if (!m.modelArn) {
				this.logger.debug(`Filtering out model without ARN: ${m.modelName}`);
				return false;
			}

			return true;
		});
	}

	/**
	 * Finds the inference profile ARN for a specific model.
	 * This ensures that we can use the model and AWS will handle
	 * routing for regions and resource allocation.
	 *
	 * Prefers profiles matching the configured inference profile region.
	 * Falls back to any matching profile if no region-specific profile is found.
	 *
	 * @param modelArn The model ARN to get the inference ARN for.
	 * @param inferenceProfiles Profiles that the authenticated client can use.
	 * @returns The inference profile ARN or undefined if not found.
	 */
	private findInferenceProfileForModel(
		modelArn: string | undefined,
		inferenceProfiles: InferenceProfileSummary[]
	): string | undefined {
		if (!modelArn) {
			return undefined;
		}

		let fallbackProfileArn: string | undefined;

		for (const profile of inferenceProfiles) {
			const models = profile.models?.map(m => m.modelArn);
			if (models?.includes(modelArn)) {
				const profileArn = profile.inferenceProfileArn;
				if (profileArn && this.matchesPreferredRegion(profileArn)) {
					return profileArn;
				}

				if (!fallbackProfileArn) {
					fallbackProfileArn = profileArn;
				}
			}
		}

		if (fallbackProfileArn) {
			const fallbackRegion = this.extractRegionFromProfileArn(fallbackProfileArn);
			this.logger.warn(
				`No inference profile found in preferred region '${this._inferenceProfileRegion}' ` +
				`for model ${modelArn}. Using fallback profile from region '${fallbackRegion}': ${fallbackProfileArn}`
			);
			return fallbackProfileArn;
		}

		return undefined;
	}

	/**
	 * Extracts the region prefix from an inference profile ARN.
	 * Profile ARNs have format: arn:aws:bedrock:*:*:inference-profile/{region}.{provider}.{model}
	 *
	 * @param profileArn The inference profile ARN
	 * @returns The region prefix (e.g., 'us', 'eu', 'global') or 'unknown' if not found
	 */
	private extractRegionFromProfileArn(profileArn: string): string {
		const match = profileArn.match(/inference-profile\/([^.]+)\./);
		return match ? match[1] : 'unknown';
	}

	/**
	 * Checks if an inference profile ARN matches the preferred region.
	 *
	 * @param profileArn The inference profile ARN to check
	 * @returns true if the profile matches the preferred region
	 */
	private matchesPreferredRegion(profileArn: string): boolean {
		const profileRegion = this.extractRegionFromProfileArn(profileArn);
		return profileRegion === this._inferenceProfileRegion;
	}

	/**
	 * Throws a stored error if one exists.
	 * Used to propagate errors from async operations.
	 */
	private checkError(): void {
		if (this._lastError) {
			const error = this._lastError;
			this._lastError = undefined;
			throw error;
		}
	}

}
