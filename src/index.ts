#!/usr/bin/env node
import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMemoryServer } from './server/MemoryServer.js';

async function main() {
  try {
    const server = createMemoryServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[Memory MCP] Server running on stdio');
  } catch (error) {
    console.error('[Memory MCP] Failed to start server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[Memory MCP] Server error:', error);
  process.exit(1);
});
