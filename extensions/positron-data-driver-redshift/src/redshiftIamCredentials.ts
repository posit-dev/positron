/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Mints the temporary database credentials Redshift issues to an IAM identity. Redshift has no
// "enable IAM auth" switch: IAM database authorization is always available, and whether it works is
// purely a question of the calling principal's policy. What it does have is two different APIs
// depending on the flavour of Redshift, which must not be conflated:
//
//   Serverless   redshift-serverless:GetCredentials      keyed on a workgroup name
//   Provisioned  redshift:GetClusterCredentials          keyed on a cluster identifier + db user
//
// Two properties of the result shape the rest of the driver:
//
//   1. The username comes back, it is not supplied. For serverless, Redshift derives the database
//      user from the federated identity and returns it (`IAMR:AWSReservedSSO_PowerUser_<hash>` for
//      an Identity Center principal). Asking the user to type a username and then fetching only a
//      password would connect as the wrong role, or fail outright.
//
//   2. The credentials are short-lived -- 900 seconds by default, 3600 at most. That is well inside
//      the lifetime of an ordinary browsing session, so nothing may cache them once at connect time;
//      every reconnect has to be able to mint a fresh pair. See RedshiftClient, which resolves
//      credentials immediately before building each pg client rather than capturing them.
//
// The returned password goes in the ordinary password slot of the PostgreSQL wire protocol -- it is
// a password, not a bearer token -- so TLS matters more here than usual.

import { GetClusterCredentialsCommand, GetClusterCredentialsCommandInput, GetClusterCredentialsCommandOutput, RedshiftClient as RedshiftApiClient } from '@aws-sdk/client-redshift';
import { GetCredentialsCommand, GetCredentialsCommandInput, GetCredentialsCommandOutput, RedshiftServerlessClient } from '@aws-sdk/client-redshift-serverless';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Temporary database credentials minted by AWS. Both the user and the password are derived from the
 * IAM identity; neither is supplied by the person connecting.
 */
export interface RedshiftIamCredentials {
	user: string;
	password: string;
	/** When these credentials stop working. */
	expiresAt: Date;
}

/**
 * Mints a set of credentials. Called before each connect rather than once per connection, so a
 * connection that outlives its credentials can still reconnect.
 *
 * Pass `forceRefresh` when the server has actually rejected the current credentials. Expiry is
 * normally anticipated from the timestamp AWS returns, but that can be wrong -- a revoked policy or
 * a skewed clock rejects credentials the cache still believes in -- and without this the retry would
 * present the same rejected pair again.
 */
export type RedshiftCredentialProvider = (forceRefresh?: boolean) => Promise<RedshiftIamCredentials>;

/** What the credential call needs to know, once the endpoint has been parsed. */
export interface RedshiftIamConfig {
	/** Which API to call. */
	kind: 'serverless' | 'provisioned';
	/** The workgroup name (serverless) or cluster identifier (provisioned). */
	name: string;
	/** The region hosting the workgroup or cluster, which is not necessarily the SSO region. */
	region: string;
	/** The database the credentials are scoped to. */
	database: string;
	/** The AWS profile to authenticate with. Omitted to use the default provider chain. */
	profile?: string;
	/** The database user to assume. Required for provisioned clusters, unused for serverless. */
	dbUser?: string;
}

/**
 * The lifetime to request, in seconds. AWS permits 900 (the default) to 3600, and the credentials
 * cannot outlive the caller's own session regardless. Asking for the maximum minimizes how often a
 * browsing session has to stop and re-mint.
 */
const REQUESTED_DURATION_SECONDS = 3600;

/**
 * How long before expiry to treat credentials as already stale. Covers the round trip of opening a
 * connection with them, so a set that would expire mid-handshake is replaced rather than used.
 */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Why a connection attempt failed, as far as the remedy is concerned.
 *
 * `expired` and `missing` are both credential problems rather than Redshift problems, but they are
 * worth keeping apart because their fixes have nothing in common: an expired session is fixed by
 * signing in again, whereas no credentials at all usually means no profile was named and the
 * default chain came up empty. Reporting the second as the first sends people to re-run a sign-in
 * that already worked. With IAM Identity Center there are no long-lived access keys to fall back
 * on, so an unset profile reliably produces `missing` rather than quietly working.
 */
type CredentialFailureKind = 'expired' | 'missing' | 'other';

/** Classifies an AWS failure by what would actually fix it. */
function classifyFailure(err: unknown): CredentialFailureKind {
	if (!err || typeof err !== 'object') {
		return 'other';
	}
	const { name, message } = err as { name?: string; message?: string };
	const lower = (message ?? '').toLowerCase();

	// Expiry is checked first: the SDK reports an expired SSO token as a CredentialsProviderError
	// too, so testing the name before the message would classify every expiry as `missing`.
	if (name === 'ExpiredTokenException' || name === 'TokenRefreshRequired' ||
		lower.includes('token has expired') ||
		lower.includes('has expired or is otherwise invalid') ||
		lower.includes('sso session associated with this profile has expired') ||
		lower.includes('refresh failed')) {
		return 'expired';
	}
	if (name === 'CredentialsProviderError' ||
		lower.includes('could not load credentials') ||
		lower.includes('is not authorized to perform: sso')) {
		return 'missing';
	}
	return 'other';
}

/**
 * Rewrites an AWS failure into something that names the actual remedy. Otherwise a credential
 * problem surfaces as a bare connection failure and sends people looking at the cluster.
 */
function describeFailure(err: unknown, config: RedshiftIamConfig): Error {
	const detail = err instanceof Error ? err.message : String(err);
	switch (classifyFailure(err)) {
		case 'expired':
			return new Error(config.profile
				? vscode.l10n.t("Your AWS session for profile '{0}' has expired. Run 'aws sso login --profile {0}' and try again. ({1})", config.profile, detail)
				: vscode.l10n.t("Your AWS session has expired. Run 'aws sso login' and try again. ({0})", detail));
		case 'missing':
			// Name the profile field explicitly. An empty one is the most common cause, and the
			// message it used to produce blamed an SSO session that was working fine.
			return new Error(config.profile
				? vscode.l10n.t("No AWS credentials found for profile '{0}'. Check that the profile exists in ~/.aws/config, then run 'aws sso login --profile {0}'. ({1})", config.profile, detail)
				: vscode.l10n.t("No AWS credentials found. This connection has no AWS Profile set, so the default credential chain was used; either set the profile or configure a [default] profile in ~/.aws/config. ({0})", detail));
		case 'other':
			break;
	}
	return new Error(config.kind === 'serverless'
		? vscode.l10n.t("Could not get temporary credentials for Redshift Serverless workgroup '{0}' in {1}: {2}", config.name, config.region, detail)
		: vscode.l10n.t("Could not get temporary credentials for Redshift cluster '{0}' in {1}: {2}", config.name, config.region, detail));
}

/**
 * Issues the two AWS calls. These are the only pieces of this module that touch the network, so
 * they are the injection seam: the functions below build the request and map the response, and take
 * a sender so tests can assert what would have been sent and answer with a fixed response. Same
 * reasoning as PgClientFactory on RedshiftClient -- everything except the transport stays testable
 * without live infrastructure.
 */
export type ServerlessCredentialsSender =
	(config: RedshiftIamConfig, input: GetCredentialsCommandInput) => Promise<GetCredentialsCommandOutput>;
export type ClusterCredentialsSender =
	(config: RedshiftIamConfig, input: GetClusterCredentialsCommandInput) => Promise<GetClusterCredentialsCommandOutput>;

/** Builds the AWS client options shared by both APIs. */
function clientOptions(config: RedshiftIamConfig) {
	return {
		region: config.region,
		// The provider chain covers SSO cache, environment variables, and instance/container roles.
		// With IAM Identity Center there are no long-lived keys, so this is the only way in.
		credentials: fromNodeProviderChain({ profile: config.profile }),
	};
}

/** The real serverless sender. */
const sendServerlessCredentials: ServerlessCredentialsSender = async (config, input) => {
	const client = new RedshiftServerlessClient(clientOptions(config));
	try {
		return await client.send(new GetCredentialsCommand(input));
	} finally {
		client.destroy();
	}
};

/** The real provisioned sender. */
const sendClusterCredentials: ClusterCredentialsSender = async (config, input) => {
	const client = new RedshiftApiClient(clientOptions(config));
	try {
		return await client.send(new GetClusterCredentialsCommand(input));
	} finally {
		client.destroy();
	}
};

/** The expiry to assume when AWS does not report one. */
function fallbackExpiry(): Date {
	return new Date(Date.now() + REQUESTED_DURATION_SECONDS * 1000);
}

/**
 * Mints credentials for a serverless workgroup. Note the camelCase response fields, which differ
 * from the provisioned API's PascalCase ones.
 */
export async function getServerlessCredentials(
	config: RedshiftIamConfig,
	send: ServerlessCredentialsSender = sendServerlessCredentials
): Promise<RedshiftIamCredentials> {
	const response = await send(config, {
		workgroupName: config.name,
		dbName: config.database,
		durationSeconds: REQUESTED_DURATION_SECONDS,
	});
	if (!response.dbUser || !response.dbPassword) {
		throw new Error(vscode.l10n.t('AWS returned no credentials.'));
	}
	return {
		user: response.dbUser,
		password: response.dbPassword,
		expiresAt: response.expiration ?? fallbackExpiry(),
	};
}

/**
 * Mints credentials for a provisioned cluster. Unlike serverless, this API takes the database user
 * to assume, and returns it prefixed (`IAM:<user>`, or `IAMA:<user>` when auto-created) -- so the
 * returned value is used rather than the one that was asked for. AutoCreate is left off so
 * connecting never silently creates a database user.
 */
export async function getClusterCredentials(
	config: RedshiftIamConfig,
	send: ClusterCredentialsSender = sendClusterCredentials
): Promise<RedshiftIamCredentials> {
	if (!config.dbUser) {
		throw new Error(vscode.l10n.t('A database user is required to connect to a provisioned Redshift cluster with IAM.'));
	}
	const response = await send(config, {
		ClusterIdentifier: config.name,
		DbName: config.database,
		DbUser: config.dbUser,
		DurationSeconds: REQUESTED_DURATION_SECONDS,
		AutoCreate: false,
	});
	if (!response.DbUser || !response.DbPassword) {
		throw new Error(vscode.l10n.t('AWS returned no credentials.'));
	}
	return {
		user: response.DbUser,
		password: response.DbPassword,
		expiresAt: response.Expiration ?? fallbackExpiry(),
	};
}

/**
 * Mints credentials for whichever flavour the config names. Injectable into the provider below so
 * its caching and refresh behaviour can be tested without reaching either AWS API.
 */
export type RedshiftCredentialFetcher = (config: RedshiftIamConfig) => Promise<RedshiftIamCredentials>;

/** The real fetcher: dispatches on the flavour. */
export const defaultCredentialFetcher: RedshiftCredentialFetcher = config =>
	config.kind === 'serverless' ? getServerlessCredentials(config) : getClusterCredentials(config);

/**
 * Creates a credential provider for the given Redshift target. The provider caches the credentials
 * it mints and reuses them until they are close enough to expiry to be risky, so reconnecting a few
 * times in quick succession does not make a call per attempt.
 * @param config Identifies the workgroup or cluster and how to authenticate to AWS.
 * @param logger Optional diagnostic log sink.
 * @param fetch Mints the credentials. Defaults to the real AWS calls; overridden in tests.
 */
export function createIamCredentialProvider(
	config: RedshiftIamConfig,
	logger?: positron.DataConnectionLogger,
	fetch: RedshiftCredentialFetcher = defaultCredentialFetcher
): RedshiftCredentialProvider {
	let cached: RedshiftIamCredentials | undefined;
	let inFlight: Promise<RedshiftIamCredentials> | undefined;

	return async (forceRefresh?: boolean) => {
		if (forceRefresh) {
			cached = undefined;
		}
		if (cached && cached.expiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS) {
			return cached;
		}
		// Coalesce concurrent callers onto one AWS call, the same way RedshiftClient coalesces
		// concurrent reconnects.
		if (!inFlight) {
			inFlight = (async () => {
				logger?.info(`Requesting temporary Redshift credentials for ${config.kind} '${config.name}' in ${config.region}`);
				try {
					const credentials = await fetch(config);
					logger?.info(`Received temporary credentials for '${credentials.user}', expiring ${credentials.expiresAt.toISOString()}`);
					cached = credentials;
					return credentials;
				} catch (err) {
					const failure = describeFailure(err, config);
					logger?.error(failure.message);
					throw failure;
				}
			})().finally(() => { inFlight = undefined; });
		}
		return inFlight;
	};
}
