// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import {sqliteTable,integer,text} from 'drizzle-orm/sqlite-core';
export const newsEditions=sqliteTable('news_editions',{
  generatedAt:integer('generated_at').primaryKey(),
  payload:text('payload').notNull(),
});
