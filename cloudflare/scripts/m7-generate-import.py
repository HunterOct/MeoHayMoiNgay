import sqlite3, base64, hashlib, os, uuid
from pathlib import Path

SOURCE = "D:/Github/MeoHayMoiNgay/data/blog.db"
OUT = Path("backups/m7-migration/import.sql")
REBUILD = Path("backups/m7-migration/rebuild.sql")

src = sqlite3.connect(f"file:{SOURCE}?mode=ro", uri=True)
src.row_factory = sqlite3.Row
lines = []

def val(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def insert(table, cols, rows, mode="INSERT OR IGNORE"):
    if not rows:
        return
    lines.append(f"-- {table}: {len(rows)} rows")
    for row in rows:
        lines.append(
            f'{mode} INTO {table} ({",".join(cols)}) VALUES ({",".join(val(row[c]) for c in cols)});'
        )

# Test-only credential for the isolated DB; production migration must preserve source hash.
salt = os.urandom(16)
key = hashlib.scrypt(b"M7-Test-Password-123", salt=salt, n=16384, r=8, p=1, dklen=64)
b64 = lambda b: base64.b64encode(b).decode()
test_hash = f"scrypt$16384$8$1${b64(salt)}${b64(key)}"

preserve_password_hash = os.environ.get("M7_PRESERVE_PASSWORD_HASH") == "1"
users = [
    {
        **dict(r),
        "password_hash": dict(r)["password_hash"] if preserve_password_hash else test_hash,
        "failed_attempts": 0,
        "locked_until": None,
        "last_login_at": None,
    }
    for r in src.execute(
        "SELECT id,email,name,role,is_active,bio,created_at,updated_at,password_hash FROM users"
    )
]
insert(
    "users",
    [
        "id",
        "email",
        "password_hash",
        "name",
        "role",
        "is_active",
        "bio",
        "failed_attempts",
        "locked_until",
        "last_login_at",
        "created_at",
        "updated_at",
    ],
    users,
)
insert(
    "categories",
    ["id", "name", "slug", "group_name", "description", "sort_order", "created_at", "updated_at"],
    [dict(r) for r in src.execute(
        "SELECT id,name,slug,group_name,description,sort_order,created_at,updated_at FROM categories"
    )],
)
insert("tags", ["id", "name", "slug"], [dict(r) for r in src.execute("SELECT id,name,slug FROM tags")])
insert(
    "posts",
    [
        "id", "slug", "title", "excerpt", "lede", "content_html", "content_source", "content_format",
        "status", "category_id", "author_id", "cover_image", "cover_alt", "cover_caption", "seo_title",
        "seo_description", "focus_keyword", "canonical_url", "og_image", "is_featured", "read_minutes",
        "views", "published_at", "scheduled_at", "created_at", "updated_at", "deleted_at",
        "api_client_id", "external_id", "origin", "version", "change_id",
    ],
    [
        {**dict(r), "version": 1, "change_id": uuid.uuid4().hex}
        for r in src.execute(
            "SELECT id,slug,title,excerpt,lede,content_html,content_source,content_format,status,"
            "category_id,author_id,cover_image,cover_alt,cover_caption,seo_title,seo_description,"
            "focus_keyword,canonical_url,og_image,is_featured,read_minutes,views,published_at,"
            "scheduled_at,created_at,updated_at,deleted_at,api_client_id,external_id,origin FROM posts"
        )
    ],
)
insert("post_tags", ["post_id", "tag_id"], [dict(r) for r in src.execute("SELECT post_id,tag_id FROM post_tags")])
insert(
    "revisions",
    [
        "id", "post_id", "title", "excerpt", "content_html", "content_source", "content_format",
        "seo_title", "seo_description", "cover_image", "status", "edited_by_type", "edited_by_id",
        "created_at",
    ],
    [dict(r) for r in src.execute(
        "SELECT id,post_id,title,excerpt,content_html,content_source,content_format,seo_title,"
        "seo_description,cover_image,status,edited_by_type,edited_by_id,created_at FROM revisions"
    )],
)
insert(
    "slug_history",
    ["id", "post_id", "slug", "created_at"],
    [dict(r) for r in src.execute("SELECT id,post_id,slug,created_at FROM slug_history")],
)
insert(
    "media",
    ["id", "filename", "original_name", "mime", "size", "width", "height", "alt", "created_at"],
    [dict(r) for r in src.execute(
        "SELECT id,filename,original_name,mime,size,width,height,alt,created_at FROM media"
    )],
)
insert("media_usages", ["media_id", "post_id"], [dict(r) for r in src.execute("SELECT media_id,post_id FROM media_usages")])
insert(
    "audit_log",
    ["id", "actor_type", "actor_id", "action", "entity_type", "entity_id", "meta", "ip", "user_agent", "created_at"],
    [dict(r) for r in src.execute(
        "SELECT id,actor_type,actor_id,action,entity_type,entity_id,meta,ip,user_agent,created_at FROM audit_log"
    )],
)
insert(
    "api_clients",
    [
        "id", "name", "key_id", "key_hash", "scopes", "publish_mode", "rate_limit_per_min",
        "is_active", "revoked_at", "created_at", "last_used_at",
    ],
    [dict(r) for r in src.execute(
        "SELECT id,name,key_id,key_hash,scopes,publish_mode,rate_limit_per_min,is_active,"
        "revoked_at,created_at,last_used_at FROM api_clients"
    )],
)
for r in src.execute("SELECT key,value FROM settings"):
    lines.append(
        f"INSERT INTO settings (key,value) VALUES ({val(r['key'])},{val(r['value'])}) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value;"
    )

# newline='\n' is critical: Windows default CRLF would inject \r into content.
with OUT.open("w", encoding="utf-8", newline="\n") as handle:
    handle.write("\n".join(lines) + "\n")

REBUILD.write_text(
    """DELETE FROM posts_fts;
INSERT INTO posts_fts (post_id,title,excerpt,content)
SELECT id,title,excerpt,COALESCE(NULLIF(content_source,''),content_html) FROM posts;
UPDATE categories SET cached_post_count=(SELECT COUNT(*) FROM posts p WHERE p.category_id=categories.id AND p.status='published' AND p.deleted_at IS NULL);
UPDATE tags SET cached_post_count=(SELECT COUNT(*) FROM post_tags pt JOIN posts p ON p.id=pt.post_id WHERE pt.tag_id=tags.id AND p.status='published' AND p.deleted_at IS NULL);
DELETE FROM counters;
INSERT INTO counters(key,value) VALUES ('published_posts',(SELECT COUNT(*) FROM posts WHERE status='published' AND deleted_at IS NULL));
""",
    encoding="utf-8",
    newline="\n",
)
print(f"generated {OUT} ({OUT.stat().st_size} bytes)")
src.close()
