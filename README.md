# ربات مانیتور ولت ترون

هر واریز TRX به ولت‌های اضافه‌شده را از **لیست تراکنش همان ولت** می‌خواند (مدل صفحه ترون‌اسکن) و هش را برای ادمین تلگرام می‌فرستد.

اسکن تک‌تک بلاک‌های شبکه با TronGrid انجام نمی‌شود؛ همان روش محدودیت ۱۵ ثانیه را پر می‌کرد و واریزها از دست می‌رفت.

## منبع داده

1. اگر `TRONSCAN_API_KEY` داشته باشید، مستقیم از API ترون‌اسکن خوانده می‌شود.
2. وگرنه از API حساب (`/v1/accounts/{address}/transactions?only_to=true`) لیست واریز همان ولت خوانده می‌شود و لینک پیام همچنان ترون‌اسکن است.

کلید TronGrid با کلید ترون‌اسکن یکی نیست. کلید ترون‌اسکن را از [tronscan.org](https://tronscan.org) بسازید.

## راه‌اندازی

```powershell
Copy-Item .env.example .env
npm install
npm start
```

در `.env`:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_IDS`
- `TRONSCAN_API_KEY` (اختیاری ولی بهتر)
- `TRONGRID_API_KEY` (پشتیبان)

بعد از اجرا در ربات `/test` بزنید تا آخرین واریز TRX نشان داده شود.

## دستورات

| دستور | کار |
| --- | --- |
| `/add T... نام اختیاری` | اضافه کردن ولت |
| `/remove T...` | حذف ولت |
| `/list` | لیست ولت‌ها و موجودی |
| `/status` | وضعیت مانیتور |
| `/ping` | تست تأخیر منبع |
| `/test` | نمایش آخرین واریز TRX |

فقط واریز **TRX** اعلام می‌شود، نه USDT.

## استقرار روی Render.com

ربات باید **۲۴ ساعته روشن** بماند. پلن رایگان Web Service بعد از بیکاری می‌خوابد و اعلان قطع می‌شود. از **Background Worker** با پلن Starter استفاده کنید.

### ۱. پروژه را روی GitHub بگذارید

`.env` را commit نکنید. متغیرها را در پنل Render می‌گذارید.

### ۲. سرویس بسازید

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Background Worker**
2. همین ریپو را وصل کنید
3. تنظیمات:
   - **Runtime:** Node
   - **Build Command:** `npm ci`
   - **Start Command:** `npm start`
4. یک **Persistent Disk** بسازید:
   - Mount Path: `/data`
   - Size: `1 GB`

اگر به‌جای Worker از **Web Service** استفاده کنید هم کار می‌کند (روت `/health` برای چک Render)، ولی Instance را Free نگذارید.

### ۳. Environment Variables

| کلید | مقدار |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | توکن BotFather |
| `TELEGRAM_ADMIN_IDS` | آیدی عددی تلگرام شما |
| `TRONGRID_API_KEY` | کلید TronGrid |
| `TRONSCAN_API_KEY` | اختیاری |
| `DATA_DIR` | `/data` |
| `POLL_INTERVAL_MS` | `2500` |

بعد از Deploy باید در تلگرام پیام «مانیتور ولت روشن شد» بیاید. `/status` را بزنید و ببینید آخرین چک چند ثانیه پیش بوده.

اگر از فایل `render.yaml` استفاده کنید، Render می‌تواند Worker و دیسک را از روی Blueprint بسازد؛ توکن‌ها را همان‌جا دستی پر کنید.
