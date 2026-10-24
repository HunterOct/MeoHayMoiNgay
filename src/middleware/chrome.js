import { getSettings } from "../db/settings.js";
import { listCategories } from "../db/taxonomy.js";
import { listLatest } from "../db/posts.js";

/** Shared navigation/footer data for public pages. */
export function loadPublicChrome(req, res, next) {
  const settings = getSettings();
  const categories = listCategories({ withCounts: true });
  res.locals.settings = settings;
  res.locals.chrome = {
    categories,
    latest: listLatest(5),
    groups: [...new Set(categories.map((category) => category.group_name))],
  };
  next();
}
