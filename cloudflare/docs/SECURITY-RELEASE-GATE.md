# M7 — Security Release Gate Checklist

**Phạm vi:** staging/app-level đã kiểm chứng; zone/WAF/Access chưa.

| Hạng mục | Trạng thái | Bằng chứng / điều kiện |
|---|---|---|
| Login/password hashing | **PASS** | scrypt trong DO; M2 74/74, security 17/17 |
| Session fixation/expiry/revocation | **PASS** | M2 security; cookie HttpOnly/Secure/SameSite |
| Logout/disable user | **PASS** | Session revoked tests |
| Brute force/lockout/rate | **PASS** | Login lock + 429 |
| Backend RBAC/IDOR | **PASS** | M2; author/editor checks |
| Admin-only actions | **PASS** | M2 |
| CSRF | **PASS** | Missing/cross-origin 403 |
| API scopes/revocation/review bypass | **PASS** | M3 28/28 |
| OCC/If-Match | **PASS** | M4 12/12; M5 26/26 |
| Idempotency/external_id | **PASS** | M3/M5 |
| Stored XSS/sanitize | **PASS** | Sanitizer; content image HTTPS filter |
| Malformed/large payload | **PASS** | 1 MB body; 8 MB image; 200k content |
| SQL injection | **PASS (code audit)** | Prepared bindings |
| SSRF | **MITIGATED** | Không fetch media URL server-side |
| Unsafe redirect/path traversal | **PASS/MITIGATED** | safeNext, media filename regex |
| Error leakage | **MITIGATED** | Generic 500; request_id |
| Secrets in source/log/audit | **PASS** | Local gitignored; audit no secrets |
| Session cleanup | **PASS** | Cron cleanup batch |
| Audit retention | **PARTIAL** | Policy chưa chốt |
| Anti-scraping app-level | **PASS** | API/login/search limits; UA/robots |
| Verified crawler behavior | **PASS (staging)** | Googlebot UA tests; chưa có zone verified bot |
| Backup/restore | **PASS** | 24/24; Time Travel; encrypted backup |
| Incident response | **PARTIAL** | Runbook có; chưa có on-call production |
| WAF custom/rate | **NOT VERIFIED** | Cần preproduction zone |
| Cloudflare Access | **NOT VERIFIED** | Chưa bật |
| Bot Fight Mode | **NOT VERIFIED / DO NOT ENABLE** | Có thể chặn API |
| Production secrets recovery | **PARTIAL** | Quy trình đề xuất; chưa diễn tập |

## Gate rules

- Không release nếu có lỗi CONFIRMED nghiêm trọng chưa sửa.
- Không bật BFM khi Publishing API chưa test exemption (BFM không skip được).
- Không coi WAF plan là đã triển khai.
- Không dùng chung secret staging/production.
- Không migrate sessions; bắt buộc re-login sau cutover.
- Backup key phải có bản sao offline; không lưu cùng backup.

## Chưa kiểm chứng

- WAF/Access/BFM trên zone thật.
- Rate-limit hành vi dưới tấn công thật.
- Incident response production (on-call, thông báo).
- Restore production và rollback DNS.
- Media upload remote (R2/B2).
