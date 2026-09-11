# McpWorkspace


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**workspace_id** | **string** | The workspace\&#39;s ID; supply it again to re-register after a reconnect | [default to undefined]
**token** | **string** | The bearer token agents present to the MCP server. Scoped to this workspace and distinct from the supervisor API token. | [default to undefined]
**port** | **number** | The TCP port the MCP listener is bound to on 127.0.0.1 | [default to undefined]
**url** | **string** | The full MCP endpoint URL agents should connect to. Unique to this workspace, so an agent configured with it can only reach this workspace\&#39;s sessions. | [default to undefined]

## Example

```typescript
import { McpWorkspace } from './api';

const instance: McpWorkspace = {
    workspace_id,
    token,
    port,
    url,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
