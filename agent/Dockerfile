FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY collector.py .

RUN useradd --create-home --shell /bin/bash netatlas && chown -R netatlas:netatlas /app
USER netatlas

CMD ["python", "collector.py"]
