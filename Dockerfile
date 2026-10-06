FROM python:3.12-slim
ARG INSTALL_LOCAL_MODEL=false
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 RAF_HOST=0.0.0.0 PORT=8000 RAF_DB=/app/var/raf.sqlite3
COPY requirements.txt .
COPY requirements-semantic.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$INSTALL_LOCAL_MODEL" = "true" ]; then pip install --no-cache-dir -r requirements-semantic.txt; fi \
    && useradd --create-home raf
COPY raf ./raf
COPY web ./web
COPY evaluation ./evaluation
COPY tools ./tools
RUN mkdir -p /app/var && chown -R raf:raf /app
USER raf
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=3)"
CMD ["python", "-m", "raf.production"]
