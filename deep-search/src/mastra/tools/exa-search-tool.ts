import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import Exa from "exa-js";

export const searchWebTool = createTool({
  id: "exa-search",
  description:
    "Search the web with Exa and return summarized results for a query.",
  inputSchema: z.object({
    query: z.string(),
    numResults: z.number().int().min(1).max(10).optional(),
  }),
  outputSchema: z.object({
    query: z.string(),
    results: z.array(
      z.object({
        url: z.string(),
        summary: z.string(),
        publishedDate: z.string().optional(),
        author: z.string().nullable().optional(),
      }),
    ),
  }),
  execute: async ({ query, numResults }) => {
    const exa = new Exa(process.env.EXA_API_KEY);
    const response = await exa.search(query, {
      numResults: numResults ?? 5,
      contents: { summary: true },
    });

    return {
      query,
      results: response.results.map((result) => ({
        url: result.url,
        summary: result.summary,
        publishedDate: result.publishedDate,
        author: result.author,
      })),
    };
  },
});
