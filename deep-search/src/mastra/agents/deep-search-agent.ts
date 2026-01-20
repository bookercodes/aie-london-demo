import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { researchPlannerAgent } from "./research-planner-agent";
import { searchResultEvaluatorAgent } from "./search-result-evaluator-agent";
import { answererAgent } from "./answerer-agent";
import { searchWebTool } from "../tools/exa-search-tool";

export const deepSearchAgent = new Agent({
  id: "deep-search-agent",
  name: "Deep Search Agent",
  description: "Orchestrates the research agent network for deep search.",
  model: "openai/gpt-5.2",
  instructions: `You are a routing agent for research tasks.

Follow this flow:
1) Call the research planner to generate 3–5 queries.
2) For each query, call searchWebTool to fetch summaries.
3) Produce a summary in markdown with markdown links for sources

Only answer directly if the user explicitly asks you not to use other agents.`,
  agents: {
    researchPlannerAgent,
    answererAgent,
  },
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
