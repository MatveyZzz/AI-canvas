# AI Canvas

Визуальная среда для работы с нейросетями: бесконечное полотно, узлы-диалоги, ветвление и управление контекстом.

**Провайдер по умолчанию — DeepSeek** (`deepseek-chat` / `deepseek-reasoner`). OpenAI оставлен как резервный совместимый провайдер (registry-подход: новые провайдеры добавляются реализацией интерфейса `LlmProvider`).

## Структура проекта

```
server/          Node.js + TypeScript + Express + SQLite (better-sqlite3)
  src/ai/        AI Service: интерфейс LlmProvider, deepseek.ts, openai.ts, registry.ts, context.ts (Context Engine)
  src/db/        Persistence Layer: schema.sql, store.ts
  src/routes/    REST API + SSE-стриминг генерации
client/          React + TypeScript + Vite + Tailwind + React Flow (@xyflow/react) + Zustand
```

## Запуск

### 1. Сервер

```bash
cd server
npm install
cp .env.example .env        # укажите DEEPSEEK_API_KEY (https://platform.deepseek.com → API Keys)
npm run dev                 # http://localhost:8787
```

API-ключ хранится **только на сервере** и никогда не отправляется в браузер. Все запросы к DeepSeek идут через серверный слой (SSE-стриминг).

Без ключа приложение не имитирует ответы: `/api/health` и UI показывают инструкцию по настройке `DEEPSEEK_API_KEY`.

### 2. Клиент

```bash
cd client
npm install
npm run dev                 # http://localhost:5173
```

## Переменные окружения (server/.env)

| Переменная | Описание |
|---|---|
| `DEEPSEEK_API_KEY` | Ключ DeepSeek (обязателен для реальной генерации) |
| `DEEPSEEK_BASE_URL` | Необязательно, по умолчанию `https://api.deepseek.com` |
| `DEEPSEEK_MODELS` | Необязательный список моделей `id:Label:contextWindow,...` |
| `OPENAI_API_KEY` | Резервный провайдер (OpenAI-совместимый) |
| `PORT` / `DB_FILE` | Порт сервера (8787) / файл SQLite (`./data/ai-canvas.db`) |

## Основные функции

- Бесконечное полотно (React Flow): панорамирование, зум, выделение рамкой, мини-карта, undo/redo, связи трёх типов (parent / related / derived).
- Узлы: AI Chat, Note, Idea, Summary, Task; компактный и расширенный режимы.
- Диалоги с DeepSeek: стриминг, остановка генерации, регенерация, Markdown, учёт токенов, нормализованные ошибки провайдера.
- Ветвление: дочерний узел из диалога, конкретного сообщения или фрагмента; история родителя не изменяется.
- Context Engine: режимы current / parent / selected / workspace, предпросмотр контекста, ограничение по окну модели (128K), детерминированная компакция через сводки.
- Синтез: выделение нескольких узлов → новый AI Chat с объединённым контекстом.
- Поиск по названиям/заметкам/сообщениям с переходом к узлу.
- Постоянное хранение в SQLite; полное восстановление рабочего пространства после перезагрузки.

## Тесты

```bash
cd server && npm test       # Vitest: выбор провайдера по умолчанию, модели DeepSeek, env-ключ, нормализация ошибок
```
