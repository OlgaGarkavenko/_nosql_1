//Запит 1.
db = db.getSiblingDB("spotify");
db.tracks.dropIndexes();   // прибираю індекси з минулого запуску

// Крок 1: explain() без індексу
print("=== Без індексу ===");
const before = db.tracks.find({
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
}).sort({ popularity: -1 }).explain("executionStats");

printjson(before.queryPlanner.winningPlan);
print("Переглянуто документів: " + before.executionStats.totalDocsExamined);
print("Знайдено документів: " + before.executionStats.nReturned);

// Крок 2: створюю індекс
db.tracks.createIndex({
  track_genre: 1,
  popularity: -1,
  "audio_features.danceability": 1
});
print("Індекс створено");

// Крок 3: explain() з індексом
print("=== З індексом ===");
const after = db.tracks.find({
  track_genre: "pop",
  "audio_features.danceability": { $gte: 0.7 }
}).sort({ popularity: -1 }).explain("executionStats");

printjson(after.queryPlanner.winningPlan);
print("Переглянуто документів: " + after.executionStats.totalDocsExamined);
print("Знайдено документів: " + after.executionStats.nReturned);


// Запит 2: індекс для пошуку музики для роботи
db.tracks.createIndex({
  explicit: 1,
  "audio_features.instrumentalness": 1,
  "audio_features.speechiness": 1
});
print("Індекс створено");

const workExplain = db.tracks.find({
  explicit: false,
  "audio_features.instrumentalness": { $gt: 0.5 },
  "audio_features.speechiness": { $lt: 0.1 }
}).explain("executionStats");

printjson(workExplain.queryPlanner.winningPlan);
print("Переглянуто документів: " + workExplain.executionStats.totalDocsExamined);
print("Знайдено документів: " + workExplain.executionStats.nReturned);


//Запит 3. Покривний запит
print("Покривний запит");
const covered = db.tracks.find(
  { track_genre: "pop", popularity: { $gte: 70 } },
  { _id: 0, track_genre: 1, popularity: 1 }
).explain("executionStats");

printjson(covered.queryPlanner.winningPlan);
print("Переглянуто документів: " + covered.executionStats.totalDocsExamined);