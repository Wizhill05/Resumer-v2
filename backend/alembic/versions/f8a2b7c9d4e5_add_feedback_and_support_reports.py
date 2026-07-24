"""add_feedback_and_support_reports

Revision ID: f8a2b7c9d4e5
Revises: c1a4e9f20d83
Create Date: 2026-07-24 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f8a2b7c9d4e5'
down_revision: Union[str, Sequence[str], None] = '9d2e7a4c1b6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add columns to users table
    op.add_column('users', sa.Column('first_generation_completed', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('users', sa.Column('feedback_submitted', sa.Boolean(), server_default='false', nullable=False))

    # Create support_reports table
    op.create_table(
        'support_reports',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('email_override', sa.String(), nullable=True),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('status', sa.String(), server_default='open', nullable=False),
        sa.Column('admin_note', sa.Text(), nullable=True),
        sa.Column('category', sa.String(), nullable=True),
        sa.Column('auto_summary', sa.Text(), nullable=True),
        sa.Column('sentiment_score', sa.Float(), nullable=True),
        sa.Column('generation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('generations.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_support_reports_user_id', 'support_reports', ['user_id'])
    op.create_index('ix_support_reports_status', 'support_reports', ['status'])
    op.create_index('ix_support_reports_created_at', 'support_reports', ['created_at'])

    # Create report_attachments table
    op.create_table(
        'report_attachments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('report_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('support_reports.id', ondelete='CASCADE'), nullable=False),
        sa.Column('attachment_type', sa.String(), nullable=False),
        sa.Column('storage_key', sa.String(), nullable=False),
        sa.Column('filename', sa.String(), nullable=True),
        sa.Column('mime_type', sa.String(), nullable=True),
        sa.Column('file_size_bytes', sa.Integer(), nullable=True),
        sa.Column('transcription', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_report_attachments_report_id', 'report_attachments', ['report_id'])

    # Create feedback_ratings table
    op.create_table(
        'feedback_ratings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('generation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('generations.id', ondelete='SET NULL'), nullable=True),
        sa.Column('star_rating', sa.Integer(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('shown_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('dismissed', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_feedback_ratings_user_id', 'feedback_ratings', ['user_id'])
    op.create_index('uix_feedback_ratings_user_gen', 'feedback_ratings', ['user_id', 'generation_id'], unique=True)


def downgrade() -> None:
    op.drop_index('uix_feedback_ratings_user_gen', table_name='feedback_ratings')
    op.drop_index('ix_feedback_ratings_user_id', table_name='feedback_ratings')
    op.drop_table('feedback_ratings')

    op.drop_index('ix_report_attachments_report_id', table_name='report_attachments')
    op.drop_table('report_attachments')

    op.drop_index('ix_support_reports_created_at', table_name='support_reports')
    op.drop_index('ix_support_reports_status', table_name='support_reports')
    op.drop_index('ix_support_reports_user_id', table_name='support_reports')
    op.drop_table('support_reports')

    op.drop_column('users', 'feedback_submitted')
    op.drop_column('users', 'first_generation_completed')
