"""Add ksei_ownership and ksei_sid_history tables

Revision ID: 003
Revises: 002
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'ksei_ownership',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('stock_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('stocks.id'), nullable=False, index=True),
        sa.Column('snapshot_month', sa.Date, nullable=False),
        sa.Column('holder_name', sa.String(300), nullable=False),
        sa.Column('status', sa.String(10), nullable=False),
        sa.Column('entity_type', sa.String(50), nullable=True),
        sa.Column('shares', sa.BigInteger, nullable=False, server_default='0'),
        sa.Column('percentage', sa.Numeric(8, 4), nullable=True),
        sa.Column('is_controlling', sa.Boolean, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('stock_id', 'snapshot_month', 'holder_name', name='uq_ksei_ownership_holder'),
    )
    op.create_index('ix_ksei_ownership_month', 'ksei_ownership', ['snapshot_month'])

    op.create_table(
        'ksei_sid_history',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('stock_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('stocks.id'), nullable=False, index=True),
        sa.Column('snapshot_month', sa.Date, nullable=False),
        sa.Column('sid_count', sa.Integer, nullable=True),
        sa.Column('scripless_pct', sa.Numeric(8, 4), nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('stock_id', 'snapshot_month', name='uq_ksei_sid_stock_month'),
    )


def downgrade() -> None:
    op.drop_table('ksei_sid_history')
    op.drop_index('ix_ksei_ownership_month', table_name='ksei_ownership')
    op.drop_table('ksei_ownership')
