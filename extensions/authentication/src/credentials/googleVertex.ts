/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { GoogleAuth } from 'google-auth-library';
import { AuthProviderLogger } from '../authProviderLogger';
import { log } from '../log';

const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * Session token payload returned by the resolver. JSON-stringified into the
 * `accessToken` field of the `vscode.authentication` session so the consumer
 * can authenticate against Vertex without re-deriving any of these pieces.
 *
 * The embedded credential is called `token`, matching `google-auth-library`'s
 * own `GetAccessTokenResponse.token` field. Not to be confused with the outer
 * `session.accessToken` (a VS Code authentication API field): the outer one
 * is the JSON envelope; the inner `token` is the OAuth bearer.
 */
export interface GoogleVertexCredentialPayload {
	/** Fresh OAuth bearer with cloud-platform scope. */
	token: string;
	/** GCP project ID. */
	project: string;
	/** GCP region (e.g. `us-central1`). */
	location: string;
}

/**
 * Tries inline service-account credentials passed via env vars
 * (`GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`). Mints an OAuth token via
 * `google-auth-library`. Returns undefined if env vars are not set.
 */
async function tryInlineCredentials(): Promise<string | undefined> {
	const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
	const privateKey = process.env.GOOGLE_PRIVATE_KEY;
	if (!clientEmail || !privateKey) {
		return undefined;
	}

	const client = new GoogleAuth({
		credentials: {
			client_email: clientEmail,
			// `google-auth-library` requires literal newlines; users often
			// paste keys with escaped `\n` sequences.
			private_key: privateKey.replace(/\\n/g, '\n'),
			...(process.env.GOOGLE_PRIVATE_KEY_ID && {
				private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
			}),
		},
		scopes: [VERTEX_SCOPE],
	});

	try {
		const token = await client.getAccessToken();
		if (!token) {
			return undefined;
		}
		return token as string;
	} catch (err) {
		// Presence of GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY signals explicit
		// user intent. Surface the failure instead of silently falling through
		// to ADC, which would mask a malformed key behind a misleading
		// "no credentials found" error.
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Inline service-account credentials failed: ${message}`);
	}
}

/**
 * Tries Application Default Credentials. Honors `GOOGLE_APPLICATION_CREDENTIALS`
 * if set; otherwise falls back to the default ADC location. Returns undefined
 * (not an error) when ADC fails to resolve, so the chain can surface a single
 * descriptive error at the top level.
 */
async function tryApplicationDefaultCredentials(
	logger: AuthProviderLogger,
): Promise<string | undefined> {
	const client = new GoogleAuth({ scopes: [VERTEX_SCOPE] });
	try {
		const token = await client.getAccessToken();
		if (!token) {
			return undefined;
		}
		return token as string;
	} catch (err) {
		logger.warn('Application Default Credentials failed', err);
		return undefined;
	}
}

/**
 * Reads GCP project and location from settings, falling back to env vars.
 * The setting `authentication.googleVertex.credentials` matches the AWS
 * pattern (`authentication.aws.credentials`).
 */
function readProjectAndLocation(): { project?: string; location?: string } {
	const creds = vscode.workspace
		.getConfiguration('authentication.googleVertex')
		.get<{ GOOGLE_VERTEX_PROJECT?: string; GOOGLE_VERTEX_LOCATION?: string }>(
			'credentials', {}
		);
	return {
		project: creds?.GOOGLE_VERTEX_PROJECT
			|| process.env.GOOGLE_VERTEX_PROJECT
			|| undefined,
		location: creds?.GOOGLE_VERTEX_LOCATION
			|| process.env.GOOGLE_VERTEX_LOCATION
			|| undefined,
	};
}

/**
 * Resolve a Google Vertex credential. Mints a fresh OAuth bearer (inline
 * service-account env vars first, then Application Default Credentials)
 * and bundles it with project + location into a JSON-encoded session
 * payload.
 *
 * The session payload shape lets consumers authenticate from a single
 * `getSession()` call without reading any side-channel settings. Matches
 * how the AWS Bedrock provider returns `{accessKeyId, secretAccessKey,
 * sessionToken}` as JSON.
 *
 * Throws if no credentials resolve, or if project/location are unset.
 */
export async function resolveGoogleVertexCredential(
	logger: AuthProviderLogger = new AuthProviderLogger('Google Vertex AI', log),
): Promise<string> {
	let token = await tryInlineCredentials();
	if (!token) {
		token = await tryApplicationDefaultCredentials(logger);
	}
	if (!token) {
		throw new Error(
			'No Google Vertex AI credentials found. Set GOOGLE_CLIENT_EMAIL ' +
			'and GOOGLE_PRIVATE_KEY for a service account, or run ' +
			'`gcloud auth application-default login` to use Application ' +
			'Default Credentials.'
		);
	}

	const { project, location } = readProjectAndLocation();
	if (!project || !location) {
		throw new Error(
			'Google Vertex AI requires a project and location. Set ' +
			'`authentication.googleVertex.credentials.GOOGLE_VERTEX_PROJECT` ' +
			'and `authentication.googleVertex.credentials.GOOGLE_VERTEX_LOCATION` ' +
			'in settings, or set the `GOOGLE_VERTEX_PROJECT` and ' +
			'`GOOGLE_VERTEX_LOCATION` environment variables.'
		);
	}

	const payload: GoogleVertexCredentialPayload = { token, project, location };
	return JSON.stringify(payload);
}
