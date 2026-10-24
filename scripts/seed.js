import { openDatabase, closeDb } from "../src/db/index.js";
import { config } from "../src/config.js";
import { ensureAdmin } from "./lib/admin.js";
import { listCategories, createCategory } from "../src/db/taxonomy.js";
import { LEGACY_CATEGORIES } from "./lib/legacy-taxonomy.js";

const db = openDatabase(config.dbPath);
console.log(`Database ready at ${config.dbPath}`);

const existingSlugs = new Set(listCategories().map((c) => c.slug));
let created = 0;
for (const category of Object.values(LEGACY_CATEGORIES)) {
  if (existingSlugs.has(category.slug)) continue;
  createCategory({
    name: category.name,
    slug: category.slug,
    group: category.group,
    description: category.description,
    sortOrder: category.sort,
  });
  created += 1;
}
console.log(`Categories: ${created} created, ${existingSlugs.size} already existed`);

const admin = await ensureAdmin();
if (admin.created) {
  console.log(`Admin created: ${admin.user.email}`);
  if (admin.password) console.log(`One-time admin password: ${admin.password}`);
} else {
  console.log(`Admin already exists: ${admin.user.email}`);
}

closeDb();
console.log("Seed complete. Next: npm run db:import-legacy");
