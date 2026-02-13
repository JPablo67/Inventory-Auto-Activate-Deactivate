# Inventory Auto Deactivator

A powerful Shopify App built to automatically keep your inventory clean by deactivating products that have been inactive for a specified period and have zero stock.

## 🚀 Key Features

*   **Automated Deactivation**: Set a schedule (e.g., every day) to scan for products that have been inactive for X days and have 0 inventory. The app automatically deactivates them (sets status to Draft).
*   **Manual Scan**: Run a scan on-demand to preview which products would be deactivated, and choose to deactivate them selectively.
*   **Real-Time Dashboard**: Monitor your store's health with live updates on Active, Draft, Archived, and Out-of-Stock products.
*   **Activity Log**: detailed history of every action taken by the app (Auto or Manual), with filtering capabilities (Deactivated/Reactivated).
*   **Safety First**: Built-in safety limits and "Immediate Stop" functionality to pause automation instantly.

## 🛠️ Tech Stack

*   **Framework**: [Remix](https://remix.run/)
*   **Platform**: [Shopify App Template (Node)](https://github.com/Shopify/shopify-app-template-node)
*   **Database**: [Prisma](https://www.prisma.io/) (SQLite for dev, easily switchable to Postgres/MySQL)
*   **UI**: [Shopify Polaris](https://polaris.shopify.com/)
*   **Backend**: Node.js, GraphQL (Shopify Admin API)

## 📂 Project Structure

*   `app/routes/app._index.tsx`: Main Dashboard (Metrics & Manual Scan).
*   `app/routes/app.settings.tsx`: Configuration for Auto-Deactivation.
*   `app/routes/app.activity.tsx`: Searchable/Filterable History Log.
*   `app/services/inventory.server.ts`: Core logic for scanning and analyzing product inventory history.
*   `app/services/scheduler.server.ts`: Background job runner for automated scans.

## ⚡ Setup & Installation

1.  **Clone the repository**
    ```bash
    git clone <repository-url>
    cd inventory-deactivator
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```

3.  **Setup Environment**
    Create a `.env` file based on `.env.example` (or use `shopify app env pull` if you have the Shopify CLI linked).

4.  **Database Setup**
    ```bash
    npm run setup
    ```
    (This runs `prisma generate` and `prisma migrate deploy`)

5.  **Run Locally**
    ```bash
    npm run dev
    ```

## 📖 Usage

### Auto-Deactivate
1.  Go to **Settings**.
2.  Enable "Auto-Deactivate".
3.  Set your rules:
    *   **Inactive Days**: Products with no sales/inventory changes for this many days.
    *   **Frequency**: How often the scanner runs (e.g., Every 1 Day).
4.  Save. The app will now run in the background.

### Manual Scan
1.  Go to **Dashboard**.
2.  Click "Scan Now".
3.  Review the list of candidates.
4.  Select products and click "Deactivate Selected".

## 🛡️ Safety & performance
*   **Batching**: Updates are batched to respect Shopify API limits.
*   **Smart Polling**: The dashboard updates in real-time without overloading the API.

## 📄 License
MIT
