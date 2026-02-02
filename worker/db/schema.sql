CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  ownerKey TEXT NOT NULL,
  createdAtMs INTEGER NOT NULL,
  updatedAtMs INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS quizzes_ownerKey_updatedAtMs ON quizzes(ownerKey, updatedAtMs DESC);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  quizId TEXT NOT NULL,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  timeLimitMs INTEGER NOT NULL,
  pointsMultiplier INTEGER NOT NULL,
  imageKey TEXT,
  createdAtMs INTEGER NOT NULL,
  updatedAtMs INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS questions_quizId_position ON questions(quizId, position);

CREATE TABLE IF NOT EXISTS options (
  id TEXT PRIMARY KEY,
  questionId TEXT NOT NULL,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS options_questionId_position ON options(questionId, position);

CREATE TABLE IF NOT EXISTS answers (
  questionId TEXT NOT NULL,
  optionPosition INTEGER NOT NULL,
  PRIMARY KEY(questionId, optionPosition)
);
