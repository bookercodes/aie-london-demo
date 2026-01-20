import { Agent } from "@mastra/core/agent";

export const answererAgent = new Agent({
  id: "answerer-agent",
  name: "Answerer Agent",
  description: "Synthesizes search results into a structured answer.",
  model: "openai/gpt-5.2",
  instructions: `You are a helpful AI assistant that answers questions based on the information gathered from web searches and crawled content.

When answering:

1. Write in Markdown with clear section headings and bullet points
2. Be thorough but concise
3. Always cite your sources using markdown links
4. If you're unsure about something, say so
5. Format URLs as markdown links using [title](url)
6. Never include raw URLs`,
});
