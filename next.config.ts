import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  logging: {
    incomingRequests: { ignore: [/\/api\/chatgpt(?:\?|$)/] },
  },
  async headers() {
    return [
      { source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
      ] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default config;
