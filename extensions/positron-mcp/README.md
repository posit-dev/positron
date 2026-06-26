# Positron MCP Server Extension

A VS Code extension that provides a local HTTP server implementing the Model Context Protocol (MCP) for Positron data science features.

## Overview

This extension exposes Positron's runtime sessions and variable data through a simple HTTP API that follows the MCP (Model Context Protocol) standard. It enables AI tools like Claude Desktop to directly access your active data science sessions.

## Features

### Available MCP Tools

- **`execute-code`** - Execute code in active runtime sessions (Python, R, JavaScript, TypeScript)
- **`get-active-document`** - Get information about the currently active document
- **`get-workspace-info`** - Get comprehensive workspace information including folders and runtime sessions
- **`foreground-session`** - Returns information about the active runtime session (R, Python, etc.)
- **`get-variables`** - Returns all variables from the active session with their types, values, and metadata
- **`get-time`** - Returns current ISO timestamp

### Key Benefits

- ✅ **Direct API access** - Uses `positron.runtime` API for real-time data
- ✅ **No IPC complexity** - Runs in same process as Positron UI
- ✅ **Standard protocol** - Implements MCP 2024-11-05 specification
- ✅ **Easy integration** - Works with Claude Desktop and other MCP clients

## Installation & Setup

### 1. Enable the Extension

**Via Command Palette (Recommended):**
1. Open Command Palette (`Cmd/Ctrl+Shift+P`)
2. Run: `Positron MCP: Enable Server`
3. Choose whether to enable the server via interactive prompts
4. Optionally create/update `.mcp.json` configuration file
5. Restart Positron when prompted

**Via Settings:**
1. Open Settings (`Cmd/Ctrl+,`)
2. Set `positron.mcp.enable: true`
3. Restart Positron

### 2. Disable the Extension

**Via Command Palette:**
1. Open Command Palette (`Cmd/Ctrl+Shift+P`)
2. Run: `Positron MCP: Disable Server`
3. Confirm via interactive prompt
4. Server stops immediately (no restart required)

### 3. Configure AI Tools

**Claude Desktop:**
```bash
claude mcp add --transport http positron http://localhost:43123
```

**Other MCP clients:**
- Add HTTP transport pointing to `http://localhost:43123`
- Server auto-starts when Positron launches (if enabled)

## Configuration

### Core Settings

- **`positron.mcp.enable`** (default: `false`) - Enable/disable the MCP server
  - Requires restart when enabling
  - Can be disabled without restart via command
- **`positron.mcp.logLevel`** (default: `info`) - Set logging verbosity
  - Options: `off`, `error`, `warning`, `info`, `debug`, `trace`

### Security Settings

- **`positron.mcp.security.enableCors`** (default: `true`) - Enable CORS headers
- **`positron.mcp.security.allowedOrigins`** (default: `["http://localhost:*", "http://127.0.0.1:*"]`) - Allowed CORS origins
- **`positron.mcp.security.requireUserConsent`** (default: `true`) - Require user consent for code execution
- **`positron.mcp.security.enableAuditLogging`** (default: `true`) - Enable security audit logging
- **`positron.mcp.security.enableRateLimiting`** (default: `true`) - Enable rate limiting
- **`positron.mcp.security.maxRequestsPerWindow`** (default: `100`) - Max requests per rate limit window
- **`positron.mcp.security.rateLimitWindow`** (default: `60000`) - Rate limit window in milliseconds

### Environment Variables

- **`POSITRON_MCP_PORT`** (default: `43123`) - Override server port
  - Must be integer in range [1024, 65535]
  - Example: `export POSITRON_MCP_PORT=45001`

## Available Commands

The extension provides the following commands via the Command Palette:

- **`Positron MCP: Enable Server`** - Enable the MCP server with interactive setup
  - Asks for confirmation before enabling
  - Optionally creates/updates `.mcp.json` configuration
  - Requires restart to take effect

- **`Positron MCP: Disable Server`** - Disable the MCP server immediately
  - Asks for confirmation before disabling
  - Stops server without requiring restart
  - Updates configuration to persist disabled state

- **`Positron MCP: Show Logs`** - Display MCP server logs in output panel
  - Useful for debugging connection issues
  - Shows detailed request/response data based on log level

- **`Positron MCP: Reset Code Execution Consent`** - Clear stored consent decisions
  - Resets all remembered consent choices
  - You'll be prompted again for future code execution requests

- **`Positron MCP: Show Security Audit Log`** - View security audit trail
  - Opens webview with formatted audit log
  - Shows all MCP requests and security events
  - Includes timestamps, methods, and results

- **`Positron MCP: Clear Security Audit Log`** - Clear the audit log
  - Asks for confirmation before clearing
  - Cannot be undone

## Usage Examples

### Test Server Health

```bash
curl http://localhost:43123/health
```

### List Available Tools

```bash
curl -X POST http://localhost:43123 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Get Session Information

```bash
curl -X POST http://localhost:43123 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"foreground-session"}}'
```

### Get Variables (requires active session)

```bash
curl -X POST http://localhost:43123 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get-variables"}}'
```

## Architecture

### Extension Design

- **Process**: Runs in renderer/browser process (same as other Positron extensions)
- **HTTP Server**: Express.js server (same pattern as `positron-proxy`)
- **Data Access**: Direct `positron.runtime` API calls
- **Protocol**: MCP 2024-11-05 over HTTP POST

### Data Flow

```
AI Tool → HTTP Request → Extension → positron.runtime API → Direct Response
```

No IPC complexity, no service injection - just simple API calls!

### File Structure

```
extensions/positron-mcp/
├── src/
│   ├── extension.ts           # Extension activation & commands
│   ├── mcpServer.ts          # HTTP server implementation
│   ├── positronApi.ts        # API interface definitions
│   ├── positronApiWrapper.ts # API implementation wrapper
│   ├── security.positron.ts  # Security middleware and configuration
│   └── logger.ts             # Logging utility with configurable levels
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## MCP Protocol Details

### Supported Methods

#### `initialize`
Returns server capabilities and version info:
```json
{
  "protocolVersion": "2024-11-05",
  "capabilities": { "tools": {} },
  "serverInfo": { "name": "positron-mcp-server", "version": "1.0.0" }
}
```

#### `tools/list`
Returns available tools with schemas:
```json
{
  "tools": [
    { "name": "get-time", "description": "Get current time in ISO format" },
    { "name": "foreground-session", "description": "Get active runtime session info" },
    { "name": "get-variables", "description": "Get variables from active session" }
  ]
}
```

#### `tools/call`
Executes specified tool with parameters.

### Response Format

All responses follow JSON-RPC 2.0 format with MCP content structure:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "{\"key\": \"value\"}" }
    ]
  }
}
```

## Troubleshooting

### Extension Not Loading

- ✅ Check that `positron.mcp.enable` is `true` in settings
- ✅ Restart Positron after enabling
- ✅ Check Developer Tools console for extension errors

### Server Not Starting

- **Port in use**: Change `POSITRON_MCP_PORT` environment variable
- **Permission denied**: Ensure port is >= 1024
- **Check logs**: Look in Developer Tools console for errors

### Variables Not Returning

- ✅ Ensure a runtime session is active (start R or Python console)
- ✅ Run some code to create variables first
- ✅ Check that session is in foreground (active tab)

### CORS Issues

- Server sets permissive CORS headers for development
- Only accepts POST requests with `Content-Type: application/json`
- All origins allowed (`Access-Control-Allow-Origin: *`)

## Development

### Building

```bash
npm install
npm run compile
```

### File Watching

```bash
npm run watch
```

### Extension Architecture

The extension follows standard VS Code extension patterns:

1. **Activation** - Triggered when `positron.mcp.enable` is true
2. **Server Setup** - Creates Express server with MCP endpoints
3. **API Integration** - Uses `positron.runtime` for data access
4. **Lifecycle** - Manages server start/stop with extension

## Security

### Built-in Security Features

- **Localhost only** - Server binds to `127.0.0.1` for local access only
- **User consent** - Requires explicit approval for code execution (configurable)
- **Rate limiting** - Prevents abuse with configurable request limits
- **Audit logging** - Tracks all operations with detailed security events
- **CORS protection** - Restricts origins to localhost by default
- **Request validation** - Validates JSON-RPC format and size limits
- **Session control** - Code execution limited to active runtime sessions

### Security Commands

- View audit log: `Positron MCP: Show Security Audit Log`
- Clear audit log: `Positron MCP: Clear Security Audit Log`
- Reset consent: `Positron MCP: Reset Code Execution Consent`

### Security Configuration

All security features can be configured in settings:
- Enable/disable CORS, rate limiting, audit logging
- Configure allowed origins and request limits
- Toggle user consent requirements

## Roadmap

### Phase 0 (Security - Complete ✅)
- [x] Implement permission system with user consent
- [x] Configure CORS policy with localhost restrictions
- [x] Add audit logging for all operations
- [x] Security middleware for dangerous operations
- [x] Rate limiting to prevent abuse
- [x] Request validation and size limits
- [x] Security configuration options

### Phase 1 (Core Features - Complete ✅)
- [x] Interface-first API design (positronApi.ts)
- [x] Core Runtime APIs implementation
- [x] Code execution tool for running code in active session
- [x] Active document and workspace info tools
- [x] API wrapper for controlled access to Positron features
- [x] Interactive enable/disable commands with quickPick dialogs
- [x] Automatic `.mcp.json` configuration file management

### Phase 2 (Extended APIs)
- [ ] Complete window APIs (console, plots, dialogs)
- [ ] Extended editor manipulation APIs
- [ ] Enhanced workspace file operations
- [ ] Session management (switch sessions, list all)

### Phase 3 (Advanced Features)
- [ ] Language services integration
- [ ] Connection management
- [ ] Environment APIs
- [ ] Data export tools (variables, plots to various formats)

## Contributing

This extension is part of the Positron project. See the main Positron repository for contribution guidelines.

## License

Licensed under the Elastic License 2.0. See LICENSE.txt in the Positron repository root.
