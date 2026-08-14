"""add_oauth_tables

Revision ID: a7d8e9f0c1b2
Revises: a2c4e6f8b0d2
Create Date: 2026-08-14 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'a7d8e9f0c1b2'
down_revision: Union[str, Sequence[str], None] = 'a2c4e6f8b0d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    # 1. oauth_clients
    if 'oauth_clients' not in tables:
        op.create_table(
            'oauth_clients',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('client_id', sa.String(), nullable=False),
            sa.Column('client_secret_hash', sa.String(), nullable=True),
            sa.Column('client_name', sa.String(), nullable=False),
            sa.Column('redirect_uris', sa.ARRAY(sa.String()), nullable=False),
            sa.Column('grant_types', sa.ARRAY(sa.String()), nullable=False),
            sa.Column('response_types', sa.ARRAY(sa.String()), nullable=False),
            sa.Column('scope', sa.String(), nullable=False),
            sa.Column('is_confidential', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        )
        op.create_index('ix_oauth_clients_client_id', 'oauth_clients', ['client_id'], unique=True)
    else:
        cols = [c['name'] for c in insp.get_columns('oauth_clients')]
        if 'client_name' not in cols:
            op.add_column('oauth_clients', sa.Column('client_name', sa.String(), nullable=False, server_default='OAuth Client'))
        if 'redirect_uris' not in cols:
            op.add_column('oauth_clients', sa.Column('redirect_uris', sa.ARRAY(sa.String()), nullable=False, server_default='{}'))
        if 'grant_types' not in cols:
            op.add_column('oauth_clients', sa.Column('grant_types', sa.ARRAY(sa.String()), nullable=False, server_default='{"authorization_code", "refresh_token"}'))
        if 'response_types' not in cols:
            op.add_column('oauth_clients', sa.Column('response_types', sa.ARRAY(sa.String()), nullable=False, server_default='{"code"}'))
        if 'scope' not in cols:
            op.add_column('oauth_clients', sa.Column('scope', sa.String(), nullable=False, server_default='profile:read profile:write resume:generate resume:edit offline_access'))
        if 'is_confidential' not in cols:
            op.add_column('oauth_clients', sa.Column('is_confidential', sa.Boolean(), nullable=False, server_default='false'))
        if 'client_secret_hash' not in cols:
            op.add_column('oauth_clients', sa.Column('client_secret_hash', sa.String(), nullable=True))

    # 2. oauth_authorization_codes
    if 'oauth_authorization_codes' not in tables:
        op.create_table(
            'oauth_authorization_codes',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('code_hash', sa.String(), nullable=False),
            sa.Column('client_id', sa.String(), nullable=False),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('redirect_uri', sa.String(), nullable=False),
            sa.Column('scope', sa.String(), nullable=False),
            sa.Column('code_challenge', sa.String(), nullable=False),
            sa.Column('code_challenge_method', sa.String(), nullable=False, server_default='S256'),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('used', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        )
        op.create_index('ix_oauth_authorization_codes_code_hash', 'oauth_authorization_codes', ['code_hash'], unique=True)
        op.create_index('ix_oauth_authorization_codes_client_id', 'oauth_authorization_codes', ['client_id'])
        op.create_index('ix_oauth_authorization_codes_user_id', 'oauth_authorization_codes', ['user_id'])

    # 3. oauth_refresh_tokens
    if 'oauth_refresh_tokens' not in tables:
        op.create_table(
            'oauth_refresh_tokens',
            sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column('token_hash', sa.String(), nullable=False),
            sa.Column('client_id', sa.String(), nullable=False),
            sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
            sa.Column('scope', sa.String(), nullable=False),
            sa.Column('family_id', postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('revoked', sa.Boolean(), nullable=False, server_default='false'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        )
        op.create_index('ix_oauth_refresh_tokens_token_hash', 'oauth_refresh_tokens', ['token_hash'], unique=True)
        op.create_index('ix_oauth_refresh_tokens_client_id', 'oauth_refresh_tokens', ['client_id'])
        op.create_index('ix_oauth_refresh_tokens_user_id', 'oauth_refresh_tokens', ['user_id'])
        op.create_index('ix_oauth_refresh_tokens_family_id', 'oauth_refresh_tokens', ['family_id'])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()

    if 'oauth_refresh_tokens' in tables:
        op.drop_index('ix_oauth_refresh_tokens_family_id', table_name='oauth_refresh_tokens')
        op.drop_index('ix_oauth_refresh_tokens_user_id', table_name='oauth_refresh_tokens')
        op.drop_index('ix_oauth_refresh_tokens_client_id', table_name='oauth_refresh_tokens')
        op.drop_index('ix_oauth_refresh_tokens_token_hash', table_name='oauth_refresh_tokens')
        op.drop_table('oauth_refresh_tokens')

    if 'oauth_authorization_codes' in tables:
        op.drop_index('ix_oauth_authorization_codes_user_id', table_name='oauth_authorization_codes')
        op.drop_index('ix_oauth_authorization_codes_client_id', table_name='oauth_authorization_codes')
        op.drop_index('ix_oauth_authorization_codes_code_hash', table_name='oauth_authorization_codes')
        op.drop_table('oauth_authorization_codes')

    if 'oauth_clients' in tables:
        op.drop_index('ix_oauth_clients_client_id', table_name='oauth_clients')
        op.drop_table('oauth_clients')
