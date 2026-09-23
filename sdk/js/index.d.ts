export declare const DEFAULT_BASE_URL: string;

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
}

export declare class SharedForestError extends Error {
  readonly status: number;
  readonly problem: Problem | null;
  constructor(status: number, problem: Problem | null, message?: string);
}

export type BBox = [minX: number, minY: number, maxX: number, maxY: number];

export interface Tree {
  id: string;
  type: string;
  x: number;
  y: number;
  plantedAt: number;
  growthStage: number;
  origin?: "human" | "agent";
}

export interface ForestSnapshot {
  trees: Tree[];
  groves: Array<{ id: string; x: number; y: number; level: number; treesAbsorbed: number }>;
  stats: { humans: number; agents: number; bots: number; plantedToday: number };
  visitors: number;
  uniqueVisitors: number;
  generatedAt: string;
  nextCursor?: string | null;
  limit?: number;
  totalTrees?: number;
}

export interface VisitResponse {
  queued: boolean;
  visitId: string;
  plant: boolean;
}

export interface PriceQuote {
  quantity: number;
  unitAmount: number;
  total: number;
  currency: "eur";
  termMonths: number;
  discountPercent: number;
}

export interface Design {
  id: string;
  genome: Record<string, unknown>;
  genomeHash: string;
  expiresAt: number;
}

export interface Spot {
  x: number;
  y: number;
}

export type OrderStatus = "open" | "paid" | "fulfilled" | "expired" | "refunded" | "disputed" | "cancelled" | "refund_pending";

export interface Order {
  id: string;
  status: OrderStatus;
  quantity: number;
  unitAmount: number;
  total: number;
  currency: "eur";
  channel: "web" | "mcp" | "api";
  checkoutUrl: string | null;
  confirmUrl: string | null;
  treeIds: string[];
  createdAt: number;
  paidAt: number | null;
  /** Cents still to refund while status is "refund_pending". */
  refundDue?: number | null;
}

export interface StartSponsorshipInput {
  quantity: number;
  /** One design id for all trees, or one per tree. */
  designIds: string[];
  /** Positions from findSpots. The SDK holds them before it orders. */
  spots?: Spot[];
  /** Hold ids from POST /api/v1/holds. Omit spots and holdIds and the server picks spots. */
  holdIds?: string[];
  displayName: string;
  link?: string;
  email: string;
  idempotencyKey: string;
}

export interface ClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
}

export declare class SharedForestClient {
  constructor(options?: ClientOptions);
  readonly baseUrl: string;
  request<T = unknown>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    options?: { query?: Record<string, unknown>; body?: unknown; idempotencyKey?: string },
  ): Promise<T>;
  getForest(options?: { limit?: number; cursor?: string; bbox?: BBox }): Promise<ForestSnapshot>;
  listTrees(options?: { limit?: number; cursor?: string; bbox?: BBox }): Promise<ForestSnapshot>;
  plant(options?: { idempotencyKey?: string }): Promise<VisitResponse>;
  quote(quantity: number): Promise<PriceQuote>;
  designTree(wish: string): Promise<Design>;
  findSpots(quantity: number, options?: { near?: Spot }): Promise<{ spots: Spot[] }>;
  /** Creates an unpaid order. Give order.confirmUrl to the human buyer: only the buyer can confirm and pay. */
  startSponsorship(input: StartSponsorshipInput): Promise<Order>;
  getOrder(orderId: string): Promise<Order>;
  /** An agent order expires 30 minutes after creation unless the human confirms. Adds 30 minutes, once. */
  extendOrder(orderId: string): Promise<Order>;
  /** Frees a held spot. */
  releaseHold(holdId: string): Promise<void>;
  waitForOrder(
    orderId: string,
    options?: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> },
  ): Promise<Order>;
}

/** Names before the rename to Shared Forest. */
export { SharedForestClient as WorldForestClient, SharedForestError as WorldForestError };
