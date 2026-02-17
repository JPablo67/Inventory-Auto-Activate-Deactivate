import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async () => {
    return json({});
};

export default function PrivacyPolicy() {
    return (
        <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, San Francisco, Segoe UI, Roboto, Helvetica Neue, sans-serif", padding: "40px", maxWidth: "800px", margin: "0 auto", lineHeight: "1.6" }}>
            <h1 style={{ fontSize: "2rem", marginBottom: "20px" }}>Privacy Policy</h1>
            <p style={{ color: "#666" }}>Last updated: {new Date().toLocaleDateString()}</p>

            <hr style={{ margin: "30px 0", border: "0", borderTop: "1px solid #eee" }} />

            <section style={{ marginBottom: "30px" }}>
                <h2 style={{ fontSize: "1.5rem", marginBottom: "15px" }}>1. Introduction</h2>
                <p>
                    "Auto Hide Out of Stock" ("we", "us", or "our") respects your privacy. This Privacy Policy describes how we collect, use, and share information when you install or use our Shopify application.
                </p>
            </section>

            <section style={{ marginBottom: "30px" }}>
                <h2 style={{ fontSize: "1.5rem", marginBottom: "15px" }}>2. Information We Collect</h2>
                <p>When you install the App, we are automatically able to access certain types of information from your Shopify account:</p>
                <ul style={{ paddingLeft: "20px", marginTop: "10px" }}>
                    <li><strong>Shop Information:</strong> Your shop name, email, and primary domain (to identify your account).</li>
                    <li><strong>Product Data:</strong> We access your product inventory levels and tags to perform the auto-hide and auto-reactivate functions.</li>
                </ul>
                <p style={{ marginTop: "10px" }}>We do <strong>not</strong> collect or store customer PII (Personally Identifiable Information) or payment details.</p>
            </section>

            <section style={{ marginBottom: "30px" }}>
                <h2 style={{ fontSize: "1.5rem", marginBottom: "15px" }}>3. How We Use Your Information</h2>
                <p>We use the collected information solely to provide the App's functionality:</p>
                <ul style={{ paddingLeft: "20px", marginTop: "10px" }}>
                    <li>Monitoring inventory levels via webhooks.</li>
                    <li>Updating product status (allocating/deallocating inventory) based on your settings.</li>
                    <li>Authentication and billing via Shopify's API.</li>
                </ul>
            </section>

            <section style={{ marginBottom: "30px" }}>
                <h2 style={{ fontSize: "1.5rem", marginBottom: "15px" }}>4. Data Retention</h2>
                <p>We retain your shop's settings (e.g., auto-hide preferences) for as long as the App is installed. If you uninstall the App, your configuration data is deleted from our database within 48 hours.</p>
            </section>

            <section style={{ marginBottom: "30px" }}>
                <h2 style={{ fontSize: "1.5rem", marginBottom: "15px" }}>5. Contact Us</h2>
                <p>For more information about our privacy practices, please contact us at via the Shopify App Store support listing.</p>
            </section>

        </div>
    );
}
