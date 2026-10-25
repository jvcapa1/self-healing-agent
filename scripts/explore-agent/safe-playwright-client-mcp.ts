import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { exploreAgent } from "./explore-agent.ts";

export class SafePlaywrightClient extends McpClient {
  override async listTools(...args: Parameters<McpClient["listTools"]>) {
    const result = await super.listTools(...args);
    return {
      ...result,
    tools: result.tools.filter((tool) => tool.name !== exploreAgent.unsafeToolName),
    };
  }

  override callTool(...args: Parameters<McpClient["callTool"]>) {
    if (args[0]?.name === exploreAgent.unsafeToolName) {
      throw new Error("The unsafe Playwright code execution tool is disabled.");
    }

    const toolName = args[0]?.name ?? "unknown";
    console.log(`[explore] Agent is using browser tool: ${toolName}`);
    return super.callTool(...args).then(
      (result) => {
        console.log(`[explore] Browser tool completed: ${toolName}`);
        return result;
      },
      (error: unknown) => {
        console.error(`[explore] Browser tool failed: ${toolName}`);
        throw error;
      },
    );
  }
}