"""Add external_credentials table for encrypted scraped-service cookies

Revision ID: 004
Revises: 003
Create Date: 2026-05-01
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'external_credentials',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('service_name', sa.String(50), nullable=False, unique=True, index=True),
        sa.Column('encrypted_blob', sa.Text, nullable=False),
        sa.Column('note', sa.String(200), nullable=True),
        sa.Column('last_used_at', sa.DateTime, nullable=True),
        sa.Column('last_status', sa.String(20), nullable=True),
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('external_credentials')
