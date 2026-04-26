from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
from uuid import uuid4
from app.models.base import Base


class User(Base):
    __tablename__ = "users"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    email        = Column(String(255), unique=True, nullable=False, index=True)
    username     = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    is_active    = Column(Boolean, default=True, nullable=False)
    is_admin     = Column(Boolean, default=False, nullable=False)
    is_paid      = Column(Boolean, default=False, nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login   = Column(DateTime, nullable=True)
