import { useCallback, useEffect, useRef, useState } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";

interface PollOptions<T> {
    url: string;
    intervalMs: number;
    enabled?: boolean;
    onData?: (data: T) => void;
}

export function useAuthenticatedFetch() {
    const shopify = useAppBridge();

    return useCallback(async <T>(url: string, init: RequestInit = {}): Promise<T> => {
        const token = await shopify.idToken();
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${token}`);
        const response = await fetch(url, { ...init, headers });
        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }
        return response.json() as Promise<T>;
    }, [shopify]);
}

export function useAuthenticatedPoll<T>({ url, intervalMs, enabled = true, onData }: PollOptions<T>) {
    const authFetch = useAuthenticatedFetch();
    const shopify = useAppBridge();
    const [data, setData] = useState<T | null>(null);
    const inFlight = useRef(false);
    const failureCount = useRef(0);
    const onDataRef = useRef(onData);
    onDataRef.current = onData;

    const tick = useCallback(async () => {
        if (inFlight.current) return;
        if (document.visibilityState !== "visible") return;
        inFlight.current = true;
        try {
            const result = await authFetch<T>(url);
            failureCount.current = 0;
            setData(result);
            onDataRef.current?.(result);
        } catch (err) {
            failureCount.current += 1;
            if (failureCount.current >= 3) {
                const RELOAD_KEY = "app-bridge-reload-at";
                const last = parseInt(sessionStorage.getItem(RELOAD_KEY) || "0", 10);
                if (Date.now() - last > 30_000) {
                    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
                    try { shopify.toast.show("Reconnecting…"); } catch { /* ignore */ }
                    setTimeout(() => window.location.reload(), 800);
                }
            }
        } finally {
            inFlight.current = false;
        }
    }, [authFetch, url, shopify]);

    useEffect(() => {
        if (!enabled) return;
        const id = setInterval(tick, intervalMs);
        const onVisible = () => {
            if (document.visibilityState === "visible") tick();
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            clearInterval(id);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [enabled, intervalMs, tick]);

    return { data, refetch: tick };
}
