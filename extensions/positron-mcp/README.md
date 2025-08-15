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

**Via Command Palette:**
1. Open Command Palette (`Cmd/Ctrl+Shift+P`)
2. Run: `Positron MCP: Enable Server`
3. Restart Positron when prompted

**Via Settings:**
1. Open Settings (`Cmd/Ctrl+,`)
2. Set `positron.mcp.enable: true`
3. Restart Positron

### 2. Configure AI Tools

**Claude Desktop:**
```bash
claude mcp add --transport http positron http://localhost:43123
```

**Other MCP clients:**
- Add HTTP transport pointing to `http://localhost:43123`
- Server auto-starts when Positron launches

## Configuration

### Settings

- **`positron.mcp.enable`** (default: `false`) - Enable/disable the MCP server
  - Requires restart when changed
  - Extension only activates when enabled

### Environment Variables

- **`POSITRON_MCP_PORT`** (default: `43123`) - Override server port
  - Must be integer in range [1024, 65535]
  - Example: `export POSITRON_MCP_PORT=45001`

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
│   └── positronApiWrapper.ts # API implementation wrapper
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

- **Localhost only** - Server binds to `127.0.0.1`
- **No arbitrary execution** - Only predefined MCP tools
- **JSON-RPC validation** - All requests validated
- **Development focus** - CORS permissive for local development

## Roadmap

### Phase 1 (Complete ✅)
- [x] Interface-first API design (positronApi.ts)
- [x] Core Runtime APIs implementation
- [x] Code execution tool for running code in active session
- [x] Active document and workspace info tools
- [x] API wrapper for controlled access to Positron features

### Phase 0 (Security - High Priority)
- [ ] Implement permission system with user consent
- [ ] Remove wildcard CORS policy
- [ ] Add audit logging for all operations
- [ ] Security middleware for dangerous operations

### Phase 2 (Extended APIs)
- [ ] Complete window APIs (console, plots, dialogs)
- [ ] Extended editor manipulation APIs
- [ ] Enhanced workspace file operations
- [ ] Session management (switch sessions, list all)

### Phase 3 (Advanced Features)
- [ ] Language services integration
- [ ] AI and chat APIs
- [ ] Connection management
- [ ] Environment APIs
- [ ] Data export tools (variables, plots to various formats)

## Contributing

This extension is part of the Positron project. See the main Positron repository for contribution guidelines.

## License

Licensed under the Elastic License 2.0. See LICENSE.txt in the Positron repository root.