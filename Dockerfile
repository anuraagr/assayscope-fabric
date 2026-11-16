FROM node:24.22.2-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY contracts ./contracts
COPY rayfin/data ./rayfin/data
COPY rayfin/functions/src/types.ts ./rayfin/functions/src/types.ts
RUN npm run build

FROM python:3.12.13-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ASSAYSCOPE_DATA=/data
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY assayscope ./assayscope
COPY contracts ./contracts
COPY config ./config
COPY examples/lab-context.example.json ./examples/lab-context.example.json
COPY --from=frontend /app/dist ./dist
RUN groupadd --gid 10001 assayscope && useradd --uid 10001 --gid assayscope --no-create-home assayscope \
    && mkdir /data && chown assayscope:assayscope /data
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=240s --retries=6 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/status', timeout=3)"
CMD ["python", "-m", "uvicorn", "assayscope.server:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
