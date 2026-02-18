# Inventory Auto Deactivator
### Enterprise-Grade Inventory Hygiene Automation for Shopify

![Status](https://img.shields.io/badge/Status-Production-success)
![Platform](https://img.shields.io/badge/Platform-Shopify%20Plus%20Ready-9cf)
![Stack](https://img.shields.io/badge/Stack-Remix%20%7C%20Prisma%20%7C%20Docker-blue)

---

## 🎯 The Mission
**Eliminate "Ghost Stock" and maximize catalog efficiency.**

High-volume e-commerce stores often suffer from catalog bloat—thousands of products that are out of stock and haven't sold in months. This hurts **SEO**, degrades **User Experience**, and clutters **Collections**.

**Inventory Auto Deactivator** is an automated, set-and-forget solution that runs 24/7 to identify, analyze, and hide these liabilities, ensuring your customers only see what they can buy.

---

## 💼 Core Capabilities

### 🛡️ Automated Catalog Protection
*   **Intelligent Scanning Engine**: Configurable algorithms scan your entire catalog daily to identify products meeting specific "End of Life" criteria (e.g., *Zero Inventory* + *90 Days Inactive*).
*   **Zero-Risk Execution**: Built-in "Circuit Breakers" and rate limits ensure automation never disrupts store uptime or API limits.

### ⚡ Real-Time Operational Dashboard
*   **Live Observability**: Watch the scanning engine work in real-time via WebSockets.
*   **Granular Audit Trail**: Every action (Deactivation, Reactivation, Scan) is logged with timestamp, SKU, and method, providing complete accountability for your operations team.

### 🔄 Auto-Recovery (Reactivation)
*   **Smart Inventory Listeners**: The moment stock is added to a "Draft" product, the system detects the webhooks and **immediately reactivates** the product, ensuring you never miss a sale.

### 🏢 Multi-Tenant Architecture
*   Designed for scale, supporting multiple Shopify stores simultaneously with strict data isolation and session management.

---

## 🏗️ Technical Architecture
*Built for reliability, speed, and security.*

### The Stack
*   **Frontend/Backend**: [Remix](https://remix.run/) (React + Node.js) for server-side rendering and swift UI interactions.
*   **Database**: [Prisma ORM](https://www.prisma.io/) with SQLite/PostgreSQL for robust data integrity.
*   **Design System**: Native [Shopify Polaris](https://polaris.shopify.com/) integration for a seamless, native-admin experience.

### Infrastructure & DevOps
*   **Self-Hosted Sovereignty**: Deployed on bare-metal Ubuntu servers for maximum performance and cost control.
*   **Containerized Microservices**: Fully Dockerized application ensuring consistent environments from Dev to Production.
*   **Zero-Trust Security**: Exposed via **Cloudflare Tunnels**, eliminating the need for open ports and providing enterprise-grade DDoS protection.
*   **Automated CI/CD**: Seamless deployment pipeline via **GitHub Actions Self-Hosted Runners**, enabling zero-downtime updates with a single push to production.

---

## 🔒 Security & Privacy
*   **No PII Collection**: The system operates strictly on Product and Inventory data.
*   **OAuth 2.0 Integration**: Uses official Shopify Authentication flows.
*   **Session Isolation**: Secure, encrypted session storage ensures data privacy between merchant instances.

---

> *Project maintained by [Juan Pablo Acosta].*
