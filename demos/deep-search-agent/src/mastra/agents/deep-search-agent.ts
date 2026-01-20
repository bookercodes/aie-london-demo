import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { searchWebTool } from "../tools/search-web-tool";

export const deepSearchAgent = new Agent({
  id: "deep-search-agent",
  name: "Deep Search Agent",
  description: "Orchestrates the research agent network for deep search.",
  model: "openai/gpt-5.2",
  instructions: `Generate 3-5 targeted follow-up queries that cover different angles.
  Use the searchWebTool to fetch summaries for each query, then synthesize a concise, 
  well-structured markdown answer with headings, bullet points where helpful, and a 
  brief conclusion. Cite sources as markdown links inline for key claims.`,
  tools: {
    searchWebTool,
  },
  memory: new Memory({
    storage: new LibSQLStore({
      id: "deep-search-agent-memory",
      url: ":memory:",
    }),
  }),
  defaultNetworkOptions: {
    maxSteps: 500
  }
});
