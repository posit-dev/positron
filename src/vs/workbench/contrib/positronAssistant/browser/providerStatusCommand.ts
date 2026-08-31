/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IResolvedConnectionData } from '../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { AiProviderServiceStatus, IAiProviderService } from '../../../services/positronAiProvider/common/aiProviderService.js';
import { IPositronAssistantConfigurationService, IPositronLanguageModelSource, PositronLanguageModelType } from '../common/interfaces/positronAssistantService.js';

/** How far a provider's sign-in has gotten, as this payload reports it. */
export type ProviderAuthState = 'signed-in' | 'not-signed-in' | 'error';

/** One AI provider, as the getProviderStatus command reports it. */
export interface IProviderStatusEntry {
	/**
	 * The provider's id in the resolved provider catalog (providers.json), e.g.
	 * 'anthropic' or 'bedrock'; for a custom provider, the entry name the user
	 * chose. Falls back to the registration id when the registration declares
	 * no catalog id.
	 */
	id: string;

	/** The name the UI shows, when the provider registered one. */
	displayName?: string;

	/**
	 * The catalog's enablement verdict, with administrator-enforced layers
	 * already folded in. Always carried: it is the core fact of every entry,
	 * so absence semantics would cost more prose than the byte saves.
	 */
	enabled: boolean;

	/**
	 * Present only for an enabled provider that has registered its sign-in
	 * state with this window. Absent means unknown, never "signed out": a
	 * disabled provider's sign-in state is moot (the authentication extension
	 * drops its sessions), and a catalog-only entry has nothing to report.
	 */
	auth?: ProviderAuthState;

	/** The auth failure, e.g. 'Authentication expired'. Present only when auth is 'error'. */
	authMessage?: string;

	/** Present only for a provider not yet stable: 'preview' or 'experimental'. */
	maturity?: 'preview' | 'experimental';

	/** Present, and true, only for a provider from a custom providers.json entry. */
	custom?: boolean;

	/**
	 * Present, and true, only when the provider serves inline completions
	 * rather than chat (GitHub Copilot).
	 */
	completionsOnly?: boolean;

	/**
	 * Names of the connection fields customized in the provider catalog, e.g.
	 * 'baseUrl' or 'aws.profile'. Field names only, never values: this payload
	 * enters a transcript that leaves the machine unreviewed, and a base URL
	 * or account name can reveal internal endpoints. The name is enough to
	 * answer "is my connection customized"; for the value itself, the user
	 * opens providers.json.
	 */
	customizedConnection?: string[];
}

/** What the getProviderStatus command returns. */
export interface IProviderStatusResult {
	/**
	 * The provider catalog's lifecycle: 'ready' when the resolved catalog has
	 * been read, 'error' when it could not be, 'initializing' before the first
	 * fetch attempt completes. On 'error' the catalog is absent, and enablement
	 * falls back to treating providers the catalog has never heard of as
	 * enabled, so a caller should hedge enablement claims.
	 */
	catalogStatus: AiProviderServiceStatus;

	providers: IProviderStatusEntry[];

	/**
	 * Present, and true, only when no provider has registered sign-in state
	 * with this window at all (the authentication extension is missing or has
	 * not finished activating). Every entry then lacks `auth`, and the safe
	 * statement is which providers are enabled, not which are signed in.
	 */
	authStateUnavailable?: boolean;
}

/**
 * The connection fields a catalog entry customizes, flattened to dotted names.
 * Names only, by construction: no value read here ever reaches the payload, so
 * this command needs no redaction pass -- there is nothing to redact.
 * @param connection The provider's resolved connection data.
 */
function customizedConnectionFields(connection: IResolvedConnectionData): string[] | undefined {
	const fields: string[] = [];
	if (connection.baseUrl !== undefined) {
		fields.push('baseUrl');
	}
	if (connection.endpoint !== undefined) {
		fields.push('endpoint');
	}
	if (connection.customHeaders && Object.keys(connection.customHeaders).length > 0) {
		fields.push('customHeaders');
	}
	const groups: Record<string, Record<string, unknown> | undefined> = {
		aws: connection.aws,
		googleCloud: connection.googleCloud,
		snowflake: connection.snowflake,
		databricks: connection.databricks,
	};
	for (const [group, values] of Object.entries(groups)) {
		for (const [name, value] of Object.entries(values ?? {})) {
			if (value !== undefined) {
				fields.push(`${group}.${name}`);
			}
		}
	}
	return fields.length > 0 ? fields : undefined;
}

/**
 * A registration's sign-in state as the payload's vocabulary. `status` is the
 * authentication extension's verdict: 'error' means configured but the
 * credential no longer resolves (e.g. expired), which must not read as a
 * fresh, never-configured provider.
 * @param source The provider's registered source.
 */
function authState(source: IPositronLanguageModelSource): ProviderAuthState {
	if (source.status === 'error') {
		return 'error';
	}
	return source.signedIn ? 'signed-in' : 'not-signed-in';
}

/**
 * Reports every AI language model provider this window knows: the catalog's
 * enablement verdict, live sign-in state, and whether the connection is
 * customized.
 *
 * Reads renderer state only, on purpose. Sign-in state is the same
 * registration data the Configure Language Model Providers modal renders
 * (pushed by the authentication extension at activation and kept fresh on
 * every session change), and enablement comes from the warmed catalog
 * snapshot, so this command answers synchronously once the catalog service
 * has initialized -- no extension-host round trip, no network, no timeouts.
 * That also makes this payload authoritative over anything an extension
 * resolves from providers.json on its own: only the host side sees both the
 * resolved catalog and the credential state.
 * @param accessor The command's services accessor.
 */
export async function getProviderStatus(accessor: ServicesAccessor): Promise<IProviderStatusResult> {
	const aiProviderService = accessor.get(IAiProviderService);
	const assistantConfigurationService = accessor.get(IPositronAssistantConfigurationService);

	// The first catalog fetch attempt; resolves on failure too, never rejects.
	await aiProviderService.whenInitialized;

	const registrations = assistantConfigurationService.getProviderRegistrations();
	const providers: IProviderStatusEntry[] = [];
	const coveredCatalogIds = new Set<string>();

	for (const source of registrations) {
		// The catalog resolves enablement by this same fallback (a registration
		// without a declared catalogId is looked up by its own id).
		const catalogId = source.provider.catalogId ?? source.provider.id;
		coveredCatalogIds.add(catalogId);
		const enabled = assistantConfigurationService.isProviderEnabled(source.provider.id);
		const connection = aiProviderService.getProvider(catalogId)?.connection;
		providers.push({
			id: catalogId,
			displayName: source.provider.displayName,
			enabled,
			auth: enabled ? authState(source) : undefined,
			authMessage: enabled && source.status === 'error' ? source.statusMessage : undefined,
			maturity: source.provider.status,
			custom: source.provider.customKind !== undefined ? true : undefined,
			completionsOnly: source.type === PositronLanguageModelType.Completion ? true : undefined,
			customizedConnection: connection ? customizedConnectionFields(connection) : undefined,
		});
	}

	// Catalog entries nothing has registered a source for: a providers.json
	// entry for a provider this window does not offer, or any entry when the
	// authentication extension has not activated. Known to exist and worth
	// reporting, but with no sign-in state to carry.
	for (const provider of aiProviderService.getProviders()) {
		if (coveredCatalogIds.has(provider.id)) {
			continue;
		}
		providers.push({
			id: provider.id,
			enabled: provider.enabled,
			customizedConnection: customizedConnectionFields(provider.connection),
		});
	}

	// Most interesting entries first, so a transport that truncates a large
	// payload by keeping an array's leading elements sheds the boring tail:
	// auth failures (worth a warning), then the signed-in providers (the
	// answer to "which providers do I have"), then other enabled providers,
	// then disabled ones. Alphabetical within each band.
	const interest = (entry: IProviderStatusEntry): number =>
		entry.auth === 'error' ? 0
			: entry.auth === 'signed-in' ? 1
				: entry.enabled ? 2 : 3;
	providers.sort((a, b) => interest(a) - interest(b) || a.id.localeCompare(b.id));

	return {
		catalogStatus: aiProviderService.status,
		providers,
		authStateUnavailable: registrations.length === 0 ? true : undefined,
	};
}

// The id of the payload command, matching every other agentCompatible command in
// the workbench: one command per payload, carrying its own return contract.
export const ASSISTANT_GET_PROVIDER_STATUS_COMMAND_ID = 'positronAssistant.getProviderStatus';

// Registered through CommandsRegistry rather than registerAction2, so it takes no
// Command Palette slot and has no precondition: it always appears in
// getAgentAllowedCommands() and never vanishes mid-session. There is no state in
// which it has nothing to say -- with no catalog and no registrations, saying so
// IS the payload.
//
// Deliberately not gated on the ai.enabled main switch, for the reasons written
// down at positronPackagesCommands.ts:17-28 and applied to the settings commands
// before this one: it reports the user's own environment, it does not call a
// model or surface an AI action, and the callers that matter are themselves
// gated. With every provider disabled by policy, reporting exactly that is this
// command doing its job.
CommandsRegistry.registerCommand({
	id: ASSISTANT_GET_PROVIDER_STATUS_COMMAND_ID,
	handler: getProviderStatus,
	metadata: {
		description: localize(
			'positron.assistant.getProviderStatus.description',
			"Report the AI language model providers this Positron knows: which are enabled in the provider catalog, which the user is signed in to right now, and which are configured but failing to authenticate. Changes nothing and shows the user nothing. Reads live state, not any file, so it is correct on desktop, on the web, over a remote connection, and on Posit Workbench."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		returns: 'An object with catalogStatus, providers, and sometimes authStateUnavailable. catalogStatus is the provider catalog\'s lifecycle: \'ready\' when the resolved catalog (providers.json plus any administrator-enforced layers) has been read, \'error\' when it could not be (enablement then falls back to treating providers the catalog has never heard of as enabled, so hedge enablement claims), \'initializing\' if the first fetch has not completed. providers is one entry per known provider, ordered most-noteworthy first: providers whose auth is \'error\', then signed-in providers, then other enabled providers, then disabled ones. Each entry carries: id, the provider\'s name in the provider catalog, which for a custom provider is the entry name the user chose; displayName, the name the UI shows, when the provider registered one; enabled, the catalog\'s verdict, with administrator-enforced layers already folded in -- false means turned off in providers.json or by an administrator, and sign-in state is then not reported, since a disabled provider is unusable regardless. auth is present only for an enabled provider that has registered its sign-in state with this window: \'signed-in\' means a credential resolves right now and the provider is usable; \'error\' means the provider was configured but its credential no longer resolves, so it is NOT usable until the user re-authenticates, with authMessage carrying the reason (e.g. \'Authentication expired\'); \'not-signed-in\' means offered but never set up. An entry with no auth field has UNKNOWN sign-in state -- absence is not \'signed out\'. maturity is present only for a provider that is not yet stable (\'preview\' or \'experimental\'); custom is present and true only for a provider defined by a custom providers.json entry; completionsOnly is present and true only when the provider serves inline completions rather than chat (GitHub Copilot). customizedConnection lists the names of connection fields customized in the provider catalog (e.g. \'baseUrl\', \'aws.profile\', \'customHeaders\') -- names only, never values, deliberately: if the user needs the actual URL or value, direct them to open providers.json rather than guessing at it. authStateUnavailable is present and true only when NO provider has registered sign-in state in this window (the authentication extension is missing or has not finished activating): every entry then lacks auth, and the safe statement is which providers are enabled, not which are signed in. A provider is usable for chat exactly when enabled is true and auth is \'signed-in\'.',
	},
});
