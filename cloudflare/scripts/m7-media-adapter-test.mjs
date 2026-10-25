import { getMediaProvider } from "../src/media.js";
import { deleteMediaById, getMediaById, serializeMedia, uploadMedia } from "../src/media-service.js";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const jpeg = new Uint8Array((await import("node:fs")).readFileSync("public/assets/img/img-001.jpg"));

function mockDb({ row = null, usage = 0, failInsert = false } = {}) {
  const state = { inserts: [], deletes: 0 };
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() {
              if (sql.includes("INSERT INTO media")) {
                if (failInsert) throw new Error("db write failed");
                state.inserts.push(args);
              }
              if (sql.includes("DELETE FROM media")) state.deletes += 1;
              return { meta: { changes: 1 } };
            },
            async first() {
              if (sql.includes("FROM media WHERE id")) return row;
              if (sql.includes("FROM media_usages")) return { n: usage };
              return null;
            },
          };
        },
      };
    },
  };
  return { db, state };
}

const puts = [];
const deletes = [];
const media = {
  async put(key, bytes) {
    puts.push({ key, bytes: bytes.length });
  },
  async get(key) {
    return { key, size: jpeg.length, httpMetadata: { contentType: "image/jpeg" }, body: jpeg };
  },
  async delete(key) {
    deletes.push(key);
  },
};
const baseEnv = { SITE_URL: "https://meohay.example", MEDIA_PROVIDER: "r2", MEDIA: media };

const provider = getMediaProvider(baseEnv);
check("provider r2 enabled", provider.enabled && provider.provider === "r2");
const object = await provider.get("media/x.jpg");
check("provider read returns object", object?.key === "media/x.jpg" && object.size === jpeg.length);

const successDb = mockDb();
const first = await uploadMedia({ ...baseEnv, DB: successDb.db }, {
  bytes: jpeg,
  originalName: "img-001.jpg",
  declaredMime: "image/jpeg",
  alt: "Ảnh thử",
});
check("upload success returns metadata", first.data?.mime === "image/jpeg" && first.data?.alt === "Ảnh thử");
check("upload writes one object and one row", puts.length === 1 && successDb.state.inserts.length === 1);
check("serialized public URL", first.data?.url?.startsWith("/media/") && first.data.url.endsWith(".jpg"));

const second = await uploadMedia({ ...baseEnv, DB: successDb.db }, {
  bytes: jpeg,
  originalName: "img-001.jpg",
  declaredMime: "image/jpeg",
});
check("duplicate upload gets unique object/key", second.data?.id !== first.data?.id && second.data?.filename !== first.data?.filename);
check("duplicate upload does not overwrite", puts.length === 2 && successDb.state.inserts.length === 2);

const failingPutEnv = {
  ...baseEnv,
  MEDIA: { ...media, async put() { throw new Error("storage down"); } },
  DB: mockDb().db,
};
let putFailed = false;
try {
  await uploadMedia(failingPutEnv, { bytes: jpeg, originalName: "x.jpg", declaredMime: "image/jpeg" });
} catch {
  putFailed = true;
}
check("storage failure does not fake success", putFailed);

const failDb = mockDb({ failInsert: true });
let dbFailed = false;
try {
  await uploadMedia({ ...baseEnv, DB: failDb.db }, { bytes: jpeg, originalName: "x.jpg", declaredMime: "image/jpeg" });
} catch {
  dbFailed = true;
}
check("metadata failure rolls back object", dbFailed && deletes.length === 1, `deletes=${deletes.length}`);

const row = {
  id: "media-1",
  filename: "abc.jpg",
  original_name: "abc.jpg",
  mime: "image/jpeg",
  size: 100,
  width: 10,
  height: 10,
  alt: "alt",
  created_at: "2026-10-25T00:00:00.000Z",
};
const lookupDb = mockDb({ row });
const found = await getMediaById(lookupDb.db, "media-1");
check("metadata lookup", found?.id === "media-1");
check("metadata serialization", serializeMedia(found)?.url === "/media/abc.jpg");

deletes.length = 0;
const deleteDb = mockDb({ row, usage: 0 });
const deleted = await deleteMediaById({ ...baseEnv, DB: deleteDb.db }, "media-1");
check("delete unused media", deleted.data?.id === "media-1" && deletes.length === 1 && deleteDb.state.deletes === 1);

deletes.length = 0;
const usedDb = mockDb({ row, usage: 2 });
const blocked = await deleteMediaById({ ...baseEnv, DB: usedDb.db }, "media-1");
check("delete used media rejected", blocked.error?.code === "media_in_use" && deletes.length === 0);

const disabled = await uploadMedia({ DB: mockDb().db, SITE_URL: "https://meohay.example", MEDIA_PROVIDER: "none" }, {
  bytes: jpeg,
  originalName: "x.jpg",
  declaredMime: "image/jpeg",
});
check("disabled provider returns 501", disabled.error?.status === 501);

const failed = results.filter((item) => !item.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
