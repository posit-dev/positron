/* eslint-disable header/header */

export const kUriScheme = process.env.RS_URI_SCHEME;
export const kSessionUrl = process.env.RS_SESSION_URL ?? '';
export const kServerUrl = process.env.RS_SERVER_URL?.endsWith('/')
	? process.env.RS_SERVER_URL.slice(0, -1)
	: process.env.RS_SERVER_URL;
export const kBaseUrl = process.env.RS_BASE_URL ?? '';
export const kUser = process.env['USER'] || 'rstudio-server';

export const kPositron: boolean = (process.env.POSITRON === '1');

export const kProxyRegex = new RegExp('\/proxy\/[0-9]+[^a-zA-Z](\/)?');

export const kHeartbeatEndpoint = '/heartbeat';
export const kPositronTimeout = process.env.POSITRON_IDLE_TIMEOUT ?? '0';
export const kVsCodeTimeout = process.env.VSCODE_IDLE_TIMEOUT ?? '0';
