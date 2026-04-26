"""Add major_holder_movements table

Revision ID: 002
Revises: 001
Create Date: 2026-04-26
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'major_holder_movements',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('stock_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('stocks.id'), nullable=False, index=True),
        sa.Column('holder_id', sa.String(50), nullable=False),
        sa.Column('holder_name', sa.String(200), nullable=False),
        sa.Column('disclosure_date', sa.Date, nullable=False, index=True),
        sa.Column('prev_shares', sa.BigInteger, nullable=True),
        sa.Column('prev_pct', sa.Numeric(8, 4), nullable=True),
        sa.Column('curr_shares', sa.BigInteger, nullable=True),
        sa.Column('curr_pct', sa.Numeric(8, 4), nullable=True),
        sa.Column('change_shares', sa.BigInteger, nullable=True),
        sa.Column('change_pct', sa.Numeric(8, 4), nullable=True),
        sa.Column('nationality', sa.String(30), nullable=True),
        sa.Column('action_type', sa.String(10), nullable=True),
        sa.Column('source', sa.String(10), nullable=True),
        sa.Column('price_at_disclosure', sa.Numeric(20, 2), nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.UniqueConstraint('stock_id', 'holder_id', 'disclosure_date', name='uq_major_holder_stock_id_date'),
    )


def downgrade() -> None:
    op.drop_table('major_holder_movements')
