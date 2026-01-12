/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { createAmazonBedrock, AmazonBedrockProvider } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
	BedrockClient,
	FoundationModelSummary,
	InferenceProfileSummary,
	ListFoundationModelsCommand,
	ListInferenceProfilesCommand
} from '@aws-sdk/client-bedrock';
import { VercelModelProvider } from '../base/vercelModelProvider';
import { ModelConfig, SecretStorage, getStoredModels, expandConfigToSource } from '../../config';
import { DEFAULT_MAX_TOKEN_INPUT } from '../../constants';
import { AssistantError } from '../../extension';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers';
import { getAllModelDefinitions } from '../../modelDefinitions';
import { autoconfigureWithManagedCredentials, AWS_MANAGED_CREDENTIALS } from '../../pwb';
import { PositronAssistantApi } from '../../api';
import { registerModelWithAPI } from '../../modelRegistration';

/**
 * Environment variables for AWS Bedrock configuration.
 */
export interface BedrockProviderVariables {
	AWS_REGION?: string;
	AWS_PROFILE?: string;
}

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
	protected declare aiProvider: AmazonBedrockProvider;

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
	 * Flag indicating if we're currently resolving the connection.
	 * Used to adjust error handling for SSO login prompts.
	 */
	private _resolvingConnection: boolean = false;

	/**
	 * The last error encountered during model resolution.
	 * Used to manage re-authentication prompts.
	 */
	private _lastError?: Error;

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

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: {
			id: 'amazon-bedrock',
			displayName: 'Amazon Bedrock'
		},
		supportedOptions: ['toolCalls', 'autoconfigure'],
		defaults: {
			name: 'Claude 4 Sonnet Bedrock',
			model: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
			toolCalls: true,
			autoconfigure: {
				type: positron.ai.LanguageModelAutoconfigureType.Custom,
				message: 'Automatically configured using AWS credentials',
				signedIn: false
			},
		},
	};

	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext, _storage?: SecretStorage) {
		super(_config, _context, _storage);
	}

	/**
	 * Initializes the AWS Bedrock provider with credentials and region settings.
	 */
	protected override initializeProvider() {
		// Get environment settings from VS Code configuration
		const environmentSettings = vscode.workspace
			.getConfiguration('positron.assistant.providerVariables')
			.get<BedrockProviderVariables>('bedrock', {});

		this.logger.debug(
			`positron.assistant.providerVariables.bedrock settings: ${JSON.stringify(environmentSettings)}`
		);

		// Merge environment variables with configuration settings
		const { AWS_REGION, AWS_PROFILE }: BedrockProviderVariables = {
			...process.env as BedrockProviderVariables,
			...environmentSettings
		};

		const region = AWS_REGION ?? 'us-east-1';
		const profile = AWS_PROFILE ?? 'default';
		const credentials = fromNodeProviderChain({ profile });

		this.logger.info(`Using AWS region: ${region} and profile: ${AWS_PROFILE ?? 'default'}`);

		// Initialize Vercel AI SDK provider for chat generation
		this.aiProvider = createAmazonBedrock({
			region,
			credentialProvider: credentials
		});

		// Initialize Bedrock SDK client for model listing
		this.bedrockClient = new BedrockClient({
			profile,
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
		const aiModel = this.aiProvider(model.id);

		// Only select Bedrock models support cache breakpoints
		const bedrockCacheBreakpoint = this.providerId === 'amazon-bedrock' &&
			!aiModel.modelId.includes('anthropic.claude-3-5');

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
	 * @returns A user-friendly error message or undefined if not specifically handled.
	 */
	override async parseProviderError(error: any) {
		// First try the base class error parsing
		const aiSdkError = await super.parseProviderError(error);
		if (aiSdkError) {
			return aiSdkError;
		}

		if (!(error instanceof Error)) {
			return undefined;
		}

		const name = error.name;
		const message = error.message;

		if (!message) {
			return await super.parseProviderError(error);
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
					const isConnectionTest = this._resolvingConnection;
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
						throw new Error(
							vscode.l10n.t(
								`AWS login required. Please run \`aws sso login --profile ${this.bedrockClient.config.profile} --region ${this.bedrockClient.config.region}\` in the terminal, and retry this request.`
							)
						);
					}
				}
			} else {
				return vscode.l10n.t(`Invalid AWS credentials. {0}`, message);
			}
		}

		return vscode.l10n.t(`Amazon Bedrock error: {0}`, message);
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

		// Execute the AWS SSO login command as a native task
		const taskExecution = await vscode.tasks.executeTask(new vscode.Task(
			{ type: 'shell' },
			vscode.TaskScope.Workspace,
			'AWS SSO Login',
			'AWS',
			new vscode.ShellExecution(`aws sso login --profile ${profile} --region ${region}`)
		));

		const result = new Promise<boolean>((resolve) => {
			vscode.tasks.onDidEndTaskProcess(e => {
				if (e.execution === taskExecution) {
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
							this._storage,
							this
						).then(() => {
							positron.ai.addLanguageModelConfig(expandConfigToSource(this._config));
							PositronAssistantApi.get().notifySignIn(this._config.name);
						});
					}
					resolve(success);
				}
			});
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
		this._resolvingConnection = true;

		try {
			await this.resolveModels(token);
			this.checkError();
		} catch (error) {
			// Try to parse specific Bedrock errors
			// This way, we can handle SSO login errors specifically
			const parsedError = await this.parseProviderError(error);
			if (parsedError) {
				return new Error(parsedError);
			}
		} finally {
			this._resolvingConnection = false;
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

		for (const profile of inferenceProfiles) {
			const models = profile.models?.map(m => m.modelArn);
			if (models?.includes(modelArn)) {
				return profile.inferenceProfileArn;
			}
		}
		return undefined;
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

	/**
	 * Autoconfigures the AWS Bedrock provider using managed credentials.
	 * This method checks for managed credentials on Posit Workbench.
	 *
	 * @returns A promise that resolves to the autoconfigure result.
	 */
	static override async autoconfigure() {
		return await autoconfigureWithManagedCredentials(
			AWS_MANAGED_CREDENTIALS,
			AWSModelProvider.source.provider.id,
			AWSModelProvider.source.provider.displayName
		);
	}
}
