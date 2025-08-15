/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { Request, Response, NextFunction } from 'express';
import { getLogger } from './logger';
import * as crypto from 'crypto';

/**
 * Security configuration for the MCP server
 */
export interface SecurityConfig {
	/** Enable CORS headers (should be restricted to specific origins) */
	enableCors: boolean;
	/** Allowed CORS origins */
	allowedOrigins: string[];
	/** Enable request validation */
	enableRequestValidation: boolean;
	/** Maximum request body size in bytes */
	maxRequestSize: number;
	/** Enable audit logging */
	enableAuditLogging: boolean;
	/** Require user consent for code execution */
	requireUserConsent: boolean;
	/** Enable rate limiting */
	enableRateLimiting: boolean;
	/** Rate limit window in milliseconds */
	rateLimitWindow: number;
	/** Maximum requests per window */
	maxRequestsPerWindow: number;
}

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
	enableCors: true,
	allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*'], // Only localhost by default
	enableRequestValidation: true,
	maxRequestSize: 1024 * 1024, // 1MB
	enableAuditLogging: true,
	requireUserConsent: true,
	enableRateLimiting: true,
	rateLimitWindow: 60000, // 1 minute
	maxRequestsPerWindow: 100
};

/**
 * Security audit event
 */
interface AuditEvent {
	timestamp: string;
	eventType: 'request' | 'execution' | 'consent' | 'error' | 'security';
	method?: string;
	tool?: string;
	origin?: string;
	userAgent?: string;
	requestId: string;
	success: boolean;
	details?: any;
}

/**
 * User consent manager for sensitive operations
 */
export class UserConsentManager {
	private readonly consentCache = new Map<string, boolean>();
	private readonly consentTimeout = 5 * 60 * 1000; // 5 minutes
	private readonly logger = getLogger();
	
	constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * Request user consent for code execution
	 */
	async requestCodeExecutionConsent(languageId: string, code: string): Promise<boolean> {
		const cacheKey = `${languageId}:${crypto.createHash('md5').update(code).digest('hex')}`;
		
		// Check cache first
		const cached = this.consentCache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		// Check if all execution is allowed for this session
		if (await this.isAllCodeExecutionAllowed()) {
			this.consentCache.set(cacheKey, true);
			setTimeout(() => this.consentCache.delete(cacheKey), this.consentTimeout);
			return true;
		}

		// Log the full code for transparency
		this.logger.info('Code Execution Request', `Language: ${languageId}, Lines: ${code.split('\n').length}`);
		this.logger.debug('Code Content', code);
		
		// Create a concise summary of the code
		const codeLines = code.split('\n').length;
		const codePreview = code.length > 100 
			? code.substring(0, 100).replace(/\n/g, ' ') + '...' 
			: code.replace(/\n/g, ' ');

		// First ask if they want to allow this specific execution
		const allowExecution = await positron.window.showSimpleModalDialogPrompt(
			`Execute ${languageId.toUpperCase()} Code?`,
			`AI wants to run ${codeLines} lines of code. Preview: "${codePreview}" (Full code in MCP logs)`,
			'Allow',
			'Deny'
		);

		if (!allowExecution) {
			return false;
		}

		// If they allowed it, ask if they want to allow all for this session
		const allowAllSession = await positron.window.showSimpleModalDialogPrompt(
			'Allow All Code Execution?',
			'Allow all AI code execution this session? (Reset via command palette)',
			'Allow All (This Session)',
			'Just This Once'
		);

		if (allowAllSession) {
			// Store in context for this session
			await this.context.workspaceState.update('mcp.allowAllCodeExecution', true);
		}

		this.consentCache.set(cacheKey, true);
		setTimeout(() => this.consentCache.delete(cacheKey), this.consentTimeout);
		return true;
	}

	/**
	 * Check if all code execution is allowed for this session
	 */
	async isAllCodeExecutionAllowed(): Promise<boolean> {
		return this.context.workspaceState.get<boolean>('mcp.allowAllCodeExecution', false) ?? false;
	}

	/**
	 * Reset consent state
	 */
	async resetConsent(): Promise<void> {
		this.consentCache.clear();
		await this.context.workspaceState.update('mcp.allowAllCodeExecution', undefined);
	}
}

/**
 * Minimal security middleware for the MCP server
 */
export class MinimalSecurityMiddleware {
	private readonly logger = getLogger();
	private readonly auditLog: AuditEvent[] = [];
	private readonly rateLimitMap = new Map<string, number[]>();
	private readonly consentManager: UserConsentManager;
	
	constructor(
		private readonly config: SecurityConfig,
		context: vscode.ExtensionContext
	) {
		this.consentManager = new UserConsentManager(context);
	}

	/**
	 * CORS middleware with restricted origins
	 */
	corsMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
		return (req: Request, res: Response, next: NextFunction) => {
			if (!this.config.enableCors) {
				return next();
			}

			const origin = req.headers.origin || req.headers.referer;
			
			if (origin) {
				// Check if origin matches allowed patterns
				const isAllowed = this.config.allowedOrigins.some(pattern => {
					// Convert wildcard pattern to regex
					const regexPattern = pattern
						.replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
						.replace(/\*/g, '.*'); // Convert * to .*
					const regex = new RegExp(`^${regexPattern}$`);
					return regex.test(origin);
				});

				if (isAllowed) {
					res.setHeader('Access-Control-Allow-Origin', origin);
					res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
					res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
					res.setHeader('Access-Control-Allow-Credentials', 'true');
				} else {
					this.logAuditEvent({
						timestamp: '',
						eventType: 'security',
						method: req.method,
						origin,
						userAgent: req.headers['user-agent'],
						requestId: this.generateRequestId(),
						success: false,
						details: { reason: 'Origin not allowed' }
					});
					this.logger.warn('Security', `Blocked request from unauthorized origin: ${origin}`);
				}
			}
			
			next();
		};
	}

	/**
	 * Request validation middleware
	 */
	requestValidationMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
		return (req: Request, res: Response, next: NextFunction) => {
			if (!this.config.enableRequestValidation) {
				return next();
			}

			const requestId = this.generateRequestId();
			(req as any).requestId = requestId;

			// Check request size
			const contentLength = parseInt(req.headers['content-length'] || '0', 10);
			if (contentLength > this.config.maxRequestSize) {
				this.logAuditEvent({
					timestamp: '',
					eventType: 'security',
					method: req.method,
					origin: req.headers.origin,
					userAgent: req.headers['user-agent'],
					requestId,
					success: false,
					details: { reason: 'Request too large', size: contentLength }
				});
				return res.status(413).json({
					jsonrpc: '2.0',
					error: {
						code: -32600,
						message: 'Request entity too large'
					}
				});
			}

			// Validate JSON-RPC structure for POST requests
			if (req.method === 'POST' && req.path === '/') {
				const body = req.body;
				if (!body || typeof body !== 'object') {
					return res.status(400).json({
						jsonrpc: '2.0',
						error: {
							code: -32700,
							message: 'Parse error'
						}
					});
				}

				if (!body.jsonrpc || body.jsonrpc !== '2.0') {
					return res.status(400).json({
						jsonrpc: '2.0',
						error: {
							code: -32600,
							message: 'Invalid Request - missing or invalid jsonrpc field'
						}
					});
				}

				if (!body.method || typeof body.method !== 'string') {
					return res.status(400).json({
						jsonrpc: '2.0',
						error: {
							code: -32600,
							message: 'Invalid Request - missing or invalid method field'
						}
					});
				}
			}

			next();
		};
	}

	/**
	 * Rate limiting middleware
	 */
	rateLimitMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
		return (req: Request, res: Response, next: NextFunction) => {
			if (!this.config.enableRateLimiting) {
				return next();
			}

			const clientId = this.getClientIdentifier(req);
			const now = Date.now();
			
			// Get existing timestamps for this client
			let timestamps = this.rateLimitMap.get(clientId) || [];
			
			// Remove old timestamps outside the window
			timestamps = timestamps.filter(t => now - t < this.config.rateLimitWindow);
			
			// Check if limit exceeded
			if (timestamps.length >= this.config.maxRequestsPerWindow) {
				this.logAuditEvent({
					timestamp: '',
					eventType: 'security',
					method: req.method,
					origin: req.headers.origin,
					userAgent: req.headers['user-agent'],
					requestId: (req as any).requestId || this.generateRequestId(),
					success: false,
					details: { reason: 'Rate limit exceeded', clientId }
				});
				
				return res.status(429).json({
					jsonrpc: '2.0',
					error: {
						code: -32000,
						message: 'Too many requests'
					}
				});
			}
			
			// Add current timestamp and update map
			timestamps.push(now);
			this.rateLimitMap.set(clientId, timestamps);
			
			next();
		};
	}

	/**
	 * Audit logging for all requests
	 */
	auditLoggingMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
		return (req: Request, res: Response, next: NextFunction) => {
			if (!this.config.enableAuditLogging) {
				return next();
			}

			const requestId = (req as any).requestId || this.generateRequestId();
			const startTime = Date.now();

			// Log request
			this.logAuditEvent({
				timestamp: '',
				eventType: 'request',
				method: req.method,
				origin: req.headers.origin,
				userAgent: req.headers['user-agent'],
				requestId,
				success: true,
				details: {
					path: req.path,
					body: req.body
				}
			});

			// Intercept response
			const originalSend = res.send;
			const self = this;
			res.send = function(data: any) {
				const duration = Date.now() - startTime;
				const statusCode = res.statusCode;
				
				// Log response
				self.logAuditEvent({
					timestamp: '',
					eventType: 'request',
					method: req.method,
					requestId,
					success: statusCode >= 200 && statusCode < 400,
					details: {
						statusCode,
						duration,
						responseSize: data ? data.length : 0
					}
				});

				return originalSend.call(res, data);
			};

			next();
		};
	}

	/**
	 * Check if code execution requires consent
	 */
	async checkCodeExecutionConsent(languageId: string, code: string): Promise<boolean> {
		if (!this.config.requireUserConsent) {
			return true;
		}

		// Check if all execution is allowed
		if (await this.consentManager.isAllCodeExecutionAllowed()) {
			return true;
		}

		// Request specific consent
		return await this.consentManager.requestCodeExecutionConsent(languageId, code);
	}

	/**
	 * Get audit log
	 */
	getAuditLog(): AuditEvent[] {
		return [...this.auditLog];
	}

	/**
	 * Clear audit log
	 */
	clearAuditLog(): void {
		this.auditLog.length = 0;
	}

	/**
	 * Reset all security state
	 */
	async reset(): Promise<void> {
		this.clearAuditLog();
		this.rateLimitMap.clear();
		await this.consentManager.resetConsent();
	}

	private logAuditEvent(event: AuditEvent): void {
		if (!this.config.enableAuditLogging) {
			return;
		}

		event.timestamp = new Date().toISOString();
		this.auditLog.push(event);

		// Keep only last 1000 events
		if (this.auditLog.length > 1000) {
			this.auditLog.shift();
		}

		// Log to extension logger as well
		if (!event.success && event.eventType === 'security') {
			this.logger.warn('Security.Audit', JSON.stringify(event));
		} else {
			this.logger.debug('Security.Audit', JSON.stringify(event));
		}
	}

	private generateRequestId(): string {
		return crypto.randomBytes(8).toString('hex');
	}

	private getClientIdentifier(req: Request): string {
		// Use IP address + user agent as client identifier
		const ip = req.ip || req.socket.remoteAddress || 'unknown';
		const userAgent = req.headers['user-agent'] || 'unknown';
		return `${ip}:${userAgent}`;
	}
}

/**
 * Load security configuration from VS Code settings
 */
export function loadSecurityConfig(): SecurityConfig {
	const config = vscode.workspace.getConfiguration('positron.mcp.security');
	
	return {
		enableCors: config.get<boolean>('enableCors', DEFAULT_SECURITY_CONFIG.enableCors),
		allowedOrigins: config.get<string[]>('allowedOrigins', DEFAULT_SECURITY_CONFIG.allowedOrigins),
		enableRequestValidation: config.get<boolean>('enableRequestValidation', DEFAULT_SECURITY_CONFIG.enableRequestValidation),
		maxRequestSize: config.get<number>('maxRequestSize', DEFAULT_SECURITY_CONFIG.maxRequestSize),
		enableAuditLogging: config.get<boolean>('enableAuditLogging', DEFAULT_SECURITY_CONFIG.enableAuditLogging),
		requireUserConsent: config.get<boolean>('requireUserConsent', DEFAULT_SECURITY_CONFIG.requireUserConsent),
		enableRateLimiting: config.get<boolean>('enableRateLimiting', DEFAULT_SECURITY_CONFIG.enableRateLimiting),
		rateLimitWindow: config.get<number>('rateLimitWindow', DEFAULT_SECURITY_CONFIG.rateLimitWindow),
		maxRequestsPerWindow: config.get<number>('maxRequestsPerWindow', DEFAULT_SECURITY_CONFIG.maxRequestsPerWindow)
	};
}