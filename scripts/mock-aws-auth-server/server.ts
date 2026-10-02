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
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');

const DEFAULT_PORT = 4599;
const DEFAULT_DURATION_SECONDS = 3600;
const DEFAULT_TOKEN_FILE = '/tmp/mock-aws-auth/id_token';
/** Prefix of every token this server writes, so it only ever deletes a token file it wrote. */
const TOKEN_PREFIX = 'mock-token-';
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
	/** Whether `--duration` was passed, in which case it overrides real credentials' expiration too. */
	durationSet: boolean;
	fail: boolean;
	profile?: string;
	tokenFile: string;
}

/** Whether to answer with credentials or an error; `/fail` and `/succeed` flip it while the server runs. */
let failing = false;
/** Number of `AssumeRoleWithWebIdentity` calls answered, so the log can tell one exchange from the next. */
let exchanges = 0;
/** Number of times the token file was written, so each write has distinct content. */
let tokenWrites = 0;

function parseArgs(argv: string[]): Args {
	const args: Args = { port: DEFAULT_PORT, duration: DEFAULT_DURATION_SECONDS, durationSet: false, fail: false, tokenFile: DEFAULT_TOKEN_FILE };

	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--port': args.port = Number(value); i++; break;
			case '--duration': args.duration = Number(value); args.durationSet = true; i++; break;
			case '--profile': args.profile = value; i++; break;
			case '--token-file': args.tokenFile = path.resolve(value); i++; break;
			case '--fail': args.fail = true; break;
			case '--help':
				console.log('Usage: npm run mock-aws-auth-server -- [--port N] [--duration SECONDS] [--profile AWS_PROFILE] [--token-file PATH] [--fail]');
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

/**
 * The token as it appears in the log: in full for one this server wrote, so a rotated token can be
 * told apart from the one before it, and only by length otherwise, since a real token is a secret.
 */
function describeToken(token: string): string {
	return token.startsWith(TOKEN_PREFIX) ? token.trim() : `<${token.length} chars>`;
}

function log(message: string): void {
	console.log(`${new Date().toLocaleTimeString()} ${message}`);
}

async function assumeRoleWithWebIdentity(params: URLSearchParams, res: ServerResponse, args: Args): Promise<void> {
	const roleArn = params.get('RoleArn') ?? '';
	const sessionName = params.get('RoleSessionName') ?? 'session';
	const token = describeToken(params.get('WebIdentityToken') ?? '');
	if (failing) {
		log(`AssumeRoleWithWebIdentity role=${roleArn} token=${token} -> InvalidIdentityToken`);
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
		log(`AssumeRoleWithWebIdentity role=${roleArn} token=${token} -> ${message}`);
		send(res, 400, errorDocument('AccessDenied', message), 'text/xml');
		return;
	}
	exchanges++;

	// Real credentials often last hours, too long to wait for Positron's expiry refresh. Reporting
	// an earlier expiration than the real one is harmless: Positron only exchanges again sooner.
	if (args.durationSet) {
		credentials = { ...credentials, expiration: new Date(Date.now() + args.duration * 1000).toISOString() };
	}

	log(`AssumeRoleWithWebIdentity #${exchanges} role=${roleArn} token=${token} -> ${credentials.accessKeyId}, expires ${credentials.expiration}`);
	send(res, 200, credentialsDocument(credentials, roleArn, sessionName), 'text/xml');
}

/**
 * Write the web-identity token file, standing in for the Posit Workbench session agent. The SDK
 * reads this file and sends its content to this server, which accepts any token. Positron's token
 * file watcher picks up the write and retries a failed sign-in; held credentials are not
 * exchanged again.
 */
function writeToken(tokenFile: string): string {
	tokenWrites++;
	fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
	fs.writeFileSync(tokenFile, `${TOKEN_PREFIX}${tokenWrites}\n`);
	return `wrote token #${tokenWrites} to ${tokenFile}`;
}

/**
 * Remove a token file left by an earlier run, so Positron starts out without one: the state
 * posit-dev/positron#15292 recovers from. A file this server did not write is left alone.
 */
function removeStaleToken(tokenFile: string): void {
	let content: string;
	try {
		content = fs.readFileSync(tokenFile, 'utf8');
	} catch {
		return;
	}
	if (content.startsWith(TOKEN_PREFIX)) {
		fs.rmSync(tokenFile);
		// Remove the folder too when nothing else is in it: a missing folder is the harder case
		// for Positron's watcher, and the one Workbench starts in.
		try {
			fs.rmdirSync(path.dirname(tokenFile));
		} catch {
			// Not empty; leave it.
		}
		console.log(`Removed the token file from an earlier run: ${tokenFile}`);
	} else {
		console.log(`Warning: ${tokenFile} exists and was not written by this server; leaving it in place.`);
	}
}

function handle(req: IncomingMessage, res: ServerResponse, args: Args): void {
	const pathname = (req.url ?? '/').split('?')[0];

	// Write (or rewrite) the token file, as the Workbench session agent does:
	// `curl localhost:4599/token`
	if (req.method === 'GET' && pathname === '/token') {
		const message = writeToken(args.tokenFile);
		log(message);
		send(res, 200, `${message}\n`, 'text/plain');
		return;
	}

	// Switch between answering with credentials and rejecting the token while Positron runs:
	// `curl localhost:4599/fail`. `/succeed` also rewrites the token file, since a newer token
	// is what makes Positron retry a failed sign-in; without it, Positron never asks again.
	if (req.method === 'GET' && (pathname === '/fail' || pathname === '/succeed')) {
		failing = pathname === '/fail';
		const message = failing
			? 'now rejecting tokens'
			: `now answering with credentials; ${writeToken(args.tokenFile)}`;
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

// `eval "$(aws configure export-credentials ...)"` exports nothing when the export fails (an
// expired SSO session, say), which leaves the MOCK_AWS_* vars set but empty. Falling back to
// fake credentials then looks like a sign-in that Bedrock rejects, so refuse to start instead.
if (!args.profile && process.env.MOCK_AWS_ACCESS_KEY_ID !== undefined && !envCredentials(process.env, args.duration)) {
	console.error('MOCK_AWS_ACCESS_KEY_ID is set but MOCK_AWS_ACCESS_KEY_ID or MOCK_AWS_SECRET_ACCESS_KEY is empty.');
	console.error('Check that `aws configure export-credentials --profile <profile>` works (run `aws sso login` if needed).');
	process.exit(1);
}

removeStaleToken(args.tokenFile);

http.createServer((req, res) => handle(req, res, args)).listen(args.port, '127.0.0.1', () => {
	const real = args.profile || envCredentials(process.env, args.duration);
	const lifetime = args.durationSet || !real ? `expiring after ${args.duration}s` : 'with their real expiration';
	const source = args.profile
		? `credentials from AWS profile ${args.profile}, ${lifetime}`
		: real
			? `credentials from MOCK_AWS_* env vars, ${lifetime}`
			: `fake credentials, ${lifetime}`;
	console.log(`Mock AWS auth server on http://localhost:${args.port} (${failing ? 'rejecting tokens' : source})`);
	console.log('');
	console.log('Launch Positron from another terminal with:');
	console.log(`  export AWS_WEB_IDENTITY_TOKEN_FILE=${args.tokenFile}`);
	console.log('  export AWS_ROLE_ARN=arn:aws:iam::123456789012:role/bedrock');
	console.log(`  export AWS_ENDPOINT_URL_STS=http://localhost:${args.port}`);
	console.log('  export AWS_REGION=us-east-1   # a region where your credentials have Bedrock access');
	console.log('  unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN');
	console.log('  export AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null');
	console.log('  ./scripts/code.sh --log positron.authentication:debug');
	console.log('');
	console.log(`Then write the token, as Workbench would: curl localhost:${args.port}/token`);
	console.log(`Switch modes with: curl localhost:${args.port}/fail | /succeed (also rewrites the token)`);
});
