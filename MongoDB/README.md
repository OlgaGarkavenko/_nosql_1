# Spotify Tracks у MongoDB Atlas — домашнє завдання NoSQL №1

Проєкт завантажує датасет треків Spotify (~114 000 записів) у MongoDB Atlas,
перетворює плоску CSV-структуру на документоорієнтовану схему засобами
Aggregation Pipeline, виконує аналітичні запити та досліджує вплив індексів
на план виконання запитів.

---

## Зміст

1. [Структура репозиторію](#структура-репозиторію)
2. [Налаштування оточення та запуск](#налаштування-оточення-та-запуск)
3. [Частина 1 — Завантаження даних і схема](#частина-1--завантаження-даних-і-схема)
4. [Частина 2 — Запити до даних](#частина-2--запити-до-даних)
5. [Частина 3 — Індекси та оптимізація](#частина-3--індекси-та-оптимізація)

---

## Структура репозиторію

```
.
├── .env                    # рядок підключення до Atlas (НЕ в репозиторії)
├── .gitignore
├── requirements.txt        # Python-залежності
├── data/                   # датасет з Kaggle (НЕ в репозиторії)
│   └── dataset.csv
├── scripts/
│   ├── 01_load_data.py     # CSV → колекція tracks_raw
│   └── 02_transform.js     # tracks_raw → tracks (Aggregation Pipeline)
├── queries/
│   ├── part2_queries.js    # запити частини 2
│   └── part3_indexes.js    # індекси та explain() частини 3
└── README.md
```

Файли `.env` (містить пароль) і `data/` (великий датасет) додані в
`.gitignore` і в репозиторій не потрапляють.

---

## Налаштування оточення та запуск

### 1. MongoDB Atlas

1. Зареєструватися на [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. Створити безкоштовний кластер (тариф **Free / M0**, провайдер AWS,
   найближчий регіон). M0 уже працює як Replica Set із трьох нод.
3. **Database Access** — створити користувача бази з паролем
   (роль *Read and write to any database*).
4. **Network Access** — додати свій IP (або `0.0.0.0/0` для розробки).
5. **Connect -> Drivers** — скопіювати рядок підключення `mongodb+srv://...`.

### 2. Датасет

Завантажити [Spotify Tracks Dataset](https://www.kaggle.com/datasets/maharshipandya/-spotify-tracks-dataset)
з Kaggle і покласти файл `dataset.csv` у папку `data/`.

### 3. Python-залежності

Потрібен Python 3.11+.

```bash
python3 -m pip install -r requirements.txt
```

Вміст `requirements.txt`:

```
pymongo==4.7.3
pandas==3.0.3
kaggle==1.6.14
python-dotenv==1.0.1
tqdm==4.66.4
```

> **macOS:** якщо Python встановлено з python.org і під час підключення
> з'являється помилка `SSL: CERTIFICATE_VERIFY_FAILED`, потрібно один раз
> виконати `open "/Applications/Python 3.14/Install Certificates.command"`
> (номер версії — ваш).

### 4. Файл `.env`

У корені проєкту створити файл `.env` з одним рядком
(значення в лапках, бо рядок може містити `&`):

```
MONGO_URI="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/"
```

### 5. MongoDB Shell

JS-скрипти виконуються через `mongosh`:

```bash
brew install mongosh
```

### 6. Порядок запуску

Усі команди виконуються з кореня проєкту.

```bash
# 1. Завантаження CSV у колекцію tracks_raw
python3 scripts/01_load_data.py

# 2. Завантажити MONGO_URI з .env у поточну сесію термінала
#    (потрібно для mongosh; виконувати в кожному новому терміналі)
set -a; source .env; set +a

# 3. Трансформація tracks_raw → tracks
mongosh "$MONGO_URI" --file scripts/02_transform.js

# 4. Запити частини 2
mongosh "$MONGO_URI" --file queries/part2_queries.js

# 5. Індекси частини 3
mongosh "$MONGO_URI" --file queries/part3_indexes.js
```

Python-скрипт читає `.env` самостійно (`load_dotenv()`), а `mongosh` — ні,
тому для нього рядок підключення спочатку завантажується в змінну середовища.

Усі скрипти ідемпотентні: їх можна запускати повторно, вони спочатку
видаляють результати попереднього запуску (`drop()` / `dropIndexes()`).

---

## Частина 1 — Завантаження даних і схема

### 1.1. Завантаження сирих даних

`scripts/01_load_data.py`:

- читає CSV через `pandas`;
- явно приводить типи: `explicit` -> `bool`, `popularity`, `duration_ms`,
  `key`, `mode`, `time_signature` -> `int`, аудіохарактеристики → `float`
  (щоб у MongoDB числа зберігалися як числа, а не як рядки);
- відкидає записи без виконавця або назви треку;
- вставляє документи порціями по 1000 (`insert_many`) з індикатором `tqdm`;
- зберігає результат у базу `spotify`, колекцію `tracks_raw`.

Результат: у `tracks_raw` завантажено **113 999** документів (з 114 000 рядків
CSV відкинуто один запис без виконавця та назви). Після трансформації
колекція `tracks` містить ту саму кількість документів, що підтверджує
`explain()` у частині 3 (`totalDocsExamined: 113999` при повному скануванні).

### 1.2. Трансформація схеми

`scripts/02_transform.js` — Aggregation Pipeline з 5 стадій:

| Стадія | Що робить |
|---|---|
| `$project` | залишає потрібні поля, `artists` → `artists_raw` |
| `$addFields` + `$split` + `$map` + `$trim` | рядок `"Drake; Future"` → масив `["Drake", "Future"]` |
| `$addFields` | вкладений об'єкт `audio_features`, обчислювані `duration_sec` і `popularity_tier` |
| `$unset` | видаляє плоскі аудіополя та `artists_raw` |
| `$out` | записує результат у колекцію `tracks` |

### Схема документа в колекції `tracks`

| Поле | Тип | Опис |
|---|---|---|
| `_id` | ObjectId | ідентифікатор документа |
| `track_id` | string | ідентифікатор треку Spotify |
| `track_name` | string | назва треку |
| `album_name` | string | назва альбому |
| `artists` | array of string | виконавці |
| `explicit` | bool | наявність explicit-контенту |
| `popularity` | int (0–100) | популярність |
| `popularity_tier` | string | `high` (≥ 70), `medium` (40–69), `low` (< 40) |
| `duration_ms` | int | тривалість, мс |
| `duration_sec` | double | тривалість, с (1 знак після коми) |
| `track_genre` | string | жанр |
| `audio_features` | object | 12 аудіохарактеристик (див. приклад) |

Приклад документа:

```json
{
  "_id": { "$oid": "..." },
  "track_id": "5SuOikwiRyPMVoIQDJUgSV",
  "track_name": "Comedy",
  "album_name": "Comedy",
  "artists": ["Gen Hoshino"],
  "explicit": false,
  "popularity": 73,
  "popularity_tier": "high",
  "duration_ms": 230666,
  "duration_sec": 230.7,
  "track_genre": "acoustic",
  "audio_features": {
    "danceability": 0.676,
    "energy": 0.461,
    "loudness": -6.746,
    "speechiness": 0.143,
    "acousticness": 0.0322,
    "instrumentalness": 0.00000101,
    "liveness": 0.358,
    "valence": 0.715,
    "tempo": 87.917,
    "key": 1,
    "mode": 0,
    "time_signature": 4
  }
}
```

<!-- TODO: за бажанням замініть приклад на реальний документ з виводу 02_transform.js або додайте скриншот -->

### Теоретичні питання

#### Чому аудіохарактеристики винесені в окремий об'єкт `audio_features`, а не зберігаються плоско? Коли таке вкладення вигідне, а коли створює проблеми?

У CSV 12 аудіохарактеристик (`danceability`, `energy`, `tempo` тощо) лежать
на одному рівні з метаданими треку (`track_name`, `album_name`, `popularity`).
Логічно ж це дві різні групи даних: **що це за трек** і **як він звучить**.
Вкладений об'єкт `audio_features` відображає цю логіку в самій структурі
документа.

**Коли вкладення вигідне:**

- **Читабельність і самодокументованість.** Документ поділено на смислові
  блоки: одразу видно, які поля описують звучання.
- **Зручна проєкція.** Усю групу можна отримати або виключити одним полем:
  `{ audio_features: 1 }` замість переліку 12 полів. Наприклад, для
  каталогу треків достатньо метаданих — `{ audio_features: 0 }`.
- **Дані читаються разом.** Аудіохарактеристики завжди належать одному треку
  і зазвичай аналізуються разом, тому їх вигідно зберігати в тому ж
  документі (принцип MongoDB «що читається разом — зберігається разом»),
  без окремої колекції та `$lookup`.
- **Розширюваність.** Нові характеристики додаються всередину об'єкта,
  не засмічуючи верхній рівень.

**Коли вкладення створює проблеми:**

- **Довші шляхи до полів.** У запитах і індексах потрібна dot-нотація
  в лапках: `"audio_features.danceability"`. Легко помилитися: запит із
  неправильним шляхом не дає помилки, а просто повертає порожній результат.
- **Агрегації ускладнюються.** Для групування чи обчислень доводиться
  писати `"$audio_features.tempo"`, а у `$filter` / `$map` —
  `"$$t.audio_features.tempo"`.
- **Глибоке або необмежене вкладення.** Якщо вкладений об'єкт росте без
  обмежень (наприклад, масив, куди постійно дописуються елементи), документ
  може наблизитися до ліміту 16 МБ, а оновлення стають дорожчими. Для
  `audio_features` це не загроза: об'єкт має фіксовані 12 полів.
- **Незалежні дані.** Якщо вкладені дані потрібно часто оновлювати окремо від
  батьківського документа або використовувати в кількох документах, їх краще
  виносити в окрему колекцію.

#### Чому виконавці зберігаються як масив, а не як рядок? Які запити стають простішими?

У CSV виконавці записані одним рядком через крапку з комою: `"Drake; Future"`.
Для бази даних це просто текст: MongoDB не знає, що всередині кілька імен.
Після трансформації `artists` — це масив `["Drake", "Future"]`, і кожен
виконавець стає окремим значенням.

**Запити, які стають простішими:**

- **Пошук треків виконавця.** Точний збіг з будь-яким елементом масиву:
  ```js
  db.tracks.find({ artists: "Drake" })
  ```
  Із рядком довелося б шукати регулярним виразом (`/Drake/`), який
  повільний, не використовує індекс ефективно і дає хибні збіги
  (`"Drake"` знайдеться і в `"Drake Bell"`).
- **Треки кількох виконавців / спільні треки:**
  ```js
  db.tracks.find({ artists: { $in: ["Drake", "Future"] } })   // будь-хто з них
  db.tracks.find({ artists: { $all: ["Drake", "Future"] } })  // обидва разом
  ```
- **Кількість виконавців:** `{ artists: { $size: 1 } }` — сольні треки.
- **Аналітика по виконавцях.** `$unwind: "$artists"` розгортає масив, і далі
  можна групувати по кожному виконавцю окремо. Саме так побудовано
  [Завдання 2](#завдання-2-виконавці-у-яких-усі-треки-популярні) частини 2:
  трек із двома виконавцями зараховується кожному з них.
- **Індексація.** Індекс на полі-масиві стає *multikey index*: MongoDB
  індексує кожен елемент окремо, тож пошук за виконавцем працює через індекс.

---

## Частина 2 — Запити до даних

Усі запити знаходяться у файлі `queries/part2_queries.js`. Скрипт
починається з `db = db.getSiblingDB("spotify");`, щоб працювати з базою
`spotify`, а результати виводяться через `print` / `printjson`
(під час запуску з файлу `mongosh` не друкує результати автоматично).

### Завдання 1. Треки для вечірки

**Умова:** `danceability > 0.7`, `energy > 0.7`, тривалість від 3 до 5 хвилин
(180 000–300 000 мс).

```js
print("Треки що підходять для вечірки");
printjson(
  db.tracks.find({
    "audio_features.danceability": { $gt: 0.7 },
    "audio_features.energy": { $gt: 0.7 },
    duration_ms: { $gte: 180000, $lte: 300000 }
  })
  .sort({ "audio_features.danceability": -1 })
  .toArray()
);
```

**Пояснення:**

- `danceability` і `energy` після трансформації лежать у вкладеному об'єкті,
  тому звертання через dot-нотацію: `"audio_features.danceability"`.
- `$gt` — строго більше (умова «вище 0.7»); для тривалості `$gte` / `$lte`,
  бо межі 3 і 5 хвилин включні.
- Усі умови в одному об'єкті поєднуються логічним «І».
- `.sort(... : -1)` — найбільш «танцювальні» треки першими.
- `.toArray()` — `find()` повертає курсор; щоб надрукувати документи,
  їх потрібно зібрати в масив.

**Результат:** знайдено **7 311** треків. Першим у відсортованому списку
йде `Most Wanted` (Fast Eddie, жанр `chicago-house`): `danceability: 0.976`,
`energy: 0.98`, `duration_ms: 268051` (≈ 4 хв 28 с). Усі три умови виконано.

### Завдання 2. Виконавці, у яких усі треки популярні

**Умова:** виконавець популярний, якщо в нього щонайменше 3 треки і мінімальна
популярність цих треків ≥ 60. Вивести топ-20 з кількістю треків, мінімальною
та середньою популярністю (1 знак після коми).

```js
print("Топ-20 популярних артистів");
printjson(
  db.tracks.aggregate([
    { $unwind: "$artists" },
    {
      $group: {
        _id: "$artists",
        track_count: { $sum: 1 },
        min_popularity: { $min: "$popularity" },
        avg_popularity: { $avg: "$popularity" }
      }
    },
    { $match: { track_count: { $gte: 3 }, min_popularity: { $gte: 60 } } },
    { $sort: { avg_popularity: -1, track_count: -1 } },
    { $limit: 20 },
    {
      $project: {
        _id: 0,
        artist: "$_id",
        track_count: 1,
        min_popularity: { $round: ["$min_popularity", 1] },
        avg_popularity: { $round: ["$avg_popularity", 1] }
      }
    }
  ]).toArray()
);
```

**Пояснення:**

- Звичайний `find` тут не підходить, бо потрібно **рахувати** показники
  для кожного виконавця. Тому використано Aggregation Pipeline.
- `$unwind: "$artists"` розгортає масив виконавців: трек із двома
  виконавцями стає двома записами, і зараховується кожному з них.
- `$group` групує по виконавцю (аналог `GROUP BY`) і рахує кількість треків
  (`$sum: 1`), мінімальну (`$min`) і середню (`$avg`) популярність.
- `$match` після групування (аналог `HAVING`) залишає виконавців з ≥ 3
  треками, у яких **мінімальна** популярність ≥ 60. Умова на мінімум
  означає, що **всі** треки виконавця мають популярність ≥ 60.
- `popularity` в датасеті має шкалу 0–100, тому «60 %» = `60`.
- **Критерій «топу»:** завдання не уточнює порядок, тому сортування — за
  середньою популярністю за спаданням, при рівності — за кількістю треків.
- `$round: [..., 1]` округлює до одного знака після коми; `$project`
  перейменовує `_id` на `artist`.

> **Примітка щодо даних.** У датасеті один і той самий трек (`track_id`)
> може зустрічатися кілька разів із різними жанрами (`track_genre`).
> `$sum: 1` рахує записи, тож `track_count` враховує такі повтори.

**Результат:**

| # | Артист | Треків | Мін. популярність | Сер. популярність |
|---|---|---|---|---|
| 1 | Harry Styles | 3 | 89 | 92 |
| 2 | Luar La L | 4 | 90 | 90.5 |
| 3 | Olivia Rodrigo | 5 | 86 | 87.4 |
| 4 | BYOR | 4 | 87 | 87 |
| 5 | IVE | 3 | 79 | 84 |
| 6 | Måneskin | 12 | 76 | 83.7 |
| 7 | Lil Nas X | 11 | 77 | 83.5 |
| 8 | Morgan Wallen | 3 | 81 | 83.3 |
| 9 | One Direction | 5 | 80 | 83 |
| 10 | TV Girl | 5 | 80 | 82 |
| 11 | Mac DeMarco | 4 | 81 | 81.5 |
| 12 | Cults | 3 | 81 | 81.3 |
| 13 | Ricky Montgomery | 4 | 79 | 80.5 |
| 14 | Luke Combs | 3 | 79 | 80.3 |
| 15 | Declan McKenna | 3 | 80 | 80 |
| 16 | Joy Again | 3 | 80 | 80 |
| 17 | Mora | 7 | 69 | 79.7 |
| 18 | Maroon 5 | 3 | 70 | 79.7 |
| 19 | Beach Bunny | 7 | 73 | 79.4 |
| 20 | HVME | 3 | 75 | 79 |

**Перевірка результату:** у кожного артиста щонайменше 3 треки
(`track_count ≥ 3`) і мінімальна популярність не нижче 60 (найменше
значення в топі — 69 у Mora). Список відсортовано за середньою
популярністю за спаданням. Середня популярність округлена до одного знака
після коми (`87.4`, `83.7`); цілі значення на кшталт `92` чи `87` MongoDB
виводить без `.0`.

### Завдання 3. Нетипові треки

**Умова:** для кожного жанру знайти треки з `tempo > mean + 2 * stdDev`
(середнє — `$avg`, стандартне відхилення — `$stdDevPop` по жанру).

```js
print("Треки з незвично високим темпом");
const outliers = db.tracks.aggregate([
  {
    $group: {
      _id: "$track_genre",
      avg_tempo: { $avg: "$audio_features.tempo" },
      std_tempo: { $stdDevPop: "$audio_features.tempo" },
      tracks: {
        $push: {
          _id: "$_id",
          track_name: "$track_name",
          popularity: "$popularity",
          artists: "$artists",
          audio_features: { tempo: "$audio_features.tempo" }
        }
      }
    }
  },
  {
    $addFields: {
      outlier_threshold: { $add: ["$avg_tempo", { $multiply: [2, "$std_tempo"] }] }
    }
  },
  {
    $addFields: {
      outlier_tracks: {
        $filter: {
          input: "$tracks",
          as: "t",
          cond: { $gt: ["$$t.audio_features.tempo", "$outlier_threshold"] }
        }
      }
    }
  },
  { $match: { "outlier_tracks.0": { $exists: true } } },
  {
    $project: {
      _id: 0,
      genre: "$_id",
      avg_tempo: { $round: ["$avg_tempo", 1] },
      outlier_threshold: { $round: ["$outlier_threshold", 1] },
      outlier_tracks: 1
    }
  },
  { $sort: { genre: 1 } }
]).toArray();

print("Жанрів з нетиповими треками: " + outliers.length);
printjson(outliers);
```

**Пояснення:**

1. `$group` по `track_genre` рахує для кожного жанру середній темп (`$avg`)
   і стандартне відхилення (`$stdDevPop`), а також складає треки жанру в масив
   (`$push`) лише з потрібними полями. Вкладений `audio_features: { tempo }`
   відтворює структуру з прикладу в завданні.
2. Перший `$addFields` обчислює поріг за формулою
   `avg_tempo + 2 * std_tempo` (`$add` і `$multiply`).
3. Другий `$addFields` з `$filter` залишає в масиві лише треки, темп яких
   перевищує поріг (`$$t` — поточний елемент масиву).
4. `$match` з `"outlier_tracks.0": { $exists: true }` прибирає жанри, у яких
   нетипових треків немає (масив порожній).
5. `$project` формує поля `genre`, `avg_tempo`, `outlier_threshold`,
   `outlier_tracks`. Округлення робиться тільки для виводу — порівняння
   в кроці 3 виконується з точним порогом.

`$avg` і `$stdDevPop` — групові оператори, тож поріг можна обчислити лише
після групування. Збереження треків у масив на етапі `$group` дає змогу
відфільтрувати їх без повторного проходу по колекції.

Результат зберігається у змінну `outliers`: спочатку друкується кількість жанрів (`outliers.length`), потім усі жанри з їхніми нетиповими треками.

**Результат:** нетипові треки знайдено у **112 жанрах**. Перші три з них (за алфавітом):

| Жанр | `avg_tempo` | `outlier_threshold` | Нетипових треків |
|---|---|---|---|
| acoustic | 119 | 178.5 | 34 |
| afrobeat | 119.2 | 171.8 | 50 |
| alt-rock | 124.6 | 183.1 | 26 |

Фрагмент документа для жанру `acoustic`:

```js
{
  genre: 'acoustic',
  avg_tempo: 119,
  outlier_threshold: 178.5,
  outlier_tracks: [
    {
      _id: ObjectId('6aedc9a08945525a55c5f79d'),
      track_name: 'Fast Car',
      popularity: 61,
      artists: [ 'Boyce Avenue', 'Kina Grannis' ],
      audio_features: { tempo: 204.961 }
    },
    ...
  ]
}
```

**Перевірка результату:** значення для жанру `acoustic` (`avg_tempo: 119`,
`outlier_threshold: 178.5`) збігаються з прикладом у завданні. Темп усіх
наведених треків (наприклад, `Fast Car` — 204.961) вищий за поріг 178.5.

### Завдання 4. Треки для фонової роботи

**Умова:** `loudness < -10`, `speechiness < 0.1`, `instrumentalness > 0.5`,
без explicit-контенту.

```js
print("Треки для фонової роботи");
printjson(
  db.tracks.find({
    "audio_features.loudness": { $lt: -10 },
    "audio_features.speechiness": { $lt: 0.1 },
    "audio_features.instrumentalness": { $gt: 0.5 },
    explicit: false
  }).toArray()
);
```

**Пояснення:**

- `loudness` вимірюється в децибелах і завжди від'ємна: що менше значення,
  то тихіший трек, тому «тихі» — `$lt: -10`.
- Аудіохарактеристики — у `audio_features` (dot-нотація), а `explicit` —
  на верхньому рівні документа.
- `explicit: false` — логічне значення (у JavaScript пишеться з малої
  літери, на відміну від Python `False`).

**Результат:** знайдено **9 324** треки.

Приклад знайдених документів (фрагмент виводу):

```js
{
  track_name: 'Clean White Noise - Loopable with no fade',
  artists: [ 'White Noise Baby Sleep', 'White Noise for Babies' ],
  explicit: false,
  popularity: 85,
  track_genre: 'sleep',
  audio_features: {
    loudness: -28.46,
    speechiness: 0,
    instrumentalness: 1,
    tempo: 0,
    ...
  }
},
{
  track_name: 'Céntrate En Ti Mismo',
  artists: [ 'Reiki Armonía', 'Maestros de musica de la meditacion', ... ],
  explicit: false,
  track_genre: 'world-music',
  audio_features: {
    loudness: -27.251,
    speechiness: 0.0533,
    instrumentalness: 0.999,
    tempo: 35.79,
    ...
  }
}
```

**Аналіз результату.** Усі знайдені треки відповідають умовам: `loudness`
від -10.6 до -43.9 дБ, `speechiness` від 0 до 0.099, `instrumentalness`
0.998–1, `explicit: false`. Водночас серед результатів переважає жанр
`sleep`: білий шум, звуки дощу, фена, кондиціонера. Формально це «тихі
інструментальні треки без мовлення», але не музика. Ознака таких записів —
`tempo: 0`, `danceability: 0` і `time_signature: 0`. Якщо потрібна саме
музика для роботи, запит можна уточнити, наприклад, додавши умову
`"audio_features.tempo": { $gt: 0 }` або виключивши жанр `sleep`. Це добре
показує, що запит, правильний за умовою, варто перевіряти на реальних даних.

---

## Частина 3 — Індекси та оптимізація

Усі скрипти — у файлі `queries/part3_indexes.js`. На початку скрипт
видаляє індекси з попереднього запуску (`db.tracks.dropIndexes()`), щоб
`explain()` «до» справді виконувався без індексу.

### Завдання 1. Аналіз запиту та індексація

Запит:

```js
db.tracks.find({
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
}).sort({ popularity: -1 })
```

**Скрипт:**

```js
// explain() без індексу
const before = db.tracks.find({
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
}).sort({ popularity: -1 }).explain("executionStats");

// індекс за правилом ESR
db.tracks.createIndex({
  track_genre: 1,
  popularity: -1,
  "audio_features.danceability": 1
});

// explain() з індексом
const after = db.tracks.find({
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
}).sort({ popularity: -1 }).explain("executionStats");
```

**Вибір індексу — правило ESR (Equality → Sort → Range):**

| Позиція | Поле | Тип умови | Навіщо |
|---|---|---|---|
| E | `track_genre` | точний збіг | одразу відсікає всі жанри, крім `pop` |
| S | `popularity: -1` | сортування | записи в індексі вже впорядковані — окреме сортування не потрібне |
| R | `audio_features.danceability` | діапазон | фільтрується всередині вже відсортованого діапазону |

Якби діапазонне поле стояло перед полем сортування, індекс не зміг би
віддати результат у потрібному порядку, і MongoDB знову виконувала б
сортування в пам'яті.

**Ключові поля `explain("executionStats")`:**

| Показник | Без індексу | З індексом |
|---|---|---|
| Стадії `winningPlan` | `SORT` → `COLLSCAN` | `FETCH` → `IXSCAN` |
| `indexName` | — | `track_genre_1_popularity_-1_audio_features.danceability_1` |
| `nReturned` (знайдено) | 354 | 354 |
| `totalDocsExamined` (переглянуто) | **113 999** | **354** |

`indexBounds` після створення індексу:

```js
indexBounds: {
  track_genre: [ '["pop", "pop"]' ],
  popularity: [ '[MaxKey, MinKey]' ],
  'audio_features.danceability': [ '[0.7, inf.0]' ]
}
```

План **без індексу** (фрагмент виводу):

```js
{
  stage: 'SORT',
  sortPattern: { popularity: -1 },
  memLimit: 33554432,
  inputStage: {
    stage: 'COLLSCAN',
    filter: { '$and': [
      { track_genre: { '$eq': 'pop' } },
      { 'audio_features.danceability': { '$gte': 0.7 } }
    ] }
  }
}
```

План **з індексом** (фрагмент виводу):

```js
{
  stage: 'FETCH',
  inputStage: {
    stage: 'IXSCAN',
    keyPattern: { track_genre: 1, popularity: -1, 'audio_features.danceability': 1 },
    indexName: 'track_genre_1_popularity_-1_audio_features.danceability_1',
    indexBounds: { ... }
  }
}
```

<!-- TODO (за бажанням): додайте скриншот виводу з термінала -->
<!-- ![explain до і після](screenshots/part3_task1.png) -->

**Що змінилося в плані виконання?**

- **Без індексу** MongoDB виконує `COLLSCAN`: перебирає **всю** колекцію
  (113 999 документів) і для кожного перевіряє фільтр, щоб знайти лише
  354 відповідні. Потім окрема стадія `SORT` сортує їх за популярністю
  в оперативній пам'яті (`memLimit: 33554432` — ліміт 32 МБ на сортування
  в пам'яті; на більших обсягах такий запит міг би впасти з помилкою).
- **З індексом** план — `IXSCAN` -> `FETCH`. За `indexBounds` видно, як
  працює кожне поле індексу:
  - `track_genre: ["pop", "pop"]` — MongoDB одразу переходить до частини
    індексу з жанром `pop`, решта жанрів не переглядається;
  - `popularity: [MaxKey, MinKey]` — усередині жанру індекс проходиться
    від найвищої популярності до найнижчої, тобто записи **вже йдуть
    у порядку сортування**. Тому стадія `SORT` зникла;
  - `audio_features.danceability: [0.7, inf.0]` — умова `$gte: 0.7`
    перевіряється прямо в індексі, до читання документів.
- Після цього `FETCH` читає з колекції лише документи, що пройшли всі
  умови: **354 переглянуто — 354 знайдено**. Жодного зайвого читання.
- Кількість переглянутих документів зменшилася з 113 999 до 354, тобто
  **приблизно в 322 рази**. У цьому і полягає ефект індексу.

**Як зрозуміти, що індекс використовується?**

- у `queryPlanner.winningPlan` є стадія **`IXSCAN`** (замість `COLLSCAN`);
- в `IXSCAN` вказано **`indexName`** створеного індексу та `indexBounds`
  (межі пошуку, наприклад `track_genre: ["pop", "pop"]`);
- у плані **немає стадії `SORT`** — сортування бере на себе індекс;
- у `executionStats` `totalDocsExamined` = `nReturned` = 354, а не розмір
  усієї колекції (113 999).

### Завдання 2. Індекс для пошуку музики для роботи

```js
db.tracks.createIndex({
  explicit: 1,
  "audio_features.instrumentalness": 1,
  "audio_features.speechiness": 1
});

const workExplain = db.tracks.find({
  explicit: false,
  "audio_features.instrumentalness": { $gt: 0.5 },
  "audio_features.speechiness": { $lt: 0.1 }
}).explain("executionStats");
```

**Порядок полів (ESR):**

- `explicit` — умова точного збігу (`false`), тому стоїть першою;
- `instrumentalness` і `speechiness` — діапазони, тому йдуть після неї.
  Сортування в запиті немає.
- Серед діапазонних полів першим поставлено `instrumentalness`, бо умова
  `> 0.5` відсіює більшість треків (переважна частина пісень має вокал),
  тоді як `speechiness < 0.1` відсіює значно менше. Перше діапазонне поле
  MongoDB використовує найефективніше.

**Підтвердження використання індексу:**

| Показник | Значення |
|---|---|
| Стадії `winningPlan` | `FETCH` → `IXSCAN` |
| `indexName` | `explicit_1_audio_features.instrumentalness_1_audio_features.speechiness_1` |
| `nReturned` (знайдено) | 16 141 |
| `totalDocsExamined` (переглянуто) | 16 141 |

`indexBounds` з виводу:

```js
indexBounds: {
  explicit: [ '[false, false]' ],
  'audio_features.instrumentalness': [ '(0.5, inf.0]' ],
  'audio_features.speechiness': [ '[-inf.0, 0.1)' ]
}
```

**Пояснення:**

- Стадія `IXSCAN` з `indexName` саме створеного індексу підтверджує, що
  MongoDB використовує його для пошуку.
- Кожна умова запиту перетворилася на межу в `indexBounds`:
  - `explicit: [false, false]` — точний збіг `explicit: false`;
  - `instrumentalness: (0.5, inf.0]` — кругла дужка `(` означає, що 0.5
    **не включається** (строге `$gt: 0.5`);
  - `speechiness: [-inf.0, 0.1)` — 0.1 теж не включається (строге `$lt: 0.1`).
- Усі три умови перевіряються в індексі, тому
  `totalDocsExamined` = `nReturned` = 16 141: MongoDB читає з колекції
  лише ті документи, які гарантовано підходять. Без індексу для цього
  довелося б переглянути всі 113 999 документів.

**Ціна індексів.** Індекси пришвидшують читання, але займають пам'ять і диск
та сповільнюють запис: при кожній вставці чи оновленні документа MongoDB
оновлює всі індекси, що містять його поля. Тому індекси створюються лише під
запити, які виконуються часто, — як пошук музики для роботи в цьому завданні.

### Завдання 3. Покривний запит (covered query)

**Питання:** чи є запит

```js
db.tracks.find({
  track_genre: "pop",
  popularity: { $gte: 70 }
});
```

покривним, якщо існує індекс із завдання 1
`{ track_genre: 1, popularity: -1, "audio_features.danceability": 1 }`?

**Відповідь: ні, у такому вигляді запит не покривний.**

Запит є **покривним**, якщо MongoDB може відповісти на нього лише з індексу,
не читаючи самих документів. Для цього всі поля, які використовує запит
(і в умові, і в результаті), мають бути в індексі.

1. **Умова пошуку індексом покривається.** `track_genre` і `popularity` —
   перші два поля індексу (його префікс), тож MongoDB використовує індекс
   для пошуку (`IXSCAN`). Третє поле, `danceability`, запит не використовує:
   в `indexBounds` для нього стоїть `[MinKey, MaxKey]` («будь-яке значення»).
2. **Результат індексом не покривається.** У запиті немає проєкції, тому
   повертаються документи повністю: `track_name`, `artists`, `album_name`,
   `audio_features` тощо. Цих полів в індексі немає, тож для кожного
   знайденого запису MongoDB відкриває документ у колекції (стадія `FETCH`).
3. Поле **`_id`** повертається за замовчуванням, але його в індексі теж немає.

Отже, план — `IXSCAN` -> `FETCH`, а `totalDocsExamined` дорівнює кількості
знайдених документів.

**Як зробити запит покривним** — додати проєкцію лише з полями індексу
та явно виключити `_id`:

```js
db.tracks.find(
  { track_genre: "pop", popularity: { $gte: 70 } },
  { _id: 0, track_genre: 1, popularity: 1 }
);
```

Перевірка через `explain("executionStats")` (фрагмент виводу):

```js
{
  stage: 'PROJECTION_COVERED',
  transformBy: { _id: 0, track_genre: 1, popularity: 1 },
  inputStage: {
    stage: 'IXSCAN',
    indexName: 'track_genre_1_popularity_-1_audio_features.danceability_1',
    indexBounds: {
      track_genre: [ '["pop", "pop"]' ],
      popularity: [ '[inf.0, 70]' ],
      'audio_features.danceability': [ '[MinKey, MaxKey]' ]
    }
  }
}
Переглянуто документів: 0
```

| Показник | Значення |
|---|---|
| Стадії `winningPlan` | `PROJECTION_COVERED` → `IXSCAN` (без `FETCH`) |
| `indexBounds.popularity` | `[inf.0, 70]` — від найвищої популярності до 70 |
| `indexBounds.audio_features.danceability` | `[MinKey, MaxKey]` — поле не використовується |
| `totalDocsExamined` | **0** |

- **`PROJECTION_COVERED`** — MongoDB сама позначає, що проєкцію виконано
  лише з даних індексу.
- **Стадії `FETCH` немає** — документи з колекції не читалися.
- **`totalDocsExamined: 0`** — це головний доказ: запит знайшов поп-треки
  з популярністю ≥ 70, не відкривши жодного документа.
- `danceability: [MinKey, MaxKey]` показує, що MongoDB використала лише
  **префікс** індексу (перші два поля), а третє поле не обмежувала.

`totalDocsExamined: 0` і відсутність стадії `FETCH` доводять, що запит
повністю виконано з індексу, без читання жодного документа. Такий запит
швидший, бо індекс компактний і зазвичай знаходиться в оперативній пам'яті,
а читання документів — найдорожча частина виконання.

### Підсумок частини 3

| Запит | План виконання | Переглянуто документів | Знайдено |
|---|---|---|---|
| Завдання 1, без індексу | `SORT` → `COLLSCAN` | 113 999 | 354 |
| Завдання 1, з індексом | `FETCH` → `IXSCAN` | 354 | 354 |
| Завдання 2 (музика для роботи) | `FETCH` → `IXSCAN` | 16 141 | 16 141 |
| Завдання 3 (покривний запит) | `PROJECTION_COVERED` → `IXSCAN` | **0** | — |

**Висновки:**

- Без індексу MongoDB перебирає всю колекцію (`COLLSCAN`) і окремо сортує
  результат у пам'яті (`SORT`). Складений індекс, побудований за правилом
  ESR, прибирає і повний перебір, і окреме сортування.
- В обох запитах з індексом `totalDocsExamined` = `nReturned`: MongoDB
  читає з колекції лише ті документи, які гарантовано відповідають умові.
- Покривний запит не читає документів узагалі (`totalDocsExamined: 0`),
  бо всі потрібні йому поля є в індексі, а `_id` виключено з проєкції.
- Індекси пришвидшують читання, але займають пам'ять і сповільнюють запис,
  тому їх варто створювати під запити, що виконуються часто.
