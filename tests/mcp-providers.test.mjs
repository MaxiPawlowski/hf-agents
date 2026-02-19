import test from "node:test";
import assert from "node:assert/strict";

import { runMcpSearch } from "../dist/src/mcp/providers.js";

const integrations = {
  tavily: { enabled: true, maxResults: 5 },
  ghGrep: { enabled: true, maxResults: 5 }
};

test("runMcpSearch maps gh-grep API results", async () => {
  const result = await runMcpSearch(
    "gh-grep",
    "useState(",
    integrations,
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          hits: {
            hits: [
              {
                repo: { raw: "facebook/react" },
                path: { raw: "packages/react/index.js" },
                content: { snippet: "<table>useState(</table>" }
              }
            ]
          }
        })
      })
  );

  assert.equal(result.provider, "gh-grep");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "facebook/react:packages/react/index.js");
  assert.match(result.items[0].locator, /github.com\/facebook\/react/);
});

test("runMcpSearch reports missing Tavily key", async () => {
  const previous = process.env.TAVILY_API_KEY;
  const previousUrl = process.env.TAVILY_MCP_URL;
  delete process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_MCP_URL;
  try {
    const result = await runMcpSearch("tavily", "agent orchestration", integrations, fetch);
    assert.equal(result.provider, "tavily");
    assert.equal(result.items.length, 0);
    assert.match(result.summary, /no Tavily key was found/);
  } finally {
    if (previous) {
      process.env.TAVILY_API_KEY = previous;
    }
    if (previousUrl) {
      process.env.TAVILY_MCP_URL = previousUrl;
    }
  }
});
