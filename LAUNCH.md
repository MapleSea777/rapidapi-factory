# RapidAPI 变现上线指南（目标：≥ ¥100）

本项目是一个「API 工厂」：**一个零依赖 Node 服务承载 16 个有真实技术壁垒的 API**。
它们不是"搜一下就能自己写"的玩具——每个都包含从零实现的算法或真实网络探测，
这正是用户愿意付费的原因。零第三方依赖、零外部调用成本，免费层即可部署。

## 为什么这些 API 值得付费（壁垒说明）

### A. 商业垂直刚需（付费意愿最高，优先上架）
| 产品 | 前缀 | 壁垒 |
|---|---|---|
| **VAT & Tax ID Validator** | /vat/v1 | 30 个欧洲国家的**真实校验位算法**（ISO 7064 MOD 11,10、SIREN mod 97、NL 11-test、西班牙 NIE mod 23 表……）。跨境电商/ERP/财务系统刚需 |
| **Bank Code Suite** | /bank-code/v1 | SWIFT/BIC(ISO 9362) + 美国 ABA 3-7-1 校验与美联储区解析 + 英国 sort code modulus + 印度 IFSC + 澳洲 BSB，含 250 条国家表 |
| **Crypto Address Validator** | /crypto-addr/v1 | **从零实现** Keccak-256、Base58Check、Bech32/Bech32m(BIP-173/350)、EIP-55、TRON、XRP、Solana、SS58。交易所/钱包提现校验刚需 |
| **Product Identifier Suite** | /product-code/v1 | EAN-8/13、UPC-A/E、GTIN-14、ISBN-10/13、ISSN、ISMN、ISRC 十几种校验位算法 + UPC-E↔UPC-A 转换表。零售/电商/PIM 刚需 |
| **IBAN Suite** | /iban/v1 | 65 国 IBAN 结构规则表 + BigInt mod-97 + 银行码提取 + 校验位生成 |
| **VIN Decoder** | /vin/v1 | ISO 3779 校验位算法 + 35 条 WMI 厂商表 + 年份码。汽车/保险/二手车 |
| **Email Verifier Pro** | /email-verify/v1 | 真实 DNS MX 探测 + 一次性域名库 + 拼写纠错 |
| **Domain Intel** | /domain-intel/v1 | 全量 DNS 记录 + RDAP/WHOIS 实时查询 + 可用性判断 |

### B. 开发者 / 效率工具（流量大、差异化明显）
| 产品 | 前缀 | 壁垒 |
|---|---|---|
| **Recurrence Rule Expander** | /rrule/v1 | 完整 RFC 5545 RRULE 展开（BYDAY 序数、BYSETPOS、负 BYMONTHDAY、WKST、EXDATE）。日历/排班/预约 SaaS，RapidAPI 上极少有做好的 |
| **Cron Expression Suite** | /cron/v1 | 5/6 字段 cron 解析 + 英文描述 + 未来 N 次运行时间，宏、名称、步长、Vixie 规则 |
| **Timezone & Business Hours** | /timezone/v1 | IANA 时区 DST 正确换算 + 分布式团队的"工作时段重叠"求解 |
| **Semantic Version Suite** | /semver/v1 | 完整 SemVer 2.0.0 优先级 + npm 风格范围语义（^ ~ x-range 连字符 \|\| 预发布） |
| **QR Forge** | /qr/v1 | 从零实现 ISO/IEC 18004：GF(256) Reed-Solomon、8 掩码择优+罚分、PNG 位图编码 |
| **Readability Lab** | /readability/v1 | 6 种可读性公式 + 音节启发式引擎。内容/SEO/教育 |
| **Sentiment Engine** | /sentiment/v1 | 170 词加权词典 + 否定翻转 + 程度副词 + emoji 情感 |
| **Mock Data Factory** | /mock-data/v1 | 种子化可复现随机（mulberry32）+ Luhn 合法信用卡 + 10 类数据 |

## 一、部署（Render 免费，约 3 分钟）

仓库已推送到 GitHub：`https://github.com/MapleSea777/rapidapi-factory`

1. 登录 https://dashboard.render.com （用 GitHub 登录）
2. **New +** → **Blueprint** → 选择仓库 `rapidapi-factory`
3. 确认检测到 `render.yaml` → **Apply / Deploy Blueprint**（Free 计划，无需信用卡）
4. 部署完成后记下地址，例如 `https://rapidapi-factory-xxxx.onrender.com`
5. 浏览器访问该地址 `/` 应返回 16 个产品目录

> ⚠️ Render 免费实例 **15 分钟无请求会休眠**，冷启动约 30–60 秒。
> 正式售卖前建议：用外部定时器（如 UptimeRobot / cron-job.org）每 10 分钟 ping 一次 `https://你的地址/health` 保活；
> 或月收入 ≥ $7 后升级 Starter 实例。

方式 B — Docker：`docker build -t rapidapi-factory . && docker run -p 8080:8080 rapidapi-factory`

## 二、生成 OpenAPI 规格（上架用）

```bash
PUBLIC_URL=https://你的地址 npm run specs
```

在 `specs/` 生成 16 个 `.openapi.json`，每个对应一个 RapidAPI 商品。
**注意：规格里的 `servers[].url` 必须是你真实的部署地址，导入前务必用上面的命令重新生成。**

## 三、在 RapidAPI 上架（每个产品重复一遍）

1. 登录 https://rapidapi.com/workspace → **Add API**
2. **Spec type: OpenAPI 3** → 粘贴对应 `specs/*.openapi.json`
3. **Base URL** 填你的部署地址（规格里已带前缀，如 `https://你的地址/vat/v1`）
4. **Pricing** 建议（可按产品微调）：
   | 套餐 | 价格 | 额度 |
   |---|---|---|
   | BASIC（免费） | $0 | 100 次/月 |
   | PRO | $9/月 | 10,000 次/月 |
   | ULTRA | $29/月 | 100,000 次/月 |
   | MEGA | $99/月 | 1,000,000 次/月 |
5. 描述直接复制 `apis/*.js` 里的 `description`，附 curl 示例
6. 发布后在 Hub 页面用真实 key 测试每个端点

> 服务端已内置限流（读取 `X-RapidAPI-Key`），免费额度由代码强制执行并返回 429 引导升级。

## 四、赚到 ¥100（≈ $14）的现实路径

- **2 个 PRO 订阅即达标**。
- 优先主推 A 组垂直刚需：**VAT Validator**（跨境电商/财务）、**Bank Code Suite**（fintech/支付）、**Crypto Address Validator**（交易所/钱包）、**Product Identifier Suite**（零售/电商）。
  这些领域用户付费意愿高、竞品定价普遍 $10+/月。
- 上架后第 1 周：
  1. 每个 API 描述放 2-3 个真实调用示例；
  2. 到对应垂直社区推广（跨境电商群、支付/合规论坛、开发者社区、零售 IT）；
  3. 看 Hub analytics，把免费额度用尽的用户通过 429 引导升级。
- 收入在 RapidAPI → Provider Dashboard 查看，按月结算（PayPal/银行）。

## 五、本地开发

```bash
npm start        # 启动服务（默认 8080）
npm test         # 65 项冒烟测试
npm run specs    # 重新生成 OpenAPI 规格
```

## 产品清单（16 个）

| 前缀 | 产品 | 端点数 |
|---|---|---|
| /vat/v1 | VAT & Tax ID Validator | 3 |
| /bank-code/v1 | Bank Code Suite | 6 |
| /crypto-addr/v1 | Crypto Address Validator | 3 |
| /product-code/v1 | Product Identifier Suite | 4 |
| /iban/v1 | IBAN Suite | 3 |
| /vin/v1 | VIN Decoder | 2 |
| /email-verify/v1 | Email Verifier Pro | 2 |
| /domain-intel/v1 | Domain Intel | 3 |
| /rrule/v1 | Recurrence Rule Expander | 3 |
| /cron/v1 | Cron Expression Suite | 3 |
| /timezone/v1 | Timezone & Business Hours | 4 |
| /semver/v1 | Semantic Version Suite | 5 |
| /qr/v1 | QR Forge | 2 |
| /readability/v1 | Readability Lab | 1 |
| /sentiment/v1 | Sentiment Engine | 1 |
| /mock-data/v1 | Mock Data Factory | 2 |
