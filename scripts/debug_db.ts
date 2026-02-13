import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function check() {
    console.log("Checking Sessions...");
    const sessions = await prisma.session.findMany();
    console.log(`Found ${sessions.length} sessions.`);
    sessions.forEach(s => {
        console.log(`- ID: ${s.id}, Shop: ${s.shop}, IsOnline: ${s.isOnline}, Expires: ${s.expires}`);
    });

    console.log("\nChecking Settings...");
    const settings = await prisma.settings.findMany();
    settings.forEach(s => {
        console.log(`- Shop: ${s.shop}, IsActive: ${s.isActive}, Frequency: ${s.frequency} ${s.frequencyUnit}, LastRun: ${s.lastRunAt}, Status: ${s.currentStatus}, Type: ${s.lastScanType}`);
    });
}

check()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
