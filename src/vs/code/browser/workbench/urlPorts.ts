/* eslint-disable header/header */
/* This code mimicks rstudio-pro server_core/UriPorts to generate port tokens and obscure ports.
 * Any functionality changes need to be accounted for there. Logic regarding 'server ports' has
 * been removed as requests coming from this extension are always 'session ports'.
 *
 * Port transformation is done in order to obscure port values in portmapped URLs. This improves
 * privacy, and makes it more difficult to try to connect to a local service as someone else. The
 * process works as follows:
 *
 * 1. When a proxy is requested for a local server, a port token is generated with 6 random bytes.
 *    The first two form the multiplier, and the last four are the key.
 *
 *    e.g. port-token=a433e59dc087 => multiplier a433, key e59dc087
 *
 * 2. To build an obscured port (for constructing a URL), the 6 bytes of the token are mixed with
 *    the 2 byte port value to create an obscured 4-byte port value, as follows:
 *
 *    a. The port number is sent through a modular multiplicative inverse. This doesn't add any
 *       security; it just obscures common ports in 2-byte space.
 *
 *    b. The 2-byte value is multiplied by the 2-byte multiplier to get a 4-byte value.
 *
 *    c. The 4 byte value is XOR'ed with the key to form the final 4-byte obscured value.
 *
 *    d. A URL is formed using a hex-encoded version of the value and the port token
 *
 *     e.g. /p/58fab3e4a433e59dc087
 *
 * 3. When processing portmapped URLs, the value from the port-token cookie is used to run the
 *    algorithm above in reverse to recover the raw port value.
 *
 * Note that this system is NOT CRYPTOGRAPHICALLY SECURE; in particular, if it's possible to observe
 * many obscured values from the same session, information about that session's token can be
 * inferred. This system is designed only to prevent casual attempts to abuse portmapped URLs by
 * making them user-specific and difficult to predict without prior knowledge. Any web service
 * running on the same host as Posit Workbench should implement best practices for cross-site request
 * forgery (CSRF).
 */

interface SplitToken {
	multiplier: bigint;
	key: bigint;
}

function obscurePort(x: bigint): bigint {
	return (x * BigInt(8854)) % BigInt(65535);
}

function splitToken(token: string): SplitToken | undefined {
	try {
		// split the token into the multiplier and the key
		const multiplier = parseInt(token.slice(0, 4), 16);
		const key = parseInt(token.slice(4), 16);
		return {
			multiplier: BigInt(multiplier),
			key: BigInt(key),
		};
	} catch {
	}
	return undefined;
}

export function transformPort(token: string, port: number): string | undefined {
	const tokenData = splitToken(token);
	if (tokenData) {
		const result: bigint = (obscurePort(BigInt(port)) * tokenData.multiplier) ^ tokenData.key;
		// Mangled ports are always 8 characters - if the number is shorter than that, we need to pad
		// the start with 0s.
		return result.toString(16).padStart(8, '0');
	}
	return undefined;
}
