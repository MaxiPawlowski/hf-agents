import { mcpProviderIdSchema, type McpIntegrations, type McpProviderId } from "../contracts/index.js";

export type McpSearchResultItem = {
  title: string;
  locator: string;
  snippet: string;
};

export type McpSearchResult = {
  provider: McpProviderId;
  query: string;
  summary: string;
  items: McpSearchResultItem[];
  workflowHints: string[];
};

type Fetcher = typeof fetch;

function resolveTavilyApiKey(): string | undefined {
  if (process.env.TAVILY_API_KEY && process.env.TAVILY_API_KEY.length > 0) {
    return process.env.TAVILY_API_KEY;
  }

  const mcpUrl = process.env.TAVILY_MCP_URL;
  if (!mcpUrl) {
    return undefined;
  }

  try {
    const url = new URL(mcpUrl);
    const key = url.searchParams.get("tavilyApiKey");
    return key && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

function workflowHintsFor(provider: McpProviderId): string[] {
  return provider === "tavily"
    ? [
        "Use Tavily search findings to enrich context before planning.",
        "Record accepted references in task lifecycle researchLog."
      ]
    : [
        "Use gh-grep patterns to locate implementation examples.",
        "Attach selected repository links to review notes before coding."
      ];
}

async function runTavilySearch(query: string, maxResults: number, fetcher: Fetcher): Promise<McpSearchResultItem[]> {
  const apiKey = resolveTavilyApiKey();
  if (!apiKey) {
    return [];
  }

  const response = await fetcher("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: maxResults,
      search_depth: "advanced"
    })
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };

  return (payload.results ?? []).slice(0, maxResults).map((entry, index) => ({
    title: entry.title || `Tavily result ${index + 1}`,
    locator: entry.url || "https://tavily.com",
    snippet: entry.content?.slice(0, 220) || "No snippet available."
  }));
}

async function runGhGrepSearch(query: string, maxResults: number, fetcher: Fetcher): Promise<McpSearchResultItem[]> {
  const url = `https://grep.app/api/search?q=${encodeURIComponent(query)}&regexp=false&page=1`;
  const response = await fetcher(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`gh-grep search failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    hits?: {
      hits?: Array<{
        repo?: { raw?: string };
        path?: { raw?: string };
        content?: { snippet?: string };
      }>;
    };
  };

  return (payload.hits?.hits ?? []).slice(0, maxResults).map((entry, index) => {
    const repo = entry.repo?.raw || "unknown-repo";
    const filePath = entry.path?.raw || "unknown-path";
    return {
      title: `${repo}:${filePath}`,
      locator: `https://github.com/${repo}/blob/HEAD/${filePath}`,
      snippet: entry.content?.snippet?.replace(/<[^>]+>/g, "") || `Code hit ${index + 1}`
    };
  });
}

export async function runMcpSearch(
  providerInput: string,
  query: string,
  integrations: McpIntegrations,
  fetcher: Fetcher = fetch
): Promise<McpSearchResult> {
  const provider = mcpProviderIdSchema.parse(providerInput);
  const config = provider === "tavily" ? integrations.tavily : integrations.ghGrep;
  if (!config.enabled) {
    return {
      provider,
      query,
      summary: `${provider} integration is disabled in policy configuration.`,
      items: [],
      workflowHints: workflowHintsFor(provider)
    };
  }

  try {
    const items =
      provider === "tavily"
        ? await runTavilySearch(query, config.maxResults, fetcher)
        : await runGhGrepSearch(query, config.maxResults, fetcher);

    const tavilyMissingKey = provider === "tavily" && !resolveTavilyApiKey();
    const summary = tavilyMissingKey
      ? "Tavily MCP is enabled but no Tavily key was found (set TAVILY_API_KEY or TAVILY_MCP_URL). No live results returned."
      : `Collected ${items.length} ${provider} research candidates for '${query}'.`;

    return {
      provider,
      query,
      summary,
      items,
      workflowHints: workflowHintsFor(provider)
    };
  } catch (error) {
    return {
      provider,
      query,
      summary: `MCP ${provider} search failed: ${(error as Error).message}`,
      items: [],
      workflowHints: workflowHintsFor(provider)
    };
  }
}
