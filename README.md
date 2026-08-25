# SubBubble

Лёгкая mobile-first PWA для учёта подписок. Регулярные расходы отображаются как физические пузырьки: чем дороже подписка, тем пузырь больше и тяжелее.

## Возможности

- столкновения, отскоки, перетаскивание и инерция пузырьков;
- общий расход за месяц и год в рублях;
- RUB, USD, TRY и SGD с курсами к рублю;
- добавление, редактирование и удаление подписок;
- необязательные дата следующего платежа и категория;
- local-first хранение с опциональной синхронизацией через личный Space Key;
- privacy-friendly anonymous analytics для закрытого тестирования;
- офлайн-режим и установка на домашний экран.

## Запуск

Это статическое приложение. Откройте через любой локальный HTTP-сервер, например `python3 -m http.server 8080`, затем перейдите на `http://localhost:8080`.

## Публикация

Проект готов к GitHub Pages и работает из подпапки репозитория благодаря относительным URL.

## Sync Server

Основной сервер: `server/sync_server.py`.

Переменные окружения:

- `DATA_DIR` — директория isolated space state-файлов, по умолчанию `/opt/subbubble/data/spaces`.
- `ANALYTICS_FILE` — anonymous analytics, по умолчанию `/opt/subbubble/data/analytics.json`.
- `SYNC_TOKEN` — legacy owner key. Для owner используется `/opt/subbubble/data/subbubble.json`.
- Space Key приходит как Bearer token. Для non-owner spaces state-файл остаётся `/opt/subbubble/data/spaces/<sha256(raw_space_token).hexdigest()>.json`.
- `ADMIN_TOKEN` — отдельный обязательный токен для `GET /stats`.

`/stats` возвращает только агрегаты и требует `Authorization: Bearer $ADMIN_TOKEN`. Analytics не хранит названия подписок, суммы, валюты или исходные Space Keys.
