# RapidAPI 变现上线指南（目标：≥ ¥100）

本项目是一个「API 工厂」：一个服务承载 **8 个有真实技术壁垒的复杂 API**。
它们不是"搜一下就能自己写"的玩具——每个都包含从零实现的算法或真实网络探测，
这正是用户愿意付费的原因。零第三方依赖、零外部调用成本，免费层即可部署。

## 为什么这些 API 值得付费（壁垒说明）

| 产品 | 前缀 | 壁垒（用户自己做不到的原因） |
|---|---|---|
| **QR Forge** | /qr/v1 | 从零实现 ISO/IEC 18004：GF(256) 上的 Reed-Solomon 纠错、8 种掩码自动择优+罚分、PNG 位图编码。几百行数学，没人愿意自己写 |
| **Email Verifier Pro** | /email-verify/v1 | 真实 DNS MX 探测（判断域名能否收信）+ 50+ 一次性域名库 + 拼写纠错。需要服务器端 DNS 与数据积累 |
| **IBAN Suite** | /iban/v1 | 65 国 IBAN 长度/结构规则表 + BigInt mod-97 校验 + 银行码提取 + 校验位生成。规则数据是壁垒 |
| **VIN Decoder** | /vin/v1 | ISO 3779 校验位算法（转译值+权重）+ 35 条 WMI 厂商表 + 年份码。汽车/保险/二手车垂直刚需 |
| **Readability Lab** | /readability/v1 | 6 种可读性公式（Flesch/Fog/SMOG/Coleman-Liau/ARI）+ 音节启发式引擎。内容/SEO/教育行业用 |
| **Sentiment Engine** | /sentiment/v1 | 170 词加权词典 + 否定翻转 + 程度副词 + emoji 情感。评论分析/舆情监控刚需 |
| **Mock Data Factory** | /mock-data/v1 | 种子化可复现随机（mulberry32）+ Luhn 合法信用卡 + 10 类数据。测试工程师刚需 |
| **Domain Intel** | /domain-intel/v1 | 全量 DNS 记录 + RDAP/WHOIS 实时查询 + 域名可用性判断。域名投资人/安全行业用 |

## 一、部署（5 分钟，免费）

方式 A — Render（推荐）：
1. 把本目录推到 GitHub
2. https://render.com → New → Blueprint，关联仓库（`render.yaml` 自动配置）
3. 记下地址，例如 `https://rapidapi-factory.onrender.com`

方式 B — Docker：`docker build -t rapidapi-factory . && docker run -p 8080:8080 rapidapi-factory`

验证：访问 `https://你的地址/` 应返回 8 个产品目录。

## 二、生成 OpenAPI 规格（上架用）

```bash
PUBLIC_URL=https://你的地址 npm run specs
```

在 `specs/` 生成 8 个 `.openapi.json`，每个对应一个 RapidAPI 商品。

## 三、在 RapidAPI 上架（每个产品重复一遍）

1. 登录 https://rapidapi.com/hub → **Add API**
2. **API Name** 用产品名；**Spec type: OpenAPI 3** → 粘贴对应 `specs/*.openapi.json`
3. **Pricing** 建议：
   | 套餐 | 价格 | 额度 |
   |---|---|---|
   | BASIC（免费） | $0 | 100 次/月 |
   | PRO | $9/月 | 10,000 次/月 |
   | ULTRA | $29/月 | 100,000 次/月 |
   | MEGA | $99/月 | 1,000,000 次/月 |
4. 描述直接复制 `apis/*.js` 里的 `description`，附 curl 示例。
5. 发布后在 Hub 页面用真实 key 测试每个端点。

> 服务端已内置限流（读取 `X-RapidAPI-Key`），免费额度由代码强制执行。

## 四、赚到 ¥100（≈ $14）的现实路径

- **2 个 PRO 订阅即达标**。
- 优先主推垂直刚需、竞品少的：**VIN Decoder**（汽车）、**IBAN Suite**（金融/跨境支付）、**Email Verifier Pro**（营销）、**Domain Intel**（域名投资）。这些领域用户付费意愿高、竞品定价普遍 $10+/月。
- 上架后第 1 周：
  1. 每个 API 描述放 2-3 个真实调用示例；
  2. 到对应垂直社区推广（二手车论坛、跨境电商群、SEO 社区、域名投资社区）；
  3. 看 Hub analytics，把免费额度用尽的用户通过 429 引导升级。
- 收入在 RapidAPI → Provider Dashboard 查看，按月结算（PayPal/银行）。

## 五、本地开发

```bash
npm start        # 启动服务（默认 8080）
npm test         # 36 项冒烟测试
npm run specs    # 重新生成 OpenAPI 规格
```

## 产品清单（8 个）

| 前缀 | 产品 | 端点数 |
|---|---|---|
| /qr/v1 | QR Forge | 2 |
| /email-verify/v1 | Email Verifier Pro | 2 |
| /iban/v1 | IBAN Suite | 3 |
| /vin/v1 | VIN Decoder | 2 |
| /readability/v1 | Readability Lab | 1 |
| /sentiment/v1 | Sentiment Engine | 1 |
| /mock-data/v1 | Mock Data Factory | 2 |
| /domain-intel/v1 | Domain Intel | 3 |
