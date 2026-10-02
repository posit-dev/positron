/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Mock AWS STS for testing AWS (Bedrock) authentication. Answers the `AssumeRoleWithWebIdentity`
 * call the AWS SDK's web-identity credential provider makes, so the authentication extension's
 * credential chain (`extensions/authentication/src/credentials/aws.ts`) can be exercised without
 * Posit Workbench. Answers with fake credentials by default, or with real credentials -- from an
 * AWS CLI profile (`--profile`) or `MOCK_AWS_*` env vars -- so Bedrock calls succeed after sign-in.
 *
 * It is not part of the shipped product. See README.md for the whole workflow.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

// `scripts/package.json` declares commonjs, so require rather than import; see
// `scripts/mock-policy-server/server.ts`, which does the same.
const http = require('node:http') as typeof import('node:http');
const childProcess = require('node:child_process') as typeof import('node:child_process');

const DEFAULT_PORT = 4599;
const DEFAULT_DURATION_SECONDS = 3600;
const STS_NAMESPACE = 'https://sts.amazonaws.com/doc/2011-06-15/';

interface Credentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken: string;
	expiration: string;
}

interface Args {
	port: number;
	duration: number;
	fail: boolean;
	profile?: string;
}

/** Whether to answer with credentials or an error; `/fail` and `/succeed` flip it while the server runs. */
let failing = false;
/** Number of `AssumeRoleWithWebIdentity` calls answered, so the log can tell one exchange from the next. */
let exchanges = 0;

function parseArgs(argv: string[]): Args {
	const args: Args = { port: DEFAULT_PORT, duration: DEFAULT_DURATION_SECONDS, fail: false };

	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--port': args.port = Number(value); i++; break;
			case '--duration': args.duration = Number(value); i++; break;
			case '--profile': args.profile = value; i++; break;
			case '--fail': args.fail = true; break;
			case '--help':
				console.log('Usage: npm run mock-aws-auth-server -- [--port N] [--duration SECONDS] [--profile AWS_PROFILE] [--fail]');
				process.exit(0);
		}
	}

	return args;
}

/** Distinct fake credentials per exchange. Bedrock rejects them. */
function fakeCredentials(exchange: number, durationSeconds: number): Credentials {
	return {
		accessKeyId: `ASIAMOCK${exchange}`,
		secretAccessKey: `mock-secret-${exchange}`,
		sessionToken: `mock-session-${exchange}`,
		expiration: new Date(Date.now() + durationSeconds * 1000).toISOString(),
	};
}

/**
 * Real credentials handed to the server through the environment, e.g. the output of
 * `aws configure export-credentials --format env` renamed to the `MOCK_AWS_` prefix. The prefix
 * keeps them away from the SDK's own `AWS_*` variables, so the shell that launches Positron
 * can't pick them up and skip web-identity auth. Undefined unless both keys are set.
 */
function envCredentials(env: NodeJS.ProcessEnv, durationSeconds: number): Credentials | undefined {
	const accessKeyId = env.MOCK_AWS_ACCESS_KEY_ID;
	const secretAccessKey = env.MOCK_AWS_SECRET_ACCESS_KEY;
	if (!accessKeyId || !secretAccessKey) {
		return undefined;
	}
	return {
		accessKeyId,
		secretAccessKey,
		sessionToken: env.MOCK_AWS_SESSION_TOKEN ?? '',
		expiration: env.MOCK_AWS_CREDENTIAL_EXPIRATION || new Date(Date.now() + durationSeconds * 1000).toISOString(),
	};
}

/**
 * The profile's current credentials, from the AWS CLI. Fetched on every exchange rather than
 * once at startup, so SSO credentials that expire while the server runs are picked up again
 * (after `aws sso login`) without restarting it. Credentials without an expiration, such as
 * long-term access keys, get `durationSeconds`.
 */
async function profileCredentials(profile: string, durationSeconds: number): Promise<Credentials> {
	const stdout = await new Promise<string>((resolve, reject) => {
		childProcess.execFile(
			'aws', ['configure', 'export-credentials', '--profile', profile, '--format', 'process'],
			(err, out, stderr) => err ? reject(new Error(stderr.trim() || err.message)) : resolve(out),
		);
	});
	const exported = JSON.parse(stdout) as {
		AccessKeyId: string; SecretAccessKey: string; SessionToken?: string; Expiration?: string;
	};
	return {
		accessKeyId: exported.AccessKeyId,
		secretAccessKey: exported.SecretAccessKey,
		sessionToken: exported.SessionToken ?? '',
		expiration: exported.Expiration ?? new Date(Date.now() + durationSeconds * 1000).toISOString(),
	};
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, c => `&#${c.charCodeAt(0)};`);
}

function send(res: ServerResponse, status: number, body: string, contentType: string): void {
	res.writeHead(status, {
		'Content-Type': contentType,
		'Content-Length': Buffer.byteLength(body),
	});
	res.end(body);
}

/** The SDK parses the response as XML and reads only `Credentials` and `AssumedRoleUser`. */
function credentialsDocument(credentials: Credentials, roleArn: string, sessionName: string): string {
	const role = roleArn.split('/').pop() ?? 'role';
	return `<AssumeRoleWithWebIdentityResponse xmlns="${STS_NAMESPACE}">
	<AssumeRoleWithWebIdentityResult>
		<Credentials>
			<AccessKeyId>${escapeXml(credentials.accessKeyId)}</AccessKeyId>
			<SecretAccessKey>${escapeXml(credentials.secretAccessKey)}</SecretAccessKey>
			<SessionToken>${escapeXml(credentials.sessionToken)}</SessionToken>
			<Expiration>${escapeXml(credentials.expiration)}</Expiration>
		</Credentials>
		<AssumedRoleUser>
			<Arn>arn:aws:sts::123456789012:assumed-role/${escapeXml(role)}/${escapeXml(sessionName)}</Arn>
			<AssumedRoleId>AROAMOCK:${escapeXml(sessionName)}</AssumedRoleId>
		</AssumedRoleUser>
	</AssumeRoleWithWebIdentityResult>
	<ResponseMetadata><RequestId>mock-${exchanges}</RequestId></ResponseMetadata>
</AssumeRoleWithWebIdentityResponse>`;
}

/** An STS error document, so the SDK fails the way it does against AWS. */
function errorDocument(code: string, message: string): string {
	return `<ErrorResponse xmlns="${STS_NAMESPACE}">
	<Error>
		<Type>Sender</Type>
		<Code>${code}</Code>
		<Message>${escapeXml(message)}</Message>
	</Error>
	<RequestId>mock-error</RequestId>
</ErrorResponse>`;
}

function log(message: string): void {
	console.log(`${new Date().toLocaleTimeString()} ${message}`);
}

async function assumeRoleWithWebIdentity(params: URLSearchParams, res: ServerResponse, args: Args): Promise<void> {
	const roleArn = params.get('RoleArn') ?? '';
	const sessionName = params.get('RoleSessionName') ?? 'session';
	if (failing) {
		log(`AssumeRoleWithWebIdentity role=${roleArn} -> InvalidIdentityToken`);
		send(res, 400, errorDocument('InvalidIdentityToken', 'Mock server is set to fail; curl /succeed to answer with credentials.'), 'text/xml');
		return;
	}

	let credentials: Credentials;
	try {
		credentials = args.profile
			? await profileCredentials(args.profile, args.duration)
			: envCredentials(process.env, args.duration) ?? fakeCredentials(exchanges + 1, args.duration);
	} catch (err) {
		// Usually an expired SSO session; `aws sso login --profile <profile>` fixes it. A 400
		// rather than a 5xx, so the SDK fails once instead of retrying the same export.
		const message = `could not export credentials for profile ${args.profile}: ${err instanceof Error ? err.message : String(err)}`;
		log(`AssumeRoleWithWebIdentity role=${roleArn} -> ${message}`);
		send(res, 400, errorDocument('AccessDenied', message), 'text/xml');
		return;
	}
	exchanges++;

	log(`AssumeRoleWithWebIdentity #${exchanges} role=${roleArn} -> ${credentials.accessKeyId}, expires ${credentials.expiration}`);
	send(res, 200, credentialsDocument(credentials, roleArn, sessionName), 'text/xml');
}

function handle(req: IncomingMessage, res: ServerResponse, args: Args): void {
	const pathname = (req.url ?? '/').split('?')[0];

	// Switch between answering with credentials and rejecting the token while Positron runs:
	// `curl localhost:4599/fail`
	if (req.method === 'GET' && (pathname === '/fail' || pathname === '/succeed')) {
		failing = pathname === '/fail';
		const message = failing ? 'now rejecting tokens' : 'now answering with credentials';
		log(message);
		send(res, 200, `${message}\n`, 'text/plain');
		return;
	}

	let body = '';
	req.on('data', chunk => body += chunk);
	req.on('end', () => {
		// The SDK sends a form-encoded POST to `/`, e.g.
		// `Action=AssumeRoleWithWebIdentity&RoleArn=...&RoleSessionName=...&WebIdentityToken=...`
		const params = new URLSearchParams(body);
		const action = params.get('Action');
		if (action !== 'AssumeRoleWithWebIdentity') {
			log(`${req.method} ${req.url} unsupported action ${action}`);
			send(res, 400, `no mock for action ${action}\n`, 'text/plain');
			return;
		}
		assumeRoleWithWebIdentity(params, res, args);
	});
}

const args = parseArgs(process.argv.slice(2));
failing = args.fail;

http.createServer((req, res) => handle(req, res, args)).listen(args.port, '127.0.0.1', () => {
	const source = args.profile
		? `credentials from AWS profile ${args.profile}`
		: envCredentials(process.env, args.duration)
			? 'credentials from MOCK_AWS_* env vars'
			: `fake credentials lasting ${args.duration}s`;
	console.log(`Mock AWS auth server on http://localhost:${args.port} (${failing ? 'rejecting tokens' : source})`);
	console.log(`Point the AWS SDK at it with: AWS_ENDPOINT_URL_STS=http://localhost:${args.port}`);
	console.log(`Switch modes with: curl localhost:${args.port}/fail | /succeed`);
});
