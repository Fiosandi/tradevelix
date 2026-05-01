import axios from 'axios';
import type { DashboardSummary, LeaderboardResponse, StockDetail, BacktestResult, StockHistory, MajorHolders, BrokerFlowData, TradeSignalsResponse, StockShareholders, OwnershipResponse } from './types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const http = axios.create({ baseURL: API_BASE, timeout: 15000 });

http.interceptors.response.use(
  r => r,
  e => { console.error('API:', e.response?.data || e.message); return Promise.reject(e); }
);

export const dashboardApi = {
  getSummary: (): Promise<DashboardSummary> =>
    http.get('/dashboard/summary').then(r => r.data),

  getLeaderboard: (): Promise<LeaderboardResponse> =>
    http.get('/dashboard/leaderboard').then(r => r.data),

  getStockHistory: (ticker: string, weeks = 8): Promise<StockHistory> =>
    http.get(`/dashboard/stock/${ticker}/history?weeks=${weeks}`).then(r => r.data),

  getMajorHolders: (ticker: string): Promise<MajorHolders> =>
    http.get(`/dashboard/stock/${ticker}/major-holders`).then(r => r.data),

  getShareholders: (ticker: string): Promise<StockShareholders> =>
    http.get(`/dashboard/stock/${ticker}/shareholders`).then(r => r.data),

  getBrokerFlow: (ticker: string, fromDate: string, toDate: string): Promise<BrokerFlowData> =>
    http.get(`/dashboard/stock/${ticker}/broker-flow?from_date=${fromDate}&to_date=${toDate}`).then(r => r.data),

  getAdminUsers: () => http.get('/dashboard/admin/users').then(r => r.data),

  getTradeSignals: (): Promise<TradeSignalsResponse> =>
    http.get('/dashboard/signals').then(r => r.data),

  toggleUserPaid: (userId: string) =>
    http.post(`/dashboard/admin/users/${userId}/toggle-paid`).then(r => r.data),

  getStockDetail: async (ticker: string, days = 120): Promise<StockDetail> => {
    const { data } = await http.get(`/dashboard/stock/${ticker}?days=${days}`);
    const m = data.weekly_metrics ?? {};
    const prices: { close: number }[] = data.recent_prices ?? [];
    const lastClose = prices.length > 0 ? prices[prices.length - 1].close : 0;
    return {
      ticker:               data.stock?.ticker  ?? ticker,
      name:                 data.stock?.name    ?? '',
      sector:               data.stock?.sector  ?? undefined,
      last_synced:          data.stock?.last_synced,
      week_start:           m.week_start          ?? '',
      week_end:             m.week_end            ?? '',
      overall_signal:       m.overall_signal      ?? 'WAIT',
      confidence_score:     m.confidence_score    ?? 0,
      whale_net_lots:       m.whale_net_lots       ?? 0,
      whale_net_value:      m.whale_net_value      ?? 0,
      whale_count:          m.whale_count,
      retail_exit_percent:  m.retail_exit_percent  ?? 0,
      kekompakan_score:     m.kekompakan_score     ?? 0,
      vpa_signal:           m.vpa_signal           ?? '',
      price_change_week:    m.price_change_week,
      volume_change_week:   m.volume_change_week,
      bandar_floor_price:   m.bandar_floor_price   ?? 0,
      distance_to_floor_pct: m.distance_to_floor_pct ?? 0,
      api_accumulation_score: m.api_accumulation_score,
      api_distribution_score: m.api_distribution_score,
      api_sentiment_status:   m.api_sentiment_status,
      top_whale_brokers:    m.top_whale_brokers    ?? [],
      current_price:        lastClose,
      recent_prices:        data.recent_prices     ?? [],
      broker_entries:       data.broker_entries    ?? [],
      broker_summary:       data.broker_summary,
      api_signals:          data.api_signals       ?? [],
    };
  },
};

export const backtestApi = {
  run: (params: { ticker?: string; from_date?: string; min_confidence?: number }): Promise<BacktestResult> => {
    const q = new URLSearchParams();
    if (params.ticker) q.set('ticker', params.ticker);
    if (params.from_date) q.set('from_date', params.from_date);
    if (params.min_confidence !== undefined) q.set('min_confidence', String(params.min_confidence));
    return http.get(`/dashboard/backtest?${q}`).then(r => r.data);
  },
};

export const adminApi = {
  getSyncStatus: () =>
    http.get('/admin/sync/status').then(r => r.data),

  triggerSync: (type: string) =>
    http.post(`/admin/sync/${type}`).then(r => r.data),

  triggerPriceHistory: (days: number) =>
    http.post(`/admin/sync/price-history?days=${days}`).then(r => r.data),

  uploadKseiPdf: (
    file: File,
    snapshotMonth: string,
    onUploadProgress?: (pct: number) => void,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('snapshot_month', snapshotMonth);
    return http.post('/admin/ownership/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000,  // 5 min — large PDFs can take 60-90s server-side
      onUploadProgress: e => {
        if (onUploadProgress && e.total) onUploadProgress(Math.round((e.loaded / e.total) * 100));
      },
    }).then(r => r.data);
  },

  getKseiJobs: () =>
    http.get('/admin/ownership/jobs').then(r => r.data),

  /** Open an SSE connection for live sync events. Returns the EventSource so
   *  the caller can `.close()` it. The caller attaches `.onmessage` etc. */
  openSyncStream: (): EventSource =>
    new EventSource(`${API_BASE}/admin/sync/stream`),
};

export const ownershipApi = {
  get: (ticker: string, months = 12): Promise<OwnershipResponse> =>
    http.get(`/ownership/${ticker}?months=${months}`).then(r => r.data),
};

export interface AlertItem {
  id: string;
  ticker: string;
  stock_name?: string | null;
  alert_type: string;
  condition: Record<string, any>;
  is_active: boolean;
  triggered_at: string | null;
  created_at: string | null;
}

export const alertsApi = {
  list: (): Promise<AlertItem[]> => http.get('/alerts').then(r => r.data),

  create: (ticker: string, alert_type: string, condition: Record<string, any>): Promise<AlertItem> =>
    http.post('/alerts', { ticker, alert_type, condition }).then(r => r.data),

  remove: (id: string) => http.delete(`/alerts/${id}`).then(r => r.data),

  rearm: (id: string) => http.post(`/alerts/${id}/rearm`).then(r => r.data),

  evaluateNow: () => http.post('/alerts/evaluate').then(r => r.data),
};

export default http;
