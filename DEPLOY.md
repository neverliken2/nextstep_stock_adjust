# Deployment Guide — NextStep Stock Adjust (IA)

Docker image: **`neverliken/nextstep_stock_adjust:1.4.3`** (Docker Hub)

## 🔄 Architecture (v1.3.0+)

```
[Browser] → [NextStep Stock Adjust] → [smlnesservice] → [PostgreSQL]
            (this app, port 8004)    (HTTPS, port 3010)
```

⚠️ **Starting from v1.3.0** ไม่ต่อ PG ตรงแล้ว — ทุกคำสั่งคุยผ่าน `smlnesservice` (NestJS API gateway)

## Prerequisites (Customer Server)

1. Docker + Docker Compose installed
2. Port **8004** open in firewall
3. **`smlnesservice` รันอยู่แล้ว** (กับ DB ของลูกค้า) — รู้ BASE_URL ของมัน
4. **RAW client token** สำหรับ `nextstep-stock-adjust` (gen + register ใน `ALLOWED_CLIENTS_JSON` ของ smlnesservice)

> 📘 ดู `smlnesservice` README สำหรับวิธี gen token + เพิ่ม client entry

## Step 1: Setup Files

```bash
mkdir nextstep_stock_adjust && cd nextstep_stock_adjust
```

Create `docker-compose.yml`:

```yaml
services:
  nextstep-stock-adjust:
    image: neverliken/nextstep_stock_adjust:1.4.3
    container_name: nextstep_stock_adjust
    ports:
      - "8004:8004"
    env_file:
      - .env
    restart: unless-stopped
    # ถ้า smlnesservice รันใน docker network เดียวกัน:
    # networks:
    #   - sml_app_net

# networks:
#   sml_app_net:
#     external: true
```

Create `.env`:

```env
# smlnesservice (API Gateway)
SMLNES_BASE_URL=http://smlnesservice-host:3010
SMLNES_CLIENT_TOKEN=<RAW token จาก smlnesservice — 64 hex chars>

# Cookie + Session
COOKIE_SECURE=false
SESSION_SECRET=<random ≥ 32 chars — gen ด้วย openssl rand -hex 32>

# Node Environment
NODE_ENV=production
```

> 🔒 **Security:** `SMLNES_CLIENT_TOKEN` ระบุตัวตน app นี้ — ห้ามแชร์/commit; rotate ทันทีถ้าหลุด

## Step 2: Pull & Start

```bash
docker compose pull
docker compose up -d
```

Verify:
```bash
docker compose ps
docker compose logs -f
```

Open browser → `http://<server-ip>:8004`

## Step 3: Update to New Version

```bash
# แก้ tag ใน docker-compose.yml ก่อน
sed -i 's|:1\.[0-9]\.[0-9]|:1.4.3|' docker-compose.yml

docker compose pull
docker compose up -d
```

Or always use `:latest`:
```yaml
image: neverliken/nextstep_stock_adjust:latest
```

## Step 4: Logs / Restart / Stop

```bash
docker compose logs --tail 100 -f
docker compose restart
docker compose down
```

## Troubleshooting

| Issue | Fix |
|---|---|
| `เชื่อมต่อ smlnesservice ไม่ได้` | ตรวจ `SMLNES_BASE_URL` reachable + smlnesservice รันอยู่ |
| `ระบบไม่ได้รับอนุญาตเรียก service` (`INVALID_API_KEY`) | RAW token ไม่ match hash ใน `ALLOWED_CLIENTS_JSON` — gen ใหม่ทั้งคู่ |
| `ไม่มีสิทธิ์เข้าใช้งานระบบ` (`NO_PERMISSION`) | user ต้องมีสิทธิ์เมนู **"ปรับปรุงสินค้า/วัตถุดิบ"** (`menu_ic_stk_adjust`) ใน SMLERP22 |
| Cookie not saving | Set `COOKIE_SECURE=false` if no HTTPS |
| Session expired immediately | Check server time sync (NTP) + `SESSION_SECRET` ต้อง stable |
| `ไม่พบ doc_format "IA"` | สร้าง record `code='IA'` ใน `erp_doc_format` ของ data DB |

## Behind Reverse Proxy (Nginx)

```nginx
location / {
    proxy_pass http://localhost:8004;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

ถ้า HTTPS ผ่าน reverse proxy → `COOKIE_SECURE=true` ใน `.env`

## Upgrade Path: v1.2.0 → v1.3.0

⚠️ **Breaking change** — ใช้ pg ตรง → ใช้ smlnesservice

ก่อน upgrade ต้องเช็คว่า:
- [ ] `smlnesservice` deployed แล้ว + reachable จาก server นี้
- [ ] ลูกค้ามี SMLERP22 user ที่มีสิทธิ์เมนู `menu_ic_stk_adjust`
- [ ] gen RAW token + register hash ใน smlnesservice `ALLOWED_CLIENTS_JSON`
- [ ] Migrate `.env`:
  - ❌ ลบ: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME_PREFIX`, `DB_CONNECTION_TIMEOUT`
  - ✅ เพิ่ม: `SMLNES_BASE_URL`, `SMLNES_CLIENT_TOKEN`

ถ้ายังไม่พร้อม → คงใช้ `:1.2.0` ต่อได้ (ต่อ PG ตรง)

## What this app does

- สร้างเอกสาร **ปรับปรุงสินค้า (IA, trans_flag=66)** เท่านั้น (INSERT)
- ไม่มีหน้า list/edit/delete
- **ไม่** insert `cb_trans` / `ap_ar_trans_detail` / GL — เป็นแค่เอกสาร IC
- Stock recalculate โดย `SMLStockCostProcess.exe` ของ ERP ภายหลัง
- สูตรมูลค่า: `sum_amount = (ทุนเฉลี่ยที่ต้องการ − ทุนเดิม) × จำนวน`
  - user กรอก "ทุนเฉลี่ยที่ต้องการ" (target_avg) → ระบบคำนวณ value-only adjust ให้ avg ใหม่ = target พอดี
  - ตัวอย่าง: old=438.59, target=450, qty=21 → sum_amount = 239.61 → avg ใหม่ = 450.00
- `creator_code = last_editor_code = 'nextstep_stock_adjust'` (audit marker)
- Permission gate: ต้องมีสิทธิ์เมนู **"ปรับปรุงสินค้า/วัตถุดิบ"** (`menu_ic_stk_adjust`) ใน SMLERP22
