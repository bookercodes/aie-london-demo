import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import Exa from "exa-js";

const searchResultItemSchema = z.object({
  url: z.string(),
  summary: z.string(),
  publishedDate: z.string().optional(),
  author: z.string().nullable().optional(),
});

const searchResultGroupSchema = z.object({
  query: z.string(),
  results: z.array(searchResultItemSchema),
});

const searchResultsSchema = z.array(searchResultGroupSchema);

const gapsSchema = z.array(z.string());

const workflowStateSchema = z.object({
  initialQuery: z.string().optional(),
  clarifiedIntent: z.string().optional(),
  expandedQueries: z.array(z.string()).optional(),
  searchResults: searchResultsSchema.optional(),
  gaps: gapsSchema.optional(),
  answerIsSatisfactory: z.boolean().optional(),
  answer: z.string().optional(),
});

const clarifyIntent = createStep({
  id: "clarify-intent-step",
  inputSchema: z.object({
    initialQuery: z.string(),
  }),
  stateSchema: workflowStateSchema,
  resumeSchema: z.object({
    clarifiedIntent: z.string(),
  }),
  suspendSchema: z.object({
    assistantMessage: z.string(),
  }),
  outputSchema: z.object({}),
  execute: async ({
    inputData,
    resumeData,
    suspend,
    setState,
    mastra,
  }) => {
    const log = mastra?.getLogger?.();
    const intentAgent = mastra?.getAgent?.("intentClarifierAgent");
    if (!resumeData) {
      log.info("clarifyIntent start", {
        step: "clarifyIntent",
        initialQuery: inputData.initialQuery,
      });
      await setState({ initialQuery: inputData.initialQuery });
      const response = await intentAgent.generate(
        `User query: "${inputData.initialQuery}"

Generate exactly 3 clarifying questions to better understand the user's intent and provide a more personalized answer.`,
        {
          structuredOutput: {
            schema: z.object({
              questions: z
                .array(z.string())
                .length(3),
            }),
          },
        },
      );

      const questions = response.object.questions;
      const formattedQuestions = questions
        .map((question, number) => `${number + 1}. ${question}`)
        .join("\n");
      log.info("clarifyIntent suspend", {
        step: "clarifyIntent",
        questionCount: questions.length,
        assistantMessage: `To help you better, I have a few questions:\n\n${formattedQuestions}`,
      });

      return suspend({
        assistantMessage: `To help you better, I have a few questions:\n\n${formattedQuestions}`,
      });
    }

    log.info("clarifyIntent resume", {
      step: "clarifyIntent",
      clarifiedIntent: resumeData.clarifiedIntent,
    });
    await setState({
      initialQuery: inputData.initialQuery,
      clarifiedIntent: resumeData.clarifiedIntent,
    });

    return {};
  },
});

const generateQueries = createStep({
  id: "generate-queries-step",
  inputSchema: z.object({}),
  stateSchema: workflowStateSchema,
  outputSchema: z.object({}),
  execute: async ({ state, setState, mastra }) => {
    const log = mastra?.getLogger?.();
    const plannerAgent = mastra?.getAgent?.("researchPlannerAgent");
    log.info("generateQueries start", {
      step: "generateQueries",
      initialQuery: state.initialQuery,
      clarifiedIntent: state.clarifiedIntent,
      gaps: state.gaps?.length ?? 0,
    });
    const priorQueries =
      state.searchResults?.map((result) => result.query) ?? [];
    const uniquePriorQueries = Array.from(new Set(priorQueries));
    const priorQueriesText =
      uniquePriorQueries.length > 0
        ? `\nPrevious queries (avoid repeating):\n- ${uniquePriorQueries.join(
            "\n- ",
          )}`
        : "";
    const gapsText =
      state.gaps && state.gaps.length > 0
        ? `\nKnown gaps:\n- ${state.gaps.join("\n- ")}`
        : "";
    const response = await plannerAgent.generate(
      `User initial query: "${state.initialQuery}"
Additional context: "${state.clarifiedIntent}"
${priorQueriesText}
${gapsText}

Generate 3-5 focused search queries.`,
      {
        structuredOutput: {
          schema: z.object({
            queries: z
              .array(z.string())
              .min(3)
              .max(5),
          }),
        },
      },
    );

    const expandedQueries = response.object.queries;

    await setState({
      ...state,
      expandedQueries,
    });
    log.info("generateQueries state update", {
      step: "generateQueries",
      expandedQueries,
    });

    return {};
  },
});

const search = createStep({
  id: "search-step",
  inputSchema: z.object({}),
  stateSchema: workflowStateSchema,
  outputSchema: z.object({}),
  execute: async ({ state, setState, mastra }) => {
    const log = mastra?.getLogger?.();
    const exa = new Exa(process.env.EXA_API_KEY);
    const previousResults = state.searchResults ?? [];
    if (!state.expandedQueries) {
      throw new Error("Missing expandedQueries in state");
    }
    log.info("search start", {
      step: "search",
      queryCount: state.expandedQueries.length,
    });
    const searchResults = await Promise.all(
      state.expandedQueries.map(async (query) => {
        log.info("search query start", { step: "search", query });
        const response = await exa.search(query, {
          numResults: 5,
          contents: { summary: true },
        });
        log.info("search query done", {
          step: "search",
          query,
          results: response.results.length,
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
      }),
    );

    await setState({
      ...state,
      searchResults: [...previousResults, ...searchResults],
    });
    log.info("search state update", {
      step: "search",
      totalResultGroups: previousResults.length + searchResults.length,
    });

    return {};
  },
});

const evaluateResults = createStep({
  id: "evaluate-results-step",
  inputSchema: z.object({}),
  stateSchema: workflowStateSchema,
  outputSchema: z.object({}),
  execute: async ({ state, setState, mastra }) => {
    const log = mastra?.getLogger?.();
    const evaluatorAgent = mastra?.getAgent?.("searchResultEvaluatorAgent");
    log.info("evaluateResults start", {
      step: "evaluateResults",
      resultGroups: state.searchResults?.length ?? 0,
    });
    const response = await evaluatorAgent.generate(
      `User query: "${state.initialQuery}"
Clarified intent: "${state.clarifiedIntent}"

Search results:
${JSON.stringify(state.searchResults, null, 2)}

Determine if the results are sufficient. Be strict about source diversity and recency.`,
      {
        structuredOutput: {
          schema: z.object({
            answerIsSatisfactory: z.boolean(),
            gaps: z
              .array(z.string())
              .describe("Missing info or gaps if insufficient"),
          }),
        },
      },
    );

    await setState({
      ...state,
      answerIsSatisfactory: response.object.answerIsSatisfactory,
      gaps: response.object.gaps,
    });
    log.info("evaluateResults state update", {
      step: "evaluateResults",
      answerIsSatisfactory: response.object.answerIsSatisfactory,
      gaps: response.object.gaps,
    });

    return {};
  },
});

const finalizeAnswer = createStep({
  id: "finalize-answer-step",
  inputSchema: z.object({}),
  stateSchema: workflowStateSchema,
  outputSchema: z.object({
    answer: z.string(),
  }),
  execute: async ({ state, mastra }) => {
    const log = mastra?.getLogger?.();
    const answerAgent = mastra?.getAgent?.("answererAgent");
    if (!answerAgent) {
      throw new Error("Missing answerer-agent");
    }
    const queries = state.searchResults?.map((result) => result.query);
    log.info("finalizeAnswer queries", { step: "finalizeAnswer", queries });

    const exhausted = !state.answerIsSatisfactory;
    const searchContext = JSON.stringify(state.searchResults, null, 2);
    const exhaustionNote = exhausted
      ? "Note: We may not have all the information needed to answer the question completely. Please provide your best attempt at an answer based on the available information."
      : "";

    log.info("finalizeAnswer exhausted", { step: "finalizeAnswer", exhausted });
    const stream = await answerAgent.stream(
      `Initial query: "${state.initialQuery}"
${exhaustionNote}
Based on the following context, please answer the question: ${searchContext}`,
    );

    for await (const chunk of stream.textStream) {
      process.stdout.write(chunk);
    }

    log.info("finalizeAnswer answer ready", { step: "finalizeAnswer" });
    const answer = await stream.text;
    log.info("finalizeAnswer output", { step: "finalizeAnswer", answer });
    return { answer };
  },
});

const searchPass = createWorkflow({
  id: "search-pass-subflow",
  inputSchema: z.object({}),
  outputSchema: z.object({
    answerIsSatisfactory: z.boolean(),
    gaps: gapsSchema,
  }),
  stateSchema: workflowStateSchema,
})
  .then(generateQueries)
  .then(search)
  .then(evaluateResults)
  .commit();

const deepSearch = createWorkflow({
  id: "deep-search-workflow",
  inputSchema: z.object({
    initialQuery: z.string(),
  }),
  outputSchema: z.object({
    answer: z.string(),
  }),
  stateSchema: workflowStateSchema,
})
  .then(clarifyIntent)
  .dountil(searchPass, async ({ iterationCount, state }) => {
    if (iterationCount >= 3) {
      return true;
    }
    return Boolean(state.answerIsSatisfactory);
  })
  .then(finalizeAnswer)
  .commit();

export { deepSearch };
