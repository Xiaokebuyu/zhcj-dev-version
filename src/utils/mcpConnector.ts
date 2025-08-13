import { Client, WebSocketClientTransport } from 'mcp';

export interface MCPConnectorConfig {
  name: string;
  url: string;
  apiKey?: string;
}

/**
 * Connector for a single remote MCP service. Handles connection lifecycle
 * and exposes tool discovery and invocation helpers.
 */
export class MCPConnector {
  private client: any;
  private tools: any[] = [];
  private connected = false;
  private connecting: Promise<void> | null = null;

  constructor(private config: MCPConnectorConfig) {}

  async connect() {
    await this.ensureConnection();
  }

  private async ensureConnection() {
    if (this.connected) return;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const transport = new WebSocketClientTransport(this.config.url, {
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
      });
      this.client = new Client(transport);
      await this.client.connect();
      // some versions of the library expose start(), others handshake()
      if (typeof this.client.start === 'function') {
        await this.client.start();
      } else if (typeof this.client.handshake === 'function') {
        await this.client.handshake();
      }
      const list = await this.client.listTools();
      this.tools = Array.isArray(list) ? list : list.tools || [];
      this.connected = true;
    })();

    return this.connecting;
  }

  async callTool(name: string, args: any): Promise<any> {
    try {
      await this.ensureConnection();
      return await this.client.callTool(name, args);
    } catch (err) {
      this.connected = false; // force reconnect next time
      throw err;
    }
  }

  listTools() {
    return this.tools.map((t: any) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || '',
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }));
  }
}

class MCPManager {
  private connectors = new Map<string, MCPConnector>();
  private toolToConnector = new Map<string, MCPConnector>();

  async registerConnector(config: MCPConnectorConfig) {
    const connector = new MCPConnector(config);
    await connector.connect(); // load tools and cache tools list
    this.connectors.set(config.name, connector);
    connector.listTools().forEach((tool: any) => {
      this.toolToConnector.set(tool.function.name, connector);
    });
  }

  listTools() {
    const tools: any[] = [];
    for (const connector of this.connectors.values()) {
      tools.push(...connector.listTools());
    }
    return tools;
  }

  listServices() {
    return Array.from(this.connectors.entries()).map(([name, connector]) => ({
      name,
      tools: connector.listTools().map(t => t.function.name),
    }));
  }

  hasTool(name: string) {
    return this.toolToConnector.has(name);
  }

  async callTool(name: string, args: any) {
    const connector = this.toolToConnector.get(name);
    if (!connector) throw new Error(`未知远程工具: ${name}`);
    return connector.callTool(name, args);
  }
}

export const mcpManager = new MCPManager();
