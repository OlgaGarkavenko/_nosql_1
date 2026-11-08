db = db.getSiblingDB("spotify");

// Запит 1: 
print("Треки що підходять для вечірки")
printjson(
  db.tracks.find(
    {
      "audio_features.danceability":{$gt: 0.7},
      "audio_features.energy":{$gt: 0.7},
      duration_ms:{$gte: 180000, $lte: 300000}
    }
  )
  .sort({"audio_features.danceability": -1})
  .toArray()
)

//Запит 2: 
print("Топ-20 популярних артистів")
printjson(
  db.tracks.aggregate([
    // 1. Окремий запис для кожного артиста треку
    { $unwind: "$artists" },
    // 2. Групую по артисту і рахую показники
    {
      $group: {
        _id: "$artists",
        track_count:    { $sum: 1 },
        min_popularity: { $min: "$popularity" },
        avg_popularity: { $avg: "$popularity" }
      }
    },
    // 3. Умова «популярного» артиста
    {
      $match: {
        track_count:    { $gte: 3 },
        min_popularity: { $gte: 60 }
      }
    },
    // 4. Топ: спочатку найвища середня популярність
    { $sort: { avg_popularity: -1, track_count: -1 } },
    // 5. Беру 20 перших
    { $limit: 20 },
    // 6. Вивід: ім'я, кількість, мін. і сер. популярність (1 знак після коми)
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

// Запит 3. 
print("Треки з незвично високим темпом");

const result = db.tracks.aggregate([
  // 1. Групую по жанру: рахую статистику і зберігаю треки жанру
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
  // 2. Рахую поріг: середнє + 2 * стандартне відхилення
  {
    $addFields: {
      outlier_threshold: {
        $add: ["$avg_tempo", { $multiply: [2, "$std_tempo"] }]
      }
    }
  },

  // 3. Залишаю в масиві лише треки, темп яких вищий за поріг
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

  // 4. Прибираю жанри, де нетипових треків немає
  { $match: { "outlier_tracks.0": { $exists: true } } },

  // 5. Формую результат у потрібному вигляді
  {
    $project: {
      _id: 0,
      genre: "$_id",
      avg_tempo: { $round: ["$avg_tempo", 1] },
      outlier_threshold: { $round: ["$outlier_threshold", 1] },
      outlier_tracks: 1
    }
  },

  // 6. Сортую за назвою жанру
  { $sort: { genre: 1 } }
]).toArray();

print("Жанрів з нетиповими треками: " + result.length);
printjson(result.slice(0, 3));   // показую перші 3 жанри

//Запит 4.
print("Треки для фонової роботи")
printjson(
  db.tracks.find(
    {
      "audio_features.loudness":{$lt: -10},
      "audio_features.speechiness":{$lt: 0.1},
      "audio_features.instrumentalness":{$gt: 0.5},
      explicit: false
    }
  ).toArray()
)