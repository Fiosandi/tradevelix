# Remora Trading Tools - Backend

## Setup

1. Install PostgreSQL 15 and create database:
```bash
createdb remora
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
```

3. Copy .env and configure:
```bash
cp ../.env.example .env
# Edit .env with your RAPIDAPI_KEY and DB credentials
```

4. Run database migrations:
```bash
alembic upgrade head
```

5. Start the server:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API Documentation

Once running, visit: http://localhost:8000/docs