"""Create all initial tables

Revision ID: 001
Revises: 
Create Date: 2026-04-12

"""
import uuid
from sqlalchemy.dialects.postgresql import UUID
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Stocks
    op.create_table('sectors',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('sector_id_api', sa.String(50), unique=True),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
    )
    
    op.create_table('stocks',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('ticker', sa.String(10), unique=True, nullable=False),
        sa.Column('name', sa.String(255)),
        sa.Column('sector_id', UUID(as_uuid=True), sa.ForeignKey('sectors.id')),
        sa.Column('subsector', sa.String(255)),
        sa.Column('listing_date', sa.Date),
        sa.Column('shares_outstanding', sa.BigInteger),
        sa.Column('is_active', sa.Boolean, default=True),
        sa.Column('last_synced', sa.DateTime),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
    )
    op.create_index('ix_stocks_ticker', 'stocks', ['ticker'])
    
    op.create_table('brokers',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('code', sa.String(10), unique=True, nullable=False),
        sa.Column('name', sa.String(255)),
        sa.Column('broker_type', sa.String(20), default='RETAIL'),
        sa.Column('investor_type', sa.String(20)),
        sa.Column('source', sa.String(20), default='API'),
        sa.Column('last_synced', sa.DateTime),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
    )
    op.create_index('ix_brokers_code', 'brokers', ['code'])
    
    op.create_table('daily_prices',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('stock_id', UUID(as_uuid=True), sa.ForeignKey('stocks.id'), nullable=False),
        sa.Column('date', sa.Date, nullable=False),
        sa.Column('open', sa.Numeric(20, 2)),
        sa.Column('high', sa.Numeric(20, 2)),
        sa.Column('low', sa.Numeric(20, 2)),
        sa.Column('close', sa.Numeric(20, 2), nullable=False),
        sa.Column('volume', sa.BigInteger),
        sa.Column('value', sa.Numeric(20, 2)),
        sa.Column('foreign_buy', sa.Numeric(20, 2)),
        sa.Column('foreign_sell', sa.Numeric(20, 2)),
        sa.Column('foreign_flow', sa.Numeric(20, 2)),
        sa.Column('frequency', sa.Integer),
        sa.Column('shares_outstanding', sa.BigInteger),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.UniqueConstraint('stock_id', 'date', name='uq_daily_price_stock_date'),
    )
    op.create_index('ix_daily_prices_stock_date', 'daily_prices', ['stock_id', 'date'])
    op.create_index('ix_daily_prices_date', 'daily_prices', ['date'])
    
    op.create_table('broker_summaries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('stock_id', UUID(as_uuid=True), sa.ForeignKey('stocks.id'), nullable=False),
        sa.Column('date_from', sa.Date, nullable=False),
        sa.Column('date_to', sa.Date, nullable=False),
        sa.Column('range_days', sa.Integer),
        sa.Column('avg_price', sa.Numeric(20, 4)),
        sa.Column('avg_accdist', sa.String(50)),
        sa.Column('avg_amount', sa.Numeric(20, 2)),
        sa.Column('avg_percent', sa.Numeric(10, 4)),
        sa.Column('avg_vol', sa.Numeric(20, 2)),
        sa.Column('broker_accdist', sa.String(50)),
        sa.Column('total_buyer', sa.Integer),
        sa.Column('total_seller', sa.Integer),
        sa.Column('total_value', sa.Numeric(20, 2)),
        sa.Column('total_volume', sa.Integer),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.UniqueConstraint('stock_id', 'date_from', 'date_to', name='uq_broker_summary_range'),
    )
    op.create_index('ix_broker_summary_stock', 'broker_summaries', ['stock_id'])
    
    op.create_table('broker_entries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('summary_id', UUID(as_uuid=True), sa.ForeignKey('broker_summaries.id', ondelete='CASCADE'), nullable=False),
        sa.Column('broker_code', sa.String(10), nullable=False),
        sa.Column('side', sa.String(4), nullable=False),
        sa.Column('investor_type', sa.String(20)),
        sa.Column('is_whale', sa.Boolean, default=False),
        sa.Column('lots', sa.Integer),
        sa.Column('value', sa.Numeric(20, 2)),
        sa.Column('avg_price', sa.Numeric(20, 4)),
        sa.Column('frequency', sa.Integer),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
    )
    op.create_index('ix_broker_entry_summary', 'broker_entries', ['summary_id'])
    op.create_index('ix_broker_entry_code', 'broker_entries', ['broker_code'])
    
    op.create_table('api_signals',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('stock_id', UUID(as_uuid=True), sa.ForeignKey('stocks.id'), nullable=False),
        sa.Column('date', sa.Date, nullable=False),
        sa.Column('signal_type', sa.String(30), nullable=False),
        sa.Column('score', sa.Numeric(10, 2)),
        sa.Column('status', sa.String(30)),
        sa.Column('confidence', sa.Integer),
        sa.Column('recommendation', sa.String(20)),
        sa.Column('risk_level', sa.String(20)),
        sa.Column('entry_ideal_price', sa.Numeric(20, 2)),
        sa.Column('entry_max_price', sa.Numeric(20, 2)),
        sa.Column('current_price', sa.Numeric(20, 2)),
        sa.Column('top_brokers', sa.JSON),
        sa.Column('indicators', sa.JSON),
        sa.Column('timeframe_analysis', sa.JSON),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.UniqueConstraint('stock_id', 'date', 'signal_type', name='uq_api_signal_stock_date_type'),
    )
    op.create_index('ix_api_signals_stock_date', 'api_signals', ['stock_id', 'date'])
    
    op.create_table('weekly_metrics',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('stock_id', UUID(as_uuid=True), sa.ForeignKey('stocks.id'), nullable=False),
        sa.Column('week_start', sa.Date, nullable=False),
        sa.Column('week_end', sa.Date, nullable=False),
        sa.Column('whale_net_lots', sa.Integer),
        sa.Column('whale_net_value', sa.Numeric(20, 2)),
        sa.Column('whale_count', sa.Integer),
        sa.Column('retail_exit_percent', sa.Numeric(10, 4)),
        sa.Column('retail_participation_pct', sa.Numeric(10, 4)),
        sa.Column('kekompakan_score', sa.Numeric(10, 4)),
        sa.Column('vpa_signal', sa.String(20)),
        sa.Column('price_change_week', sa.Numeric(10, 4)),
        sa.Column('volume_change_week', sa.Numeric(10, 4)),
        sa.Column('bandar_floor_price', sa.Numeric(20, 2)),
        sa.Column('distance_to_floor_pct', sa.Numeric(10, 4)),
        sa.Column('overall_signal', sa.String(20)),
        sa.Column('confidence_score', sa.Integer),
        sa.Column('api_accumulation_score', sa.Numeric(10, 2)),
        sa.Column('api_distribution_score', sa.Numeric(10, 2)),
        sa.Column('api_sentiment_status', sa.String(30)),
        sa.Column('api_smart_money_status', sa.String(30)),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
        sa.UniqueConstraint('stock_id', 'week_start', name='uq_weekly_metric_stock_week'),
    )
    op.create_index('ix_weekly_metrics_stock', 'weekly_metrics', ['stock_id'])
    
    op.create_table('trade_signals',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('stock_id', UUID(as_uuid=True), sa.ForeignKey('stocks.id'), nullable=False),
        sa.Column('action', sa.String(10), nullable=False),
        sa.Column('entry_price', sa.Numeric(20, 2)),
        sa.Column('stop_loss', sa.Numeric(20, 2)),
        sa.Column('target_1', sa.Numeric(20, 2)),
        sa.Column('target_2', sa.Numeric(20, 2)),
        sa.Column('confidence', sa.Integer),
        sa.Column('pattern_type', sa.String(50)),
        sa.Column('key_bullets', sa.JSON),
        sa.Column('whale_brokers', sa.JSON),
        sa.Column('retail_exit_percent', sa.Numeric(10, 4)),
        sa.Column('volume_confirmed', sa.Boolean, default=False),
        sa.Column('status', sa.String(20), default='ACTIVE'),
        sa.Column('created_at', sa.DateTime),
        sa.Column('expires_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
    )
    op.create_index('ix_trade_signals_stock', 'trade_signals', ['stock_id'])
    op.create_index('ix_trade_signals_status', 'trade_signals', ['status'])
    
    op.create_table('alerts',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('stock_id', UUID(as_uuid=True), sa.ForeignKey('stocks.id')),
        sa.Column('alert_type', sa.String(30), nullable=False),
        sa.Column('condition', sa.JSON),
        sa.Column('is_active', sa.Boolean, default=True),
        sa.Column('triggered_at', sa.DateTime),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
    )
    
    op.create_table('sync_logs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('sync_type', sa.String(30), nullable=False),
        sa.Column('started_at', sa.DateTime),
        sa.Column('completed_at', sa.DateTime),
        sa.Column('records_synced', sa.Integer, default=0),
        sa.Column('api_calls_used', sa.Integer, default=0),
        sa.Column('status', sa.String(20), default='PENDING'),
        sa.Column('error_message', sa.Text),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
    )
    
    op.create_table('upload_jobs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('file_name', sa.String(255), nullable=False),
        sa.Column('file_path', sa.String(500)),
        sa.Column('source', sa.String(20), nullable=False),
        sa.Column('status', sa.String(20), default='PENDING'),
        sa.Column('records_processed', sa.Integer, default=0),
        sa.Column('error_message', sa.Text),
        sa.Column('created_at', sa.DateTime),
        sa.Column('updated_at', sa.DateTime),
    )
    
    op.create_table('api_raw_responses',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('endpoint', sa.String(200), nullable=False),
        sa.Column('params_hash', sa.String(64)),
        sa.Column('stock_ticker', sa.String(10)),
        sa.Column('response_data', sa.JSON, nullable=False),
        sa.Column('created_at', sa.DateTime),
    )
    op.create_index('ix_raw_ticker', 'api_raw_responses', ['stock_ticker'])
    op.create_index('ix_raw_created', 'api_raw_responses', ['created_at'])


def downgrade() -> None:
    op.drop_table('api_raw_responses')
    op.drop_table('upload_jobs')
    op.drop_table('sync_logs')
    op.drop_table('alerts')
    op.drop_table('trade_signals')
    op.drop_table('weekly_metrics')
    op.drop_table('api_signals')
    op.drop_table('broker_entries')
    op.drop_table('broker_summaries')
    op.drop_table('daily_prices')
    op.drop_table('brokers')
    op.drop_table('stocks')
    op.drop_table('sectors')