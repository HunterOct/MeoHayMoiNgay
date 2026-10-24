import { openDatabase, closeDb, getDb } from "../src/db/index.js";
import { config } from "../src/config.js";
import { setTagsFor } from "../src/db/posts.js";
import { tagsForLegacy } from "./lib/legacy-taxonomy.js";

openDatabase(config.dbPath);
const rows = getDb()
  .prepare("SELECT id, title, excerpt, lede FROM posts WHERE origin = 'legacy'")
  .all();
let tagged = 0;
for (const row of rows) {
  const tags = tagsForLegacy(row);
  setTagsFor(row.id, tags);
  if (tags.length) tagged += 1;
}
console.log(`Re-tagged ${rows.length} legacy posts (${tagged} with at least one tag).`);
closeDb();
