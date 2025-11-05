import * as os from 'os';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';

import { runCommandNoPty, plainExec } from '../spec-common/commonUtils';
import { requestResolveHeaders } from '../spec-utils/httpRequest';
import { LogLevel } from '../spec-utils/log';
import { isLocalFile, readLocalFile } from '../spec-utils/pfs';
import { CommonParams, OCICollectionRef, OCIRef } from './containerCollectionsOCI';

export type HEADERS = { 'authorization'?: string; 'user-agent'?: string; 'content-type'?: string; 'Accept'?: string; 'content-length'?: string };

interface DockerConfigFile {
	auths: {
		[registry: string]: {
			auth: string;
			identitytoken?: string; // Used by Azure Container Registry
		};
	};
	credHelpers: {
		[registry: string]: string;
	};
	credsStore: string;
}

interface CredentialHelperResult {
	Username: string;
	Secret: string;
}

// WWW-Authenticate Regex
// realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:samalba/my-app:pull,push"
// realm="https://ghcr.io/token",service="ghcr.io",scope="repository:devcontainers/features:pull"
const realmRegex = /realm="([^"]+)"/;
const serviceRegex = /service="([^"]+)"/;
const scopeRegex = /scope="([^"]+)"/;

// https://docs.docker.com/registry/spec/auth/token/#how-to-authenticate
export async function requestEnsureAuthenticated(params: CommonParams, httpOptions: { type: string; url: string; headers: HEADERS; data?: Buffer }, ociRef: OCIRef | OCICollectionRef) {
	// If needed, Initialize the Authorization header cache.
	if (!params.cachedAuthHeader) {
		params.cachedAuthHeader = {};
	}
	const { output, cachedAuthHeader } = params;

	// -- Update headers
	httpOptions.headers['user-agent'] = 'devcontainer';
	// If the user has a cached auth token, attempt to use that first.
	const maybeCachedAuthHeader = cachedAuthHeader[ociRef.registry];
	if (maybeCachedAuthHeader) {
		output.write(`[httpOci] Applying cachedAuthHeader for registry ${ociRef.registry}...`, LogLevel.Trace);
		httpOptions.headers.authorization = maybeCachedAuthHeader;
	}

	const initialAttemptRes = await requestResolveHeaders(httpOptions, output);

	// For anything except a 401 (invalid/no token) or 403 (insufficient scope)
	// response simply return the original response to the caller.
	if (initialAttemptRes.statusCode !== 401 && initialAttemptRes.statusCode !== 403) {
		output.write(`[httpOci] ${initialAttemptRes.statusCode} (${maybeCachedAuthHeader ? 'Cached' : 'NoAuth'}): ${httpOptions.url}`, LogLevel.Trace);
		return initialAttemptRes;
	}

	// -- 'responseAttempt' status code was 401 or 403 at this point.

	// Attempt to authenticate via WWW-Authenticate Header.
	const wwwAuthenticate = initialAttemptRes.resHeaders['WWW-Authenticate'] || initialAttemptRes.resHeaders['www-authenticate'];
	if (!wwwAuthenticate) {
		output.write(`[httpOci] ERR: Server did not provide instructions to authentiate! (Required: A 'WWW-Authenticate' Header)`, LogLevel.Error);
		return;
	}

	const authenticationMethod = wwwAuthenticate.split(' ')[0];
	switch (authenticationMethod.toLowerCase()) {
		// Basic realm="localhost"
		case 'basic':

			output.write(`[httpOci] Attempting to authenticate via 'Basic' auth.`, LogLevel.Trace);

			const credential = await getCredential(params, ociRef);
			const basicAuthCredential = credential?.base64EncodedCredential;
			if (!basicAuthCredential) {
				output.write(`[httpOci] ERR: No basic auth credentials to send for registry service '${ociRef.registry}'`, LogLevel.Error);
				return;
			}

			httpOptions.headers.authorization = `Basic ${basicAuthCredential}`;
			break;

		// Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:samalba/my-app:pull,push"
		case 'bearer':

			output.write(`[httpOci] Attempting to authenticate via 'Bearer' auth.`, LogLevel.Trace);

			const realmGroup = realmRegex.exec(wwwAuthenticate);
			const serviceGroup = serviceRegex.exec(wwwAuthenticate);
			const scopeGroup = scopeRegex.exec(wwwAuthenticate);

			if (!realmGroup || !serviceGroup) {
				output.write(`[httpOci] WWW-Authenticate header is not in expected format. Got:  ${wwwAuthenticate}`, LogLevel.Trace);
				return;
			}

			const wwwAuthenticateData = {
				realm: realmGroup[1],
				service: serviceGroup[1],
				scope: scopeGroup ? scopeGroup[1] : '',
			};

			const bearerToken = await fetchRegistryBearerToken(params, ociRef, wwwAuthenticateData);
			if (!bearerToken) {
				output.write(`[httpOci] ERR: Failed to fetch Bearer token from registry.`, LogLevel.Error);
				return;
			}

			httpOptions.headers.authorization = `Bearer ${bearerToken}`;
			break;

		default:
			output.write(`[httpOci] ERR: Unsupported authentication mode '${authenticationMethod}'`, LogLevel.Error);
			return;
	}

	// Retry the request with the updated authorization header.
	const reattemptRes = await requestResolveHeaders(httpOptions, output);
	output.write(`[httpOci] ${reattemptRes.statusCode} on reattempt after auth: ${httpOptions.url}`, LogLevel.Trace);

	// Cache the auth header if the request did not result in an unauthorized response.
	if (reattemptRes.statusCode !== 401) {
		params.cachedAuthHeader[ociRef.registry] = httpOptions.headers.authorization;
	}

	return reattemptRes;
}

// Attempts to get the Basic auth credentials for the provided registry.
// This credential is used to offer the registry in exchange for a Bearer token.
// These may be:
//   - parsed out of a special DEVCONTAINERS_OCI_AUTH environment variable
//   - Read from a docker credential helper (https://docs.docker.com/engine/reference/commandline/login/#credentials-store)
//   - Read from a docker config file
//   - Crafted from the GITHUB_TOKEN environment variable
//  Returns:
//   - undefined: No credential was found.
//   - object:    A credential was found.
// 					- based64EncodedCredential: The base64 encoded credential, if any.
// 					- refreshToken: The refresh token, if any.
async function getCredential(params: CommonParams, ociRef: OCIRef | OCICollectionRef): Promise<{ base64EncodedCredential: string | undefined; refreshToken: string | undefined } | undefined> {
	const { output, env } = params;
	const { registry } = ociRef;

	if (!!env['DEVCONTAINERS_OCI_AUTH']) {
		// eg: DEVCONTAINERS_OCI_AUTH=service1|user1|token1,service2|user2|token2
		const authContexts = env['DEVCONTAINERS_OCI_AUTH'].split(',');
		const authContext = authContexts.find(a => a.split('|')[0] === registry);

		if (authContext) {
			output.write(`[httpOci] Using match from DEVCONTAINERS_OCI_AUTH for registry '${registry}'`, LogLevel.Trace);
			const split = authContext.split('|');
			const userToken = `${split[1]}:${split[2]}`;
			return {
				base64EncodedCredential: Buffer.from(userToken).toString('base64'),
				refreshToken: undefined,
			};
		}
	}

	// Attempt to use the docker config file or available credential helper(s).
	const credentialFromDockerConfig = await getCredentialFromDockerConfigOrCredentialHelper(params, registry);
	if (credentialFromDockerConfig) {
		return credentialFromDockerConfig;
	}

	const githubToken = env['GITHUB_TOKEN'];
	const githubHost = env['GITHUB_HOST'];
	if (githubHost) {
		output.write(`[httpOci] Environment GITHUB_HOST is set to '${githubHost}'`, LogLevel.Trace);
	}
	if (registry === 'ghcr.io' && githubToken && (!githubHost || githubHost === 'github.com')) {
		output.write('[httpOci] Using environment GITHUB_TOKEN for auth', LogLevel.Trace);
		const userToken = `USERNAME:${env['GITHUB_TOKEN']}`;
		return {
			base64EncodedCredential: Buffer.from(userToken).toString('base64'),
			refreshToken: undefined,
		};
	}

	// Represents anonymous access.
	output.write(`[httpOci] No authentication credentials found for registry '${registry}'. Accessing anonymously.`, LogLevel.Trace);
	return;
}

async function existsInPath(filename: string): Promise<boolean> {
	if (!process.env.PATH) {
		return false;
	}
	const paths = process.env.PATH.split(':');
	for (const path of paths) {
		const fullPath = `${path}/${filename}`;
		if (await isLocalFile(fullPath)) {
			return true;
		}
	}
	return false;
}

async function getCredentialFromDockerConfigOrCredentialHelper(params: CommonParams, registry: string) {
	const { output } = params;

	let configContainsAuth = false;
	try {
		// https://docs.docker.com/engine/reference/commandline/cli/#change-the-docker-directory
		const customDockerConfigPath = process.env.DOCKER_CONFIG;
		if (customDockerConfigPath) {
			output.write(`[httpOci] Environment DOCKER_CONFIG is set to '${customDockerConfigPath}'`, LogLevel.Trace);
		}
		const dockerConfigRootDir = customDockerConfigPath || path.join(os.homedir(), '.docker');
		const dockerConfigFilePath = path.join(dockerConfigRootDir, 'config.json');
		if (await isLocalFile(dockerConfigFilePath)) {
			const dockerConfig: DockerConfigFile = jsonc.parse((await readLocalFile(dockerConfigFilePath)).toString());

			configContainsAuth = Object.keys(dockerConfig.credHelpers || {}).length > 0 || !!dockerConfig.credsStore || Object.keys(dockerConfig.auths || {}).length > 0;
			// https://docs.docker.com/engine/reference/commandline/login/#credential-helpers
			if (dockerConfig.credHelpers && dockerConfig.credHelpers[registry]) {
				const credHelper = dockerConfig.credHelpers[registry];
				output.write(`[httpOci] Found credential helper '${credHelper}' in '${dockerConfigFilePath}' registry '${registry}'`, LogLevel.Trace);
				const auth = await getCredentialFromHelper(params, registry, credHelper);
				if (auth) {
					return auth;
				}
			// https://docs.docker.com/engine/reference/commandline/login/#credentials-store
			} else if (dockerConfig.credsStore) {
				output.write(`[httpOci] Invoking credsStore credential helper '${dockerConfig.credsStore}'`, LogLevel.Trace);
				const auth = await getCredentialFromHelper(params, registry, dockerConfig.credsStore);
				if (auth) {
					return auth;
				}
			}
			if (dockerConfig.auths && dockerConfig.auths[registry]) {
				output.write(`[httpOci] Found auths entry in '${dockerConfigFilePath}' for registry '${registry}'`, LogLevel.Trace);
				const auth = dockerConfig.auths[registry].auth;
				const identityToken = dockerConfig.auths[registry].identitytoken; // Refresh token, seen when running: 'az acr login -n <registry>'

				if (identityToken) {
					return {
						refreshToken: identityToken,
						base64EncodedCredential: undefined,
					};
				}

				// Without the presence of an `identityToken`, assume auth is a base64-encoded 'user:token'.
				return {
					base64EncodedCredential: auth,
					refreshToken: undefined,
				};
			}
		}
	} catch (err) {
		output.write(`[httpOci] Failed to read docker config.json: ${err}`, LogLevel.Trace);
		return;
	}

	if (!configContainsAuth) {
		let defaultCredHelper = '';
		// Try platform-specific default credential helper
		if (process.platform === 'linux') {
			if (await existsInPath('pass')) {
				defaultCredHelper = 'pass';
			} else {
				defaultCredHelper = 'secret';
			}
		} else if (process.platform === 'win32') {
			defaultCredHelper = 'wincred';
		} else if (process.platform === 'darwin') {
			defaultCredHelper = 'osxkeychain';
		}
		if (defaultCredHelper !== '') {
			output.write(`[httpOci] Invoking platform default credential helper '${defaultCredHelper}'`, LogLevel.Trace);
			const auth = await getCredentialFromHelper(params, registry, defaultCredHelper);
			if (auth) {
				output.write('[httpOci] Found auth from platform default credential helper', LogLevel.Trace);
				return auth;
			}
		}
	}

	// No auth found from docker config or credential helper.
	output.write(`[httpOci] No authentication credentials found for registry '${registry}' via docker config or credential helper.`, LogLevel.Trace);
	return;
}

async function getCredentialFromHelper(params: CommonParams, registry: string, credHelperName: string): Promise<{ base64EncodedCredential: string | undefined; refreshToken: string | undefined } | undefined> {
	const { output } = params;

	let helperOutput: Buffer;
	try {
		const { stdout } = await runCommandNoPty({
			exec: plainExec(undefined),
			cmd: 'docker-credential-' + credHelperName,
			args: ['get'],
			stdin: Buffer.from(registry, 'utf-8'),
			output,
		});
		helperOutput = stdout;
	} catch (err) {
		output.write(`[httpOci] Failed to query for '${registry}' credential from 'docker-credential-${credHelperName}': ${err}`, LogLevel.Trace);
		return undefined;
	}
	if (helperOutput.length === 0) {
		return undefined;
	}

	let errors: jsonc.ParseError[] = [];
	const creds: CredentialHelperResult = jsonc.parse(helperOutput.toString(), errors);
	if (errors.length !== 0) {
		output.write(`[httpOci] Credential helper ${credHelperName} returned non-JSON response "${helperOutput.toString()}" for registry '${registry}'`, LogLevel.Warning);
		return undefined;
	}

	if (creds.Username === '<token>') {
		return {
			refreshToken: creds.Secret,
			base64EncodedCredential: undefined,
		};
	}
	const userToken = `${creds.Username}:${creds.Secret}`;
	return {
		base64EncodedCredential: Buffer.from(userToken).toString('base64'),
		refreshToken: undefined,
	};
}

// https://docs.docker.com/registry/spec/auth/token/#requesting-a-token
async function fetchRegistryBearerToken(params: CommonParams, ociRef: OCIRef | OCICollectionRef, wwwAuthenticateData: { realm: string; service: string; scope: string }): Promise<string | undefined> {
	const { output } = params;
	const { realm, service, scope } = wwwAuthenticateData;

	// TODO: Remove this.
	if (realm.includes('mcr.microsoft.com')) {
		return undefined;
	}

	const headers: HEADERS = {
		'user-agent': 'devcontainer'
	};

	// The token server should first attempt to authenticate the client using any authentication credentials provided with the request.
	// From Docker 1.11 the Docker engine supports both Basic Authentication and OAuth2 for getting tokens. 
	// Docker 1.10 and before, the registry client in the Docker Engine only supports Basic Authentication. 
	// If an attempt to authenticate to the token server fails, the token server should return a 401 Unauthorized response 
	// indicating that the provided credentials are invalid.
	// > https://docs.docker.com/registry/spec/auth/token/#requesting-a-token
	const userCredential = await getCredential(params, ociRef);
	const basicAuthCredential = userCredential?.base64EncodedCredential;
	const refreshToken = userCredential?.refreshToken;

	let httpOptions: { type: string; url: string; headers: Record<string, string>; data?: Buffer };

	// There are several different ways registries expect to handle the oauth token exchange. 
	// Depending on the type of credential available, use the most reasonable method.
	if (refreshToken) {
		const form_url_encoded = new URLSearchParams();
		form_url_encoded.append('client_id', 'devcontainer');
		form_url_encoded.append('grant_type', 'refresh_token');
		form_url_encoded.append('service', service);
		form_url_encoded.append('scope', scope);
		form_url_encoded.append('refresh_token', refreshToken);

		headers['content-type'] = 'application/x-www-form-urlencoded';

		const url = realm;
		output.write(`[httpOci] Attempting to fetch bearer token from:  ${url}`, LogLevel.Trace);

		httpOptions = {
			type: 'POST',
			url,
			headers: headers,
			data: Buffer.from(form_url_encoded.toString())
		};
	} else {
		if (basicAuthCredential) {
			headers['authorization'] = `Basic ${basicAuthCredential}`;
		}

		// realm="https://auth.docker.io/token"
		// service="registry.docker.io"
		// scope="repository:samalba/my-app:pull,push"
		// Example:
		// https://auth.docker.io/token?service=registry.docker.io&scope=repository:samalba/my-app:pull,push
		const url = `${realm}?service=${service}&scope=${scope}`;
		output.write(`[httpOci] Attempting to fetch bearer token from:  ${url}`, LogLevel.Trace);

		httpOptions = {
			type: 'GET',
			url: url,
			headers: headers,
		};
	}

	let res = await requestResolveHeaders(httpOptions, output);
	if (res && res.statusCode === 401 || res.statusCode === 403) {
		output.write(`[httpOci] ${res.statusCode}: Credentials for '${service}' may be expired. Attempting request anonymously.`, LogLevel.Info);
		const body = res.resBody?.toString();
		if (body) {
			output.write(`${res.resBody.toString()}.`, LogLevel.Info);
		}

		// Try again without user credentials. If we're here, their creds are likely expired.
		delete headers['authorization'];
		res = await requestResolveHeaders(httpOptions, output);
	}

	if (!res || res.statusCode > 299 || !res.resBody) {
		output.write(`[httpOci] ${res.statusCode}: Failed to fetch bearer token for '${service}': ${res.resBody.toString()}`, LogLevel.Error);
		return;
	}

	let scopeToken: string | undefined;
	try {
		const json = JSON.parse(res.resBody.toString());
		scopeToken = json.token || json.access_token; // ghcr uses 'token', acr uses 'access_token'
	} catch {
		// not JSON
	}
	if (!scopeToken) {
		output.write(`[httpOci] Unexpected bearer token response format for '${service}: ${res.resBody.toString()}'`, LogLevel.Error);
		return;
	}

	return scopeToken;
}