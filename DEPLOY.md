# Deployment Guide — NextStep Stock Adjust (IA)

Docker image: **`neverliken/nextstep_stock_adjust:1.1.0`** (Docker Hub)

## Prerequisites (Customer Server)

1. Docker + Docker Compose installed
2. Port **8004** open in firewall
3. Network access to customer's PostgreSQL server

## Step 1: Setup Files

```bash
mkdir nextstep_stock_adjust && cd nextstep_stock_adjust
```

Create `docker-compose.yml`:

```yaml
services:
  nextstep-stock-adjust:
    image: neverliken/nextstep_stock_adjust:1.1.0
    container_name: nextstep_stock_adjust
    ports:
      - "8004:8004"
    env_file:
      - .env
    environment:
      - COOKIE_SECURE=false
      - SESSION_SECRET=${SESSION_SECRET}
    restart: unless-stopped
```

Create `.env`:

```env
DB_HOST=your-postgres-host
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your-password
DB_NAME_PREFIX=smlerpmain
DB_CONNECTION_TIMEOUT=10000
COOKIE_SECURE=false
SESSION_SECRET=replace-with-a-long-random-secret
NODE_ENV=production
```

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
docker compose pull
docker compose up -d
```

Or always use `:latest`:
```yaml
image: neverliken/nextstep_stock_adjust:latest
```

## Step 4: Backup / Logs

```bash
docker compose logs --tail 100 -f
docker compose restart
docker compose down
```

## Troubleshooting

| Issue | Fix |
|---|---|
| "Connection terminated" (DB) | Check `.env` credentials + `DB_HOST` reachable |
| Cookie not saving | Set `COOKIE_SECURE=false` if no HTTPS |
| Session expired immediately | Check server time sync (NTP) |
| Login fail | Check provider exists in `smlerpmain<provider>.sml_user_list` |
| `ไม่พบ doc_format "IA"` | สร้าง record code='IA' ใน erp_doc_format ของ data DB ก่อน |

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

If HTTPS via reverse proxy → `COOKIE_SECURE=true` in `.env`.

## What this app does

- สร้างเอกสาร **ปรับปรุงสินค้า (IA, trans_flag=66)** เท่านั้น (INSERT)
- ไม่มีหน้า list/edit/delete
- **ไม่** insert `cb_trans` / `ap_ar_trans_detail` / GL — เป็นแค่เอกสาร IC
- Stock จะถูก recalculate ตอน `SMLStockCostProcess.exe` ที่ ERP รันต่อ
- สูตรมูลค่า: `sum_amount = (ทุนเฉลี่ยที่ต้องการ − ทุนเดิม) × จำนวน`
  - user กรอก "ทุนเฉลี่ยที่ต้องการ" (target_avg) → ระบบคำนวณ value-only adjust ให้ avg ใหม่ = target พอดี
  - ตัวอย่าง: old=438.59, target=450, qty=21 → sum_amount = 239.61 → avg ใหม่ = 450.00
- `creator_code = last_editor_code = 'nextstep_stock_adjust'` (marker)
