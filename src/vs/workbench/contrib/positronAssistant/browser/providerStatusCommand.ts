/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../base/common/async.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
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
	 * already folded in. Absent only when the catalog could not be read
	 * (catalogStatus is not 'ready'): enablement is then unknown, and
	 * reporting a guess would be worse than saying so -- the enablement
	 * fallback treats a provider an unreadable catalog "has never heard of"
	 * as disabled, the opposite of the documented unknown-means-enabled rule
	 * for genuinely unlisted providers.
	 */
	enabled?: boolean;

	/**
	 * Present only for a provider whose sign-in state has actually been
	 * reported to this window and that is not known-disabled. Absent means
	 * unknown, never "signed out": a disabled provider's sign-in state is
	 * moot (the authentication extension drops its sessions), a catalog-only
	 * entry has nothing to report, and a registration the initial session
	 * sweep has not reached yet carries no verdict.
	 */
	auth?: ProviderAuthState;

	/**
	 * The auth failure, e.g. 'Authentication expired'. Present only when auth
	 * is 'error'. Unlike every other field, this is provider-supplied prose
	 * passed through (first line only, length-capped), not text this command
	 * constructs -- a credential error can name the endpoint or account it
	 * failed against, the same text the user's own auth error shows.
	 */
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
	 * rather than guessing; sign-in state is still reported, since it comes
	 * from the live registrations, not the catalog.
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
 * Bound on the wait for the catalog service's first fetch attempt. Local
 * catalogs resolve in milliseconds; on a remote connection the fetch rides
 * the remote-agent channel, and a stalled channel must not leave this command
 * pending forever. On timeout the service still reads 'initializing', which
 * the payload reports honestly.
 */
const CATALOG_INIT_TIMEOUT_MS = 5000;

/** Cap on the pass-through auth failure text, in characters. */
const AUTH_MESSAGE_CHAR_CAP = 200;

/**
 * The auth extension's status text, bounded for a payload: first line only,
 * hard character cap. The text is provider-supplied prose (this command
 * constructs every other field itself), so the bound keeps a chatty SDK error
 * from dumping a stack of detail into the transcript.
 * @param message The registration's statusMessage.
 */
function summarizeAuthMessage(message: string | undefined): string | undefined {
	const firstLine = message?.split('\n', 1)[0].trim();
	if (!firstLine) {
		return undefined;
	}
	return firstLine.length <= AUTH_MESSAGE_CHAR_CAP
		? firstLine
		: `${firstLine.slice(0, AUTH_MESSAGE_CHAR_CAP - 3).trimEnd()}...`;
}

/**
 * A registration's sign-in state as the payload's vocabulary. `status` is the
 * authentication extension's verdict: 'error' means configured but the
 * credential no longer resolves (e.g. expired), which must not read as a
 * fresh, never-configured provider.
 *
 * Returns undefined when the registration carries no verdict yet: the
 * authentication extension registers providers first and sweeps sessions
 * afterward, so during activation `signedIn` is still unset. Unknown must not
 * read as 'not-signed-in' -- that is this payload's own absence-is-not-signed-
 * out rule, applied to its input.
 * @param source The provider's registered source.
 */
function authState(source: IPositronLanguageModelSource): ProviderAuthState | undefined {
	if (source.status === 'error') {
		return 'error';
	}
	if (source.signedIn === undefined) {
		return undefined;
	}
	return source.signedIn ? 'signed-in' : 'not-signed-in';
}

/**
 * Whether a registration carries any sign-in verdict at all. The initial
 * session sweep sets `signedIn` (and `status`) on every registered provider,
 * so a registration with neither has not been swept yet.
 * @param source The provider's registered source.
 */
function hasAuthState(source: IPositronLanguageModelSource): boolean {
	return source.signedIn !== undefined || source.status !== undefined;
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
 * snapshot, so this command answers from local state -- no extension-host
 * round trip and no network; the only wait is a bounded one for the catalog
 * service's first fetch attempt. That also makes this payload authoritative
 * over anything an extension resolves from providers.json on its own: only
 * the host side sees both the resolved catalog and the credential state.
 * @param accessor The command's services accessor.
 */
export async function getProviderStatus(accessor: ServicesAccessor): Promise<IProviderStatusResult> {
	const aiProviderService = accessor.get(IAiProviderService);
	const assistantConfigurationService = accessor.get(IPositronAssistantConfigurationService);

	// The first catalog fetch attempt; resolves on failure too, never rejects.
	// Bounded, so a stalled remote-agent channel cannot hang the command.
	await raceTimeout(aiProviderService.whenInitialized, CATALOG_INIT_TIMEOUT_MS);

	// Enablement verdicts are only real when the catalog was actually read.
	// When it was not ('error', or 'initializing' after the bounded wait),
	// isProviderEnabled resolves against an empty snapshot and would report
	// every catalogId-declaring provider as disabled -- so enablement is
	// reported as unknown instead, while sign-in state (which comes from the
	// live registrations, not the catalog) is still carried.
	const catalogKnown = aiProviderService.status === 'ready';

	const registrations = assistantConfigurationService.getProviderRegistrations();
	const providers: IProviderStatusEntry[] = [];
	const coveredCatalogIds = new Set<string>();

	for (const source of registrations) {
		// The catalog resolves enablement by this same fallback (a registration
		// without a declared catalogId is looked up by its own id).
		const catalogId = source.provider.catalogId ?? source.provider.id;
		coveredCatalogIds.add(catalogId);
		const enabled = catalogKnown
			? assistantConfigurationService.isProviderEnabled(source.provider.id)
			: undefined;
		// Sign-in state is withheld only when the provider is KNOWN disabled;
		// unknown enablement does not invalidate a live sign-in verdict.
		const auth = enabled === false ? undefined : authState(source);
		providers.push({
			id: catalogId,
			displayName: source.provider.displayName,
			enabled,
			auth,
			authMessage: auth === 'error' ? summarizeAuthMessage(source.statusMessage) : undefined,
			maturity: source.provider.status,
			custom: source.provider.customKind !== undefined ? true : undefined,
			completionsOnly: source.type === PositronLanguageModelType.Completion ? true : undefined,
			customizedConnection: aiProviderService.getProvider(catalogId)?.customizedConnection,
		});
	}

	// Catalog entries nothing has registered a source for: a providers.json
	// entry for a provider this window does not offer, or any entry when the
	// authentication extension has not activated. Known to exist and worth
	// reporting, but with no sign-in state to carry. (Reached only with a
	// readable catalog -- an unread one has no entries -- so `enabled` here is
	// always a real verdict.)
	for (const provider of aiProviderService.getProviders()) {
		if (coveredCatalogIds.has(provider.id)) {
			continue;
		}
		providers.push({
			id: provider.id,
			enabled: provider.enabled,
			custom: provider.custom ? true : undefined,
			customizedConnection: provider.customizedConnection,
		});
	}

	// Most interesting entries first, so a transport that truncates a large
	// payload by keeping an array's leading elements sheds the boring tail:
	// auth failures (worth a warning), then the signed-in providers (the
	// answer to "which providers do I have"), then the rest, with
	// known-disabled ones last. Alphabetical within each band.
	const interest = (entry: IProviderStatusEntry): number =>
		entry.auth === 'error' ? 0
			: entry.auth === 'signed-in' ? 1
				: entry.enabled !== false ? 2 : 3;
	providers.sort((a, b) => interest(a) - interest(b) || a.id.localeCompare(b.id));

	// Sign-in state is unavailable both when nothing has registered at all
	// (authentication extension missing) and when registrations exist but none
	// has been swept yet (extension still activating): in either case no entry
	// carries an auth verdict, and the caller must not read that as signed out.
	const authStateUnavailable = !registrations.some(hasAuthState);

	return {
		catalogStatus: aiProviderService.status,
		providers,
		authStateUnavailable: authStateUnavailable ? true : undefined,
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
		returns: 'An object with catalogStatus, providers, and sometimes authStateUnavailable. catalogStatus is the provider catalog\'s lifecycle: \'ready\' when the resolved catalog (providers.json plus any administrator-enforced layers) has been read; \'error\' when it could not be; \'initializing\' when the first load had not completed within this command\'s short wait. When catalogStatus is not \'ready\', enablement is unknown: every entry omits enabled rather than guessing, sign-in state is still reported (it comes from live registrations, not the catalog), and the honest phrasing is which providers are signed in, with enablement unknown. providers is one entry per known provider, ordered most-noteworthy first: providers whose auth is \'error\', then signed-in providers, then the rest, with known-disabled ones last. Each entry carries: id, the provider\'s name in the provider catalog, which for a custom provider is the entry name the user chose; displayName, the name the UI shows, when the provider registered one; enabled, the catalog\'s verdict, with administrator-enforced layers already folded in -- false means turned off in providers.json or by an administrator, and sign-in state is then not reported, since a disabled provider is unusable regardless; absent means the catalog could not be read and enablement is unknown, not false. auth is present only for a provider that has registered its sign-in state with this window and is not known-disabled: \'signed-in\' means a credential resolves right now; \'error\' means the provider was configured but its credential no longer resolves, so it is NOT usable until the user re-authenticates, with authMessage carrying the reason (e.g. \'Authentication expired\') -- authMessage is the authentication extension\'s own status text passed through (first line, length-capped), the one field whose wording this command does not construct; \'not-signed-in\' means offered but never set up. An entry with no auth field has UNKNOWN sign-in state -- absence is not \'signed out\'. maturity is present only for a provider that is not yet stable (\'preview\' or \'experimental\'); custom is present and true only for a provider defined by a custom providers.json entry; completionsOnly is present and true only when the provider serves inline completions rather than chat (GitHub Copilot). customizedConnection lists the names of connection fields whose value differs from this build\'s built-in defaults (e.g. \'baseUrl\', \'aws.profile\', \'customHeaders\'), meaning the user or an administrator set them; a stock install reports none, and a provider\'s default endpoint never appears here. Names only, never values, deliberately: if the user needs the actual URL or value, direct them to open providers.json rather than guessing at it. authStateUnavailable is present and true only when NO provider has registered sign-in state in this window (the authentication extension is missing or has not finished activating): every entry then lacks auth, and the safe statement is which providers are enabled, not which are signed in. A provider is usable for chat exactly when enabled is true and auth is \'signed-in\'.',
	},
});
