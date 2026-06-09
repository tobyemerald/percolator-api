import { describe, it, expect, vi, beforeEach } from "vitest";
import { crankStatusRoutes } from "../../src/routes/crank.js";

// Mock @percolator/shared
vi.mock("@percolator/shared", () => ({
  getSupabase: vi.fn(),
  getConnection: vi.fn(),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  truncateErrorMessage: vi.fn((msg: string) => msg),
  getNetwork: vi.fn(() => "devnet"),
  sanitizeSlabAddress: vi.fn((addr: string) => addr),
  sanitizePagination: vi.fn((p: any) => p),
  sanitizeString: vi.fn((s: string) => s),
  sendInfoAlert: vi.fn(),
  sendCriticalAlert: vi.fn(),
  sendWarningAlert: vi.fn(),
  eventBus: { on: vi.fn(), emit: vi.fn(), off: vi.fn() },
  config: { supabaseUrl: "http://test", supabaseKey: "test", rpcUrl: "http://test" },
}));

const { getSupabase } = await import("@percolator/shared");

/**
 * Create a chainable Supabase query-builder mock that resolves to `resolvedValue`.
 */
function chainable(resolvedValue: any): any {
  const obj: any = {};
  const methods = ["select", "eq", "neq", "gte", "lte", "not", "order", "limit", "single", "maybeSingle", "head"];
  for (const m of methods) {
    obj[m] = vi.fn(() => obj);
  }
  obj.then = (resolve: any) => Promise.resolve(resolvedValue).then(resolve);
  obj.catch = (reject: any) => Promise.resolve(resolvedValue).catch(reject);
  obj.finally = (fn: any) => Promise.resolve(resolvedValue).finally(fn);
  return obj;
}

describe("crank routes", () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase = {
      from: vi.fn(() => chainable({ data: [], error: null })),
    };

    vi.mocked(getSupabase).mockReturnValue(mockSupabase);
  });

  describe("GET /crank/status", () => {
    it("should return market crank data", async () => {
      const mockMarkets = [
        {
          slab_address: "11111111111111111111111111111111",
          last_crank_slot: 123456789,
          updated_at: "2025-01-01T00:00:00Z",
        },
        {
          slab_address: "22222222222222222222222222222222",
          last_crank_slot: 123456790,
          updated_at: "2025-01-01T00:01:00Z",
        },
      ];

      mockSupabase.from.mockReturnValue(chainable({ data: mockMarkets, error: null }));

      const app = crankStatusRoutes();
      const res = await app.request("/crank/status");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.markets).toHaveLength(2);
      // v17: response uses camelCase field names
      expect(data.markets[0].slabAddress).toBe("11111111111111111111111111111111");
      expect(data.markets[0].lastCrankSlot).toBe(123456789);
    });

    it("should handle empty markets list", async () => {
      mockSupabase.from.mockReturnValue(chainable({ data: [], error: null }));

      const app = crankStatusRoutes();
      const res = await app.request("/crank/status");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.markets).toHaveLength(0);
    });

    it("should handle null values", async () => {
      const mockMarkets = [
        {
          slab_address: "11111111111111111111111111111111",
          last_crank_slot: null,
          updated_at: null,
        },
      ];

      mockSupabase.from.mockReturnValue(chainable({ data: mockMarkets, error: null }));

      const app = crankStatusRoutes();
      const res = await app.request("/crank/status");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.markets).toHaveLength(1);
      // v17: camelCase field names
      expect(data.markets[0].lastCrankSlot).toBeNull();
      expect(data.markets[0].updatedAt).toBeNull();
    });

    it("should handle database errors", async () => {
      mockSupabase.from.mockReturnValue(chainable({
        data: null,
        error: new Error("Database error"),
      }));

      const app = crankStatusRoutes();
      const res = await app.request("/crank/status");

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe("Failed to fetch crank status");
    });

    it("should return all market stats fields", async () => {
      const mockMarkets = [
        {
          slab_address: "11111111111111111111111111111111",
          last_crank_slot: 123456789,
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];

      mockSupabase.from.mockReturnValue(chainable({ data: mockMarkets, error: null }));

      const app = crankStatusRoutes();
      const res = await app.request("/crank/status");

      expect(res.status).toBe(200);
      const data = await res.json();
      // v17: camelCase field names; assetIndex added for per-asset crank tracking
      expect(data.markets[0]).toHaveProperty("slabAddress");
      expect(data.markets[0]).toHaveProperty("lastCrankSlot");
      expect(data.markets[0]).toHaveProperty("updatedAt");
      expect(data.markets[0]).toHaveProperty("assetIndex");
      // pre-v17 rows have no asset_index → defaults to 0
      expect(data.markets[0].assetIndex).toBe(0);
    });

    it("should handle large slot numbers", async () => {
      const mockMarkets = [
        {
          slab_address: "11111111111111111111111111111111",
          last_crank_slot: 999999999999,
          updated_at: "2025-01-01T00:00:00Z",
        },
      ];

      mockSupabase.from.mockReturnValue(chainable({ data: mockMarkets, error: null }));

      const app = crankStatusRoutes();
      const res = await app.request("/crank/status");

      expect(res.status).toBe(200);
      const data = await res.json();
      // v17: camelCase
      expect(data.markets[0].lastCrankSlot).toBe(999999999999);
    });

    it("should preserve order from database", async () => {
      const mockMarkets = [
        {
          slab_address: "33333333333333333333333333333333",
          last_crank_slot: 3,
          updated_at: "2025-01-01T02:00:00Z",
        },
        {
          slab_address: "11111111111111111111111111111111",
          last_crank_slot: 1,
          updated_at: "2025-01-01T00:00:00Z",
        },
        {
          slab_address: "22222222222222222222222222222222",
          last_crank_slot: 2,
          updated_at: "2025-01-01T01:00:00Z",
        },
      ];

      mockSupabase.from.mockReturnValue(chainable({ data: mockMarkets, error: null }));

      const app = crankStatusRoutes();
      const res = await app.request("/crank/status");

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.markets).toHaveLength(3);
      // v17: camelCase slabAddress
      expect(data.markets[0].slabAddress).toBe("33333333333333333333333333333333");
      expect(data.markets[1].slabAddress).toBe("11111111111111111111111111111111");
      expect(data.markets[2].slabAddress).toBe("22222222222222222222222222222222");
    });
  });
});
