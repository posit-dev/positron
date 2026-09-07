/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../base/common/async.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { AiProviderServiceStatus, IAiProviderService } from '../../../services/positronAiProvider/common/aiProviderService.js';

/** One AI provider, as the getProviderStatus command reports it. */
export interface IProviderStatusEntry {
	/**
	 * The provider's id in the resolved provider catalog (providers.json), e.g.
	 * 'anthropic' or 'bedrock'; for a custom provider, the entry name the user
	 * chose.
	 */
	id: string;

	/**
	 * The catalog's enablement verdict, with administrator-enforced layers
	 * already folded in. Absent only when the catalog could not be read
	 * (catalogStatus is not 'ready'): enablement is then unknown, and
	 * reporting a guess would be worse than saying so.
	 */
	enabled?: boolean;

	/** Present, and true, only for a provider from a custom providers.json entry. */
	custom?: boolean;

	/**
	 * Names of the connection fields whose resolved value differs from this
	 * build's built-in defaults, e.g. 'baseUrl' or 'aws.profile' -- set by the
	 * user or an administrator, so a stock install reports none. Computed on
	 * the node side, which can import the defaults to diff against. Field
	 * names only, never values: this payload enters a transcript that leaves
	 * the machine unreviewed, and a base URL or account name can reveal
	 * internal endpoints. The name is enough to answer "is my connection
	 * customized"; for the value itself, the user opens providers.json.
	 */
	customizedConnection?: readonly string[];
}

/** What the getProviderStatus command returns. */
export interface IProviderStatusResult {
	/**
	 * The provider catalog's lifecycle: 'ready' when the resolved catalog has
	 * been read, 'error' when it could not be, 'initializing' when the first
	 * load had not completed within this command's bounded wait. When it is
	 * not 'ready', enablement is unknown and every entry omits `enabled`
	 * rather than guessing.
	 */
	catalogStatus: AiProviderServiceStatus;

	providers: IProviderStatusEntry[];
}

/**
 * Bound on the wait for the catalog service's first fetch attempt. Local
 * catalogs resolve in milliseconds; on a remote connection the fetch rides
 * the remote-agent channel, and a stalled channel must not leave this command
 * pending forever. On timeout the service still reads 'initializing', which
 * the payload reports honestly.
 */
const CATALOG_INIT_TIMEOUT_MS = 5000;

/**
 * Reports every AI language model provider this window knows: the catalog's
 * enablement verdict and whether the connection is customized.
 *
 * Reads renderer state only, on purpose: enablement comes from the warmed
 * catalog snapshot, so this command answers from local state -- no
 * extension-host round trip and no network; the only wait is a bounded one for
 * the catalog service's first fetch attempt. That also makes this payload
 * authoritative over anything an extension resolves from providers.json on its
 * own, since only the host side sees the fully resolved catalog.
 *
 * Sign-in state is deliberately absent: credentials belong to the extensions
 * that register the authentication providers, not to the workbench, so a
 * caller that needs it asks them.
 * @param accessor The command's services accessor.
 */
export async function getProviderStatus(accessor: ServicesAccessor): Promise<IProviderStatusResult> {
	const aiProviderService = accessor.get(IAiProviderService);

	// The first catalog fetch attempt; resolves on failure too, never rejects.
	// Bounded, so a stalled remote-agent channel cannot hang the command.
	await raceTimeout(aiProviderService.whenInitialized, CATALOG_INIT_TIMEOUT_MS);

	// Enablement verdicts are only real when the catalog was actually read.
	// When it was not ('error', or 'initializing' after the bounded wait),
	// enablement is reported as unknown rather than guessed.
	const catalogKnown = aiProviderService.status === 'ready';

	const providers: IProviderStatusEntry[] = aiProviderService.getProviders().map(provider => ({
		id: provider.id,
		enabled: catalogKnown ? provider.enabled : undefined,
		custom: provider.custom ? true : undefined,
		customizedConnection: provider.customizedConnection,
	}));

	// Most interesting entries first, so a transport that truncates a large
	// payload by keeping an array's leading elements sheds the boring tail:
	// enabled providers (the answer to "which providers do I have"), then the
	// known-disabled ones. Alphabetical within each band.
	const interest = (entry: IProviderStatusEntry): number => entry.enabled !== false ? 0 : 1;
	providers.sort((a, b) => interest(a) - interest(b) || a.id.localeCompare(b.id));

	return {
		catalogStatus: aiProviderService.status,
		providers,
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
			"Report the AI language model providers this Positron knows: which are enabled in the provider catalog, and whose connection settings have been customized. Does not report sign-in state. Changes nothing and shows the user nothing. Reads live state, not any file, so it is correct on desktop, on the web, over a remote connection, and on Posit Workbench."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		returns: 'An object with catalogStatus and providers. catalogStatus is the provider catalog\'s lifecycle: \'ready\' when the resolved catalog (providers.json plus any administrator-enforced layers) has been read; \'error\' when it could not be; \'initializing\' when the first load had not completed within this command\'s short wait. When catalogStatus is not \'ready\', enablement is unknown: every entry omits enabled rather than guessing. providers is one entry per catalog provider, enabled ones first, then known-disabled ones, alphabetical within each band. Each entry carries: id, the provider\'s name in the provider catalog, which for a custom provider is the entry name the user chose; enabled, the catalog\'s verdict with administrator-enforced layers already folded in -- false means turned off in providers.json or by an administrator, and absent means the catalog could not be read and enablement is unknown, not false; custom, present and true only for a provider defined by a custom providers.json entry; customizedConnection, the names of connection fields whose value differs from this build\'s built-in defaults (e.g. \'baseUrl\', \'aws.profile\', \'customHeaders\'), meaning the user or an administrator set them -- a stock install reports none, and a provider\'s default endpoint never appears here. Names only, never values, deliberately: if the user needs the actual URL or value, direct them to open providers.json rather than guessing at it. This payload does NOT report sign-in state: credentials belong to the extensions that register the authentication providers, so enabled does not mean signed in, and a provider being enabled says nothing about whether a credential resolves for it.',
	},
});
