export type DocsRequest = {
  library: string;
  version?: string;
};

export type DocsResponse = {
  source: "context7-adapter";
  query: string;
};

export function buildDocsQuery(request: DocsRequest): DocsResponse {
  const query = request.version
    ? `${request.library}@${request.version}`
    : request.library;

  return {
    source: "context7-adapter",
    query
  };
}
