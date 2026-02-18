# 📦 Inventory Auto Deactivate
### Advanced Shopify App for Automated Inventory Hygiene
*(Private Portfolio Project)*

![Status](https://img.shields.io/badge/Status-Production-success)
![Stack](https://img.shields.io/badge/Stack-Remix%20%7C%20Shopify%20%7C%20Docker-blue)
![DevOps](https://img.shields.io/badge/DevOps-Self--Hosted%20%7C%20CI%2FCD-orange)
![License](https://img.shields.io/badge/License-Private-lightgrey)

---

## 🚀 Overview
**Inventory Auto Deactivate** is a full-stack Shopify Application designed to solve a critical e-commerce problem: **Ghost Stock**.

It automatically scans thousands of products daily to identify and hide items that have been **inactive** (no sales/updates) for a set period and have **zero inventory**. This cleans up the storefront, improves SEO, and ensures customers only see available products.

Built with **performance** and **reliability** in mind, it handles large catalogs via background job scheduling and real-time WebSockets for dashboard updates.

---

## 🏗️ Architecture & DevOps
This project goes beyond a standard app by implementing a robust **Self-Hosted Infrastructure** on a bare-metal Ubuntu Server.

### 🔹 The Stack
*   **Framework:** [Remix](https://remix.run/) (React + Node.js)
*   **Database:** [Prisma ORM](https://www.prisma.io/) (SQLite / PostgreSQL ready)
*   **UI System:** [Shopify Polaris](https://polaris.shopify.com/)
*   **Containerization:** [Docker](https://www.docker.com/) & Docker Compose
*   **Server:** Ubuntu Linux (Self-Hosted)

### 🔹 The Infrastructure
*   **Cloudflare Tunnel:** Exposes the localhost server securely to the internet without opening ports (Zero Trust Security).
*   **Persistent SSL:** Managed automatically via Cloudflare Edge.
*   **Automated CI/CD:**
    *   **GitHub Actions Self-Hosted Runner** installed directly on the Ubuntu server.
    *   **Zero-Downtime Deployment:** Pushing to `main` automatically triggers a build, stops containers, and restarts the service in seconds.

---

## ✨ Key Features

### 1. 🤖 Intelligent Automation
*   **Smart Scheduling:** Background jobs run daily scans based on user-configured thresholds (e.g., "Inactive for 90 days").
*   **Safety Limits:** Built-in circuit breakers prevent accidental mass-deactivations.

### 2. ⚡ Real-Time Dashboard
*   **Live Feedback:** Uses polling to show scan progress and deactivation counts in real-time.
*   **Activity Log:** A searchable, persistent audit trail of every action taken by the bot.

### 3. 🔄 Auto-Reactivation
*   **Webhook Listeners:** Instantly detects when inventory is added to a "Draft" product.
*   **Automatic Publishing:** Immediately sets the product status back to "Active" so it can be sold again.

### 4. 🏢 Multi-Tenancy
*   **Session Management:** Built to handle multiple shops simultaneously with strict data isolation via Prisma/Session storage.

---

## 🛠️ Skills Demonstrated
*   **Full-Stack Development:** React, TypeScript, Node.js, Prisma.
*   **Shopify Ecosystem:** GraphQL Admin API, Webhooks, Polaris Design System.
*   **System Administration:** Ubuntu Server management, SSH, Systemd services.
*   **Container Functionality:** Dockerfiles, Volume Management, Network isolation.
*   **DevOps Pipelines:** Writing GitHub Action workflows, managing Self-Hosted Runners.

---

> *This is a private project showcasing full-stack and DevOps capabilities. Source code available upon request.*
