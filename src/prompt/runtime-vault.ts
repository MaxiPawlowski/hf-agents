import { DEFAULT_INDEX_CONFIG, getRepoRoot, getVaultPaths } from "../runtime/persistence.js";
import { buildUnifiedIndex } from "../index/unified-index-pipeline.js";
import { queryItems, type UnifiedIndex as StoredUnifiedIndex } from "../index/unified-store.js";
import { embed } from "../index/vault-embeddings.js";
import { hfLog } from "../runtime/logger.js";
import type {
  IndexConfig,
  ParsedPlan,
  VaultContext,
  VaultSearchResult,
} from "../runtime/types.js";

const DEFAULT_SEMANTIC_TOP_K = 5;

export type UnifiedIndexState = {
  index: StoredUnifiedIndex;
  vectors: Float32Array;
};

export type IndexOpts = {
  plan: ParsedPlan | null;
  planlessCwd: string | null;
  cfg: IndexConfig | null;
  vault: VaultContext | null;
};

export type VaultIndexState = {
  unifiedIndex: UnifiedIndexState | null;
  vaultSearchResults: VaultSearchResult[] | null;
  plan: ParsedPlan | null;
  planlessCwd: string | null;
  vault: VaultContext | null;
  indexConfig: IndexConfig | null;
  lastIndexError: string | undefined;
};

export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function buildIndexOptions(opts: IndexOpts): Parameters<typeof buildUnifiedIndex>[0] {
  const { plan, planlessCwd, cfg, vault } = opts;
  const vaultPaths = plan ? getVaultPaths(plan) : null;
  return {
    repoRoot: getRepoRoot(plan ?? undefined, planlessCwd ?? undefined),
    ...(vaultPaths && vault ? { vaultPaths, vaultContext: vault } : {}),
    codeConfig: cfg?.code.enabled === false
      ? undefined
      : {
        roots: cfg?.code.roots ?? ["src"],
        extensions: cfg?.code.extensions,
        exclude: cfg?.code.exclude,
      },
    ...(cfg?.external?.roots && cfg.external.roots.length > 0
      ? {
        externalConfig: {
          roots: cfg.external.roots,
          ...(cfg.external.extensions ? { extensions: cfg.external.extensions } : {}),
          ...(cfg.external.exclude ? { exclude: cfg.external.exclude } : {}),
        },
      }
      : {}),
    embeddingBatchSize: cfg?.embeddingBatchSize,
    maxChunkChars: cfg?.maxChunkChars,
  };
}

export type QueryIndexOpts = {
  query: string;
  topK?: number;
  sourceFilter?: "vault" | "code";
};

export async function queryIndexItems(
  state: Pick<VaultIndexState, "unifiedIndex" | "indexConfig">,
  opts: QueryIndexOpts,
): Promise<VaultSearchResult[] | null> {
  const { query, topK, sourceFilter } = opts;
  if (!state.unifiedIndex) {
    return null;
  }

  let queryVector: number[];
  try {
    queryVector = await embed(query);
  } catch (error) {
    const msg = (error as Error).message;
    hfLog({ tag: "runtime", msg: "queryIndex: embed failed", data: { error: msg } });
    return null;
  }

  const results = queryItems(
    state.unifiedIndex,
    {
      queryVector,
      topK: topK ?? state.indexConfig?.semanticTopK ?? DEFAULT_SEMANTIC_TOP_K,
      ...(sourceFilter === undefined ? {} : { sourceFilter }),
    },
  );

  return results.map((result) => ({
    score: result.score,
    text: result.text,
    metadata: {
      sourcePath: (result.metadata.sourcePath as string | undefined) ?? "",
      sectionTitle: (result.metadata.sectionTitle as string | undefined) ?? "",
      documentTitle: (result.metadata.documentTitle as string | undefined) ?? "",
      kind: result.metadata.kind === "code" ? "code" as const : "vault" as const
    }
  }));
}

export async function refreshVaultIndex(state: VaultIndexState): Promise<void> {
  const { plan, planlessCwd, vault, indexConfig: cfg } = state;

  state.unifiedIndex = null;

  if (cfg && !cfg.enabled) {
    state.lastIndexError = undefined;
    return;
  }

  try {
    state.unifiedIndex = await withTimeout(
      buildUnifiedIndex(buildIndexOptions({
        plan,
        planlessCwd,
        cfg,
        vault,
      })),
      cfg?.timeoutMs ?? DEFAULT_INDEX_CONFIG.timeoutMs,
      null
    );
  } catch (error) {
    const msg = (error as Error).message;
    hfLog({ tag: "runtime", msg: "unified index build failed", data: { error: msg } });
    state.lastIndexError = `index build: ${msg}`;
    state.unifiedIndex = null;
  }

  if (state.unifiedIndex) {
    state.lastIndexError = undefined;
  }

  await refreshVaultSearchResults(state);
}

export async function refreshVaultSearchResults(state: VaultIndexState): Promise<void> {
  const { plan, indexConfig: cfg } = state;

  if (state.unifiedIndex && plan?.currentMilestone) {
    try {
      state.vaultSearchResults = await withTimeout(
        queryIndexItems(state, { query: plan.currentMilestone.text }),
        cfg?.timeoutMs ?? DEFAULT_INDEX_CONFIG.timeoutMs,
        null
      );
    } catch (error) {
      const msg = (error as Error).message;
      hfLog({ tag: "runtime", msg: "vault search failed", data: { error: msg } });
      state.lastIndexError = `vault search: ${msg}`;
      state.vaultSearchResults = null;
    }
    return;
  }

  const isPlanning = plan?.status === "planning" && !plan.currentMilestone && plan.userIntent;
  if (state.unifiedIndex && isPlanning && plan.userIntent) {
    try {
      state.vaultSearchResults = await withTimeout(
        queryIndexItems(state, { query: plan.userIntent, topK: cfg?.planningSemanticTopK ?? DEFAULT_SEMANTIC_TOP_K }),
        cfg?.timeoutMs ?? DEFAULT_INDEX_CONFIG.timeoutMs,
        null
      );
    } catch (error) {
      const msg = (error as Error).message;
      hfLog({ tag: "runtime", msg: "vault search failed (planning)", data: { error: msg } });
      state.lastIndexError = `vault search: ${msg}`;
      state.vaultSearchResults = null;
    }
    return;
  }

  state.vaultSearchResults = null;
}
