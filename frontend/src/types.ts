// ─── Core signal types ────────────────────────────────────────────────────────

export type SignalType = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'WAIT' | 'SELL' | 'STRONG_SELL';

// ─── Leaderboard (Dashboard) ──────────────────────────────────────────────────

export interface TopWhaleBroker {
  code: string;
  lots: number;
  value: number;
  side: 'BUY' | 'SELL';
}

export interface LeaderboardEntry {
  ticker: string;
  name: string;
  sector?: string;
  overall_signal: SignalType;
  confidence_score: number;
  whale_net_lots: number;
  whale_net_value: number;
  retail_exit_percent: number | string;
  kekompakan_score: number | string;
  vpa_signal: string;
  Bandar_floor_price: string | number;
  current_price: string | number;
  distance_to_floor_pct: string | number;
  api_accumulation_score: number | string;
  close?: number;
  week_start: string;
  week_end: string;
  top_whale_brokers: TopWhaleBroker[];
  pump_score?: number | null;
}

// ─── Weekly history (8-week trend) ────────────────────────────────────────────

export interface WeeklyHistoryPoint {
  week_end: string;
  whale_net_lots: number;
  retail_exit_percent: number;
  kekompakan_score: number;
  confidence_score: number;
  overall_signal: SignalType;
}

export interface StockHistory {
  ticker: string;
  weeks: WeeklyHistoryPoint[];
}

// ─── Major holder movements ───────────────────────────────────────────────────

export interface MajorHolderMovement {
  holder_name: string;
  disclosure_date: string;
  prev_pct: number;
  curr_pct: number;
  change_pct: number;
  prev_shares: number;
  curr_shares: number;
  change_shares: number;
  action_type: 'BUY' | 'SELL' | null;
  nationality: 'FOREIGN' | 'DOMESTIC';
  source: 'IDX' | 'KSEI' | 'OTHER';
  price_at_disclosure: number | null;
}

export interface MajorHolders {
  ticker: string;
  movements: MajorHolderMovement[];
}

// ─── Shareholder-broker mapping ───────────────────────────────────────────────

export interface StockShareholder {
  name: string;
  broker_codes: string[];
  shares: number;
  percentage: number;
  is_controlling: boolean;
}

export interface StockShareholders {
  ticker: string;
  shareholders: StockShareholder[];
}

// ─── Broker flow (inventory chart) ───────────────────────────────────────────

export interface BrokerFlowPoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number;
  [broker: string]: number | string | null;
}

export interface BrokerFlowBroker {
  broker: string;
  cum_lots: number;
  is_tektok: boolean;
}

// ─── Trade Signals ────────────────────────────────────────────────────────────

export interface TradeSignal {
  id: string;
  ticker: string;
  name: string;
  action: 'BUY' | 'STRONG_BUY';
  confidence: number;
  entry_price: number | null;
  stop_loss: number | null;
  target_1: number | null;
  target_2: number | null;
  current_price: number | null;
  pnl_pct: number | null;
  key_bullets: string[];
  whale_brokers: string[];
  retail_exit_percent: number | null;
  volume_confirmed: boolean;
  status: 'ACTIVE' | 'HIT_T1' | 'HIT_T2' | 'STOPPED_OUT' | 'EXPIRED';
  created_at: string;
  expires_at: string | null;
}

export interface TradeSignalsResponse {
  count: number;
  signals: TradeSignal[];
}

export interface BrokerFlowData {
  ticker: string;
  from_date: string;
  to_date: string;
  timeline: BrokerFlowPoint[];
  brokers: string[];
  tektok_brokers: string[];
  top_accumulators: BrokerFlowBroker[];
  top_distributors: BrokerFlowBroker[];
  weeks_of_data: number;
}

export interface LeaderboardResponse {
  count: number;
  week_start: string;
  week_end: string;
  entries: LeaderboardEntry[];
}

export interface ApiKeyStats {
  key_index: number;
  key_preview: string;
  calls_used: number;
  calls_limit: number;
  calls_remaining: number;
  active: boolean;
}

export interface ApiUsage {
  total_keys: number;
  active_key: number;
  monthly_calls: number;
  monthly_limit: number;
  monthly_remaining: number;
  daily_calls: number;
  daily_limit: number;
  daily_remaining: number;
  plan: string;
  per_key: ApiKeyStats[];
}

export interface DashboardSummary {
  total_stocks?: number;
  stocks_tracked?: number;
  strong_buy_count?: number;
  buy_count?: number;
  watch_count?: number;
  wait_count?: number;
  sell_count?: number;
  strong_sell_count?: number;
  week_start?: string;
  week_end?: string;
  watchlist?: string[];
  api_usage?: { client_stats?: ApiUsage; monthly_calls_used?: number; monthly_limit?: number; monthly_remaining?: number };
}

// ─── Stock Detail (nested API response) ───────────────────────────────────────

export interface DailyPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  foreign_buy: number;
  foreign_sell: number;
  foreign_flow: number;
}

export interface BrokerEntry {
  broker_code: string;
  side: 'BUY' | 'SELL';
  lots: number;
  value: number;
  avg_price: number;
  investor_type: string;   // 'Asing' | 'Lokal' | 'Pemerintah'
  is_whale: boolean;
  frequency: number;
}

export interface ApiSignal {
  signal_type: string;
  score: number | null;
  status: string | null;
  confidence: number | null;
  recommendation: string | null;
  risk_level: string | null;
  date: string;
  entry_ideal_price: number | null;
  entry_max_price: number | null;
}

export interface BrokerSummary {
  date_from: string;
  date_to: string;
  avg_price: number;
  broker_accdist: string;
  total_buyer: number;
  total_seller: number;
}

/** Flat view of the stock detail — assembled from the nested API response */
// ─── Backtest ─────────────────────────────────────────────────────────────────

export interface TradeResult {
  ticker: string;
  signal: string;
  confidence: number;
  week_start: string;
  week_end: string;
  entry_price: number;
  stop_loss: number;
  target_1: number;
  target_2: number;
  exit_price: number | null;
  exit_date: string | null;
  exit_reason: 'TARGET_2' | 'TARGET_1' | 'STOP_LOSS' | 'TIME_STOP' | 'NO_DATA';
  pnl_pct: number;
  whale_net_lots: number;
  retail_exit_pct: number;
  kekompakan: number;
  bandar_floor: number;
}

export interface BacktestResult {
  ticker: string | null;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_gain_pct: number;
  avg_loss_pct: number;
  avg_return_pct: number;
  best_trade_pct: number;
  worst_trade_pct: number;
  t1_hit_rate: number;
  t2_hit_rate: number;
  stop_hit_rate: number;
  time_stop_rate: number;
  trades: TradeResult[];
}

// ─── Ownership composition (KSEI) ────────────────────────────────────────────

export interface OwnershipSummary {
  month: string;
  total_shares: number;
  foreign_pct: number;
  local_pct: number;
  retail_pct: number;
  holder_count: number;
}

export interface OwnershipMonthly {
  month: string;
  total_shares: number;
  by_segment: Record<string, { shares: number; pct: number }>;
}

export interface OwnershipBreakdownRow {
  entity_type: string;
  shares: number;
  holders: number;
  pct: number;
}

export interface OwnershipBreakdown {
  local: OwnershipBreakdownRow[];
  foreign: OwnershipBreakdownRow[];
}

export interface SidPoint {
  month: string;
  sid_count: number | null;
  scripless_pct: number | null;
}

export interface MajorShareholder {
  name: string;
  status: 'Lokal' | 'Asing';
  entity_type: string | null;
  shares: number;
  pct: number | null;
  is_controlling: boolean;
}

export interface OwnershipResponse {
  ticker: string;
  name: string;
  has_data: boolean;
  summary: OwnershipSummary | null;
  monthly: OwnershipMonthly[];
  breakdown: OwnershipBreakdown;
  sid_trend: SidPoint[];
  majors: MajorShareholder[];
}

export interface StockDetail {
  // from stock
  ticker: string;
  name: string;
  sector?: string;
  last_synced?: string;

  // from weekly_metrics
  week_start: string;
  week_end: string;
  overall_signal: SignalType;
  confidence_score: number;
  whale_net_lots: number;
  whale_net_value: number;
  whale_count?: number;
  retail_exit_percent: number;
  kekompakan_score: number;
  vpa_signal: string;
  price_change_week?: number;
  volume_change_week?: number;
  bandar_floor_price: number;
  distance_to_floor_pct: number;
  api_accumulation_score?: number;
  api_distribution_score?: number;
  api_sentiment_status?: string | null;
  top_whale_brokers: TopWhaleBroker[];

  // derived from recent_prices
  current_price: number;
  recent_prices: DailyPrice[];

  // raw data
  broker_entries: BrokerEntry[];
  broker_summary?: BrokerSummary;
  api_signals: ApiSignal[];
}
