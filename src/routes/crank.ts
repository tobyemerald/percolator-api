import { Hono } from "hono";
import { getSupabase, getNetwork, createLogger, truncateErrorMessage } from "@percolator/shared";

const logger = createLogger("api:crank");

export function crankStatusRoutes(): Hono {
  const app = new Hono();

  app.get("/crank/status", async (c) => {
    try {
      // v17: select asset_index for per-asset crank tracking. Pre-v17 rows return null (defaults to 0).
      // In v17 PermissionlessCrank (tag 5) takes an asset_index u16 — the indexer
      // writes one row per (slab, asset_index) pair so callers can monitor per-asset crank lag.
      const { data, error } = await getSupabase()
        .from("markets_with_stats")
        .select("slab_address, last_crank_slot, updated_at, asset_index")
        .eq("network", getNetwork())
        .not("slab_address", "is", null);
      if (error) throw error;
      const markets = (data ?? []).map((row) => ({
        slabAddress: row.slab_address,
        lastCrankSlot: row.last_crank_slot ?? null,
        updatedAt: row.updated_at ?? null,
        // v17: per-asset index (null from pre-v17 indexer → 0).
        assetIndex: (row as Record<string, unknown>).asset_index != null
          ? Number((row as Record<string, unknown>).asset_index)
          : 0,
      }));
      return c.json({ markets });
    } catch (err) {
      logger.error("Error fetching crank status", {
        error: truncateErrorMessage(err instanceof Error ? err.message : String(err), 120),
      });
      return c.json({ error: "Failed to fetch crank status" }, 500);
    }
  });

  return app;
}
