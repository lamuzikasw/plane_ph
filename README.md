# Как запускать проект Plane локально

Рабочая папка проекта:

```bash
cd /Users/lamuzikasw/plane
```

## 1. Что должно быть установлено

- Docker Desktop
- Node.js
- pnpm

Проверь:

```bash
docker --version
node --version
pnpm --version
```

## 2. Первый запуск после клона

Если зависимости еще не установлены:

```bash
pnpm install
```

Если нет `.env` файлов или проект запускается впервые:

```bash
./setup.sh
```

## 3. Запуск backend и сервисов

Запусти Docker Desktop, затем из корня проекта:

```bash
docker compose -f docker-compose-local.yml up -d plane-db plane-redis plane-mq plane-minio api worker beat-worker
```

Это поднимает:

- API: `http://127.0.0.1:8000`
- PostgreSQL
- Redis
- RabbitMQ
- MinIO
- фоновые воркеры

Проверить, что контейнеры запущены:

```bash
docker ps
```

## 4. Запуск frontend

В отдельном терминале:

```bash
cd /Users/lamuzikasw/plane
pnpm --filter=web dev
```

Терминал с frontend должен оставаться открытым.

Открывай приложение здесь:

```text
http://127.0.0.1:3000/seva/analytics/overview/
```

Обычный корневой адрес:

```text
http://127.0.0.1:3000/
```

## 5. Остановка проекта

Остановить frontend:

```bash
Ctrl + C
```

Остановить backend и сервисы:

```bash
docker compose -f docker-compose-local.yml down
```

Если нужно удалить локальные Docker volume с данными:

```bash
docker compose -f docker-compose-local.yml down -v
```

## 6. Быстрый дебаг

Если видишь экран `Plane didn't start up correctly`, проверь API:

```bash
docker logs --tail 100 plane-api-1
```

Проверить endpoint инстанса:

```bash
curl -i http://127.0.0.1:8000/api/instances/
```

Проверить, кто занимает порт frontend:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Проверить, кто занимает порт API:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

## 7. Самый короткий сценарий запуска

```bash
cd /Users/lamuzikasw/plane
docker compose -f docker-compose-local.yml up -d plane-db plane-redis plane-mq plane-minio api worker beat-worker
pnpm --filter=web dev
```

Потом открыть:

```text
http://127.0.0.1:3000/seva/analytics/overview/
```
